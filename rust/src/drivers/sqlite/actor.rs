//! Actor của một connection SQLite: nhận lệnh tuần tự, giữ cursor (câu SELECT đang mở) giữa các lệnh.
//!
//! Vị trí trong luồng: `drivers::sqlite::open` spawn `run` cho mỗi connection; `request` gửi `Cmd`
//! qua kênh `mpsc`; `run` chạy lệnh (gọi `schema`, `split`, `raw`, `value`) rồi trả kết quả qua
//! kênh `oneshot` trong `Job`. Vì chỉ actor này chạm vào connection nên không cần khoá.
//!
//! Hai khái niệm Rust xuất hiện nhiều:
//! - `async`/`.await`: hàm có thể tạm dừng chờ I/O mà không chặn thread (tương tự goroutine).
//! - Lifetime `'c` và borrow: một giá trị có thể *mượn* (`&`/`&mut`) giá trị khác; compiler đảm
//!   bảo người cho mượn không bị dùng trái phép khi còn đang cho mượn. Ví dụ cursor mượn
//!   connection nên trong lúc giữ cursor ta không dùng được connection cho việc khác.
//!
//! Dòng của câu SELECT đọc thẳng bằng SQLite C API (`raw::Stmt`), không qua stream của sqlx, vì
//! đường sqlx tốn thêm nhiều lần cấp phát và chuyển kiểu cho mỗi ô (xem `read_page`).

use super::{Cmd, Job, raw, schema, split};
use crate::protocol::{
    CANCELLED, CURSOR_NOT_FOUND, Column, DbError, DbResult, ExecuteResult, FetchResult, SQL_ERROR,
    StatementResult, TABLE_NOT_FOUND,
};
use crate::registry;
use sqlx::sqlite::SqliteConnection;
use sqlx::{AssertSqlSafe, Connection};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::sync::mpsc;

/// Cursor đang mở: câu SELECT đọc dần từng dòng (không nạp cả kết quả vào RAM). `stmt` mượn
/// connection (`'c`, nó giữ luôn khoá handle) nên actor không dùng được connection cho tới khi
/// bỏ cursor, đồng thời worker thread của sqlx không đụng vào handle trong lúc ta `step`.
/// Vì vậy actor chuyển sang `hold` để chỉ phục vụ `fetch` cho tới khi cursor kết thúc.
struct Held<'c> {
    cursor_id: u64,
    stmt: raw::Stmt<'c>,
}

/// Giới hạn một trang kết quả.
#[derive(Clone, Copy)]
struct Limits {
    /// Số dòng tối đa.
    page_size: usize,
    /// Ngưỡng tổng byte chuỗi; vượt thì dừng trang sớm.
    max_bytes: usize,
}

/// Một trang dòng đã đọc; `done` là stream đã hết.
struct Page {
    rows: Vec<Vec<Option<String>>>,
    done: bool,
}

/// Gỡ connection khỏi registry khi actor kết thúc (kể cả panic), trước khi connection bị drop,
/// để `s3b_cancel` không bao giờ interrupt handle đã đóng.
struct RegistryGuard(u64);

/// `Drop` chạy tự động khi giá trị bị huỷ, giống `defer` của Go.
impl Drop for RegistryGuard {
    fn drop(&mut self) {
        registry::global().remove_conn(self.0, false);
    }
}

/// Vòng lặp của actor: nhận từng `Cmd` rồi chạy tới khi gặp `Close` hoặc kênh đóng.
/// Nhận `conn` và `rx` theo giá trị (move): actor là chủ sở hữu duy nhất của chúng.
pub async fn run(id: u64, mut conn: SqliteConnection, mut rx: mpsc::Receiver<Cmd>) {
    // Tên bắt đầu bằng `_` vẫn giữ giá trị sống tới hết hàm để `Drop` chạy (gỡ conn khỏi registry)
    // kể cả khi hàm kết thúc bất thường.
    let _guard = RegistryGuard(id);
    let mut next_cursor = 0u64;
    // Lệnh đã lấy khỏi kênh trong `hold` nhưng chưa xử lý; xử lý ở vòng lặp kế tiếp.
    let mut pending: Option<Cmd> = None;
    loop {
        let cmd = match pending.take() {
            Some(cmd) => cmd,
            None => match rx.recv().await {
                Some(cmd) => cmd,
                None => break,
            },
        };
        let reg = registry::global();
        // `Close` xử lý riêng vì nó kết thúc actor (`return`); các lệnh khác (`other`) đi tiếp.
        let cmd = match cmd {
            Cmd::Close(done) => {
                reg.remove_conn(id, false);
                let _ = conn.close().await;
                let _ = done.send(());
                return;
            }
            other => other,
        };
        // Đánh dấu đang chạy rồi mới kiểm cờ huỷ: `cancel` đặt cờ trước khi đọc `running`, nên
        // hoặc ta thấy cờ (request xếp hàng đã bị huỷ thì không chạy), hoặc nó thấy `running`
        // và interrupt đúng request này.
        if let Some((request_id, cancel)) = cmd.request() {
            reg.set_running(id, request_id);
            if cancel.load(Ordering::SeqCst) {
                reg.set_running(id, 0);
                cmd.reject_cancelled();
                continue;
            }
        }
        match cmd {
            Cmd::Close(_) => {}
            Cmd::Execute(job) => {
                next_cursor += 1;
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                // `held` là `Some` khi còn dòng và cần giữ cursor; `&mut conn` mượn connection cho `execute`.
                let (res, held) =
                    execute(&mut conn, &job.params.sql, limits, &job.cancel, next_cursor).await;
                // Gỡ `running` TRƯỚC khi trả lời (xem `drop_cursor_if_cancelled`).
                reg.set_running(id, 0);
                let (res, held) = drop_cursor_if_cancelled(res, held, &job.cancel);
                let _ = job
                    .reply
                    .send(res.map(|statements| ExecuteResult { statements }));
                if let Some(held) = held {
                    // `hold` giữ cursor tới khi hết dòng hoặc có lệnh khác tới (trả về qua `pending`).
                    pending = hold(id, held, &mut rx).await;
                }
            }
            Cmd::TableRows(job) => {
                next_cursor += 1;
                let (res, held) = table_rows(&mut conn, &job, next_cursor).await;
                reg.set_running(id, 0);
                let (res, held) = drop_cursor_if_cancelled(res, held, &job.cancel);
                let _ = job.reply.send(res);
                if let Some(held) = held {
                    pending = hold(id, held, &mut rx).await;
                }
            }
            Cmd::Fetch(job) => {
                // Cursor còn mở được xử lý trong `hold`; tới đây nghĩa là không có.
                let _ = job.reply.send(Err(cursor_not_found()));
                reg.set_running(id, 0);
            }
            Cmd::SchemaTree(job) => {
                let res = schema::schema_tree(&mut conn).await;
                let _ = job.reply.send(res.map_err(|e| e.into_db(&job.cancel)));
                reg.set_running(id, 0);
            }
            Cmd::TableInfo(job) => {
                let res =
                    schema::table_info(&mut conn, &job.params.schema, &job.params.table).await;
                let _ = job.reply.send(res.map_err(|e| e.into_db(&job.cancel)));
                reg.set_running(id, 0);
            }
        }
    }
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): vẫn đóng connection cho sạch.
    let _ = conn.close().await;
}

/// Giữ cursor và phục vụ `fetch` cho tới khi hết dòng; lệnh khác tới thì bỏ cursor và trả lệnh đó.
/// `None` nghĩa là không còn lệnh nào chờ xử lý (cursor đã xong hoặc kênh đóng).
async fn hold(conn_id: u64, mut held: Held<'_>, rx: &mut mpsc::Receiver<Cmd>) -> Option<Cmd> {
    let reg = registry::global();
    loop {
        // `?` trên `Option`: kênh đóng (`None`) thì thoát hàm trả `None`.
        match rx.recv().await? {
            // `if` sau mẫu là match guard: chỉ khớp khi `cursorId` đúng cursor đang giữ.
            Cmd::Fetch(job) if job.params.cursor_id == held.cursor_id => {
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                reg.set_running(conn_id, job.id);
                let page = read_page(&mut held.stmt, limits, &job.cancel);
                reg.set_running(conn_id, 0);
                match page {
                    Ok(page) => {
                        let done = page.done;
                        // `running` đã về 0: cờ huỷ bật lúc này nghĩa là cursor còn lại có thể
                        // mang cờ interrupt treo, nên bỏ cursor và trả `cancelled`.
                        if !done && job.cancel.load(Ordering::SeqCst) {
                            let _ = job.reply.send(Err(cancelled()));
                            return None;
                        }
                        let _ = job.reply.send(Ok(FetchResult {
                            rows: page.rows,
                            done,
                        }));
                        if done {
                            return None;
                        }
                    }
                    Err(e) => {
                        // Câu lỗi hoặc bị huỷ thì không đọc tiếp được.
                        let _ = job.reply.send(Err(e));
                        return None;
                    }
                }
            }
            Cmd::Fetch(job) => {
                let _ = job.reply.send(Err(cursor_not_found()));
            }
            other => return Some(other),
        }
    }
}

/// Xử lý race giữa `s3b_cancel` và lúc request vừa đọc xong trang: `cancel` có thể chạy sau khi
/// `read_page` xong nhưng trước `set_running(0)`, để lại cờ interrupt treo của SQLite trong cursor
/// còn mở (lần `fetch` sau sẽ lỗi `interrupted` thay vì `cancelled`).
///
/// Gọi SAU `set_running(id, 0)` (cùng lock với `cancel`, nên từ đây không còn interrupt nào cho
/// request này); mọi interrupt trước đó đều đi sau khi cờ huỷ bật, nên chỉ cần kiểm cờ. Cờ đã bật
/// mà còn giữ cursor thì bỏ cursor (finalize) và trả `cancelled`.
fn drop_cursor_if_cancelled<'c, T>(
    res: DbResult<T>,
    held: Option<Held<'c>>,
    cancel: &AtomicBool,
) -> (DbResult<T>, Option<Held<'c>>) {
    if held.is_some() && cancel.load(Ordering::SeqCst) {
        (Err(cancelled()), None)
    } else {
        (res, held)
    }
}

/// Lỗi `cursorNotFound`: cursor đã hết, đã bị bỏ hoặc id sai.
fn cursor_not_found() -> DbError {
    DbError::new(CURSOR_NOT_FOUND, "cursor is closed")
}

impl Limits {
    /// Chuẩn hoá giới hạn: ít nhất 1 dòng mỗi trang (tránh vòng lặp không tiến triển khi `pageSize = 0`).
    fn new(page_size: usize, max_bytes: usize) -> Self {
        Self {
            page_size: page_size.max(1),
            max_bytes,
        }
    }
}

/// Lỗi `cancelled`: request bị huỷ qua `s3b_cancel`.
pub fn cancelled() -> DbError {
    DbError::new(CANCELLED, "request cancelled")
}

/// Lỗi sqlx -> `cancelled` nếu request bị huỷ, ngược lại `sqlError`.
/// Huỷ bằng `sqlite3_interrupt` làm SQLite trả lỗi `interrupted`; ta nhận ra qua cờ `cancel`.
pub fn map_sqlx(e: sqlx::Error, cancel: &AtomicBool) -> DbError {
    if cancel.load(Ordering::SeqCst) {
        return cancelled();
    }
    let msg = match &e {
        sqlx::Error::Database(d) => d.message().to_owned(),
        other => other.to_string(),
    };
    DbError::new(SQL_ERROR, msg)
}

/// Đọc một trang: tối đa `page_size` dòng và dừng sớm khi vượt `max_bytes` (luôn có ≥ 1 dòng).
///
/// Hàm đồng bộ (không `async`): `sqlite3_step` chặn thread cho tới khi có dòng, có thể rất lâu với
/// câu nặng. `block_in_place` báo cho tokio chuyển các task khác sang thread khác trong lúc đó để
/// không làm đói runtime (chỉ dùng được trên runtime multi-thread, đúng cái `runtime.rs` tạo).
fn read_page(stmt: &mut raw::Stmt<'_>, limits: Limits, cancel: &AtomicBool) -> DbResult<Page> {
    tokio::task::block_in_place(|| {
        // Cấp sẵn chỗ nhưng tối đa 1024 để `pageSize` lớn không chiếm RAM trước khi có dữ liệu.
        let mut rows = Vec::with_capacity(limits.page_size.min(1024));
        let mut bytes = 0usize;
        // Điều kiện `rows.is_empty() ||` đảm bảo luôn lấy ít nhất một dòng dù dòng đó vượt `max_bytes`.
        while rows.len() < limits.page_size && (rows.is_empty() || bytes < limits.max_bytes) {
            if cancel.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            match stmt.next_row() {
                Ok(None) => return Ok(Page { rows, done: true }),
                Ok(Some(cells)) => {
                    bytes += cells.iter().flatten().map(String::len).sum::<usize>();
                    rows.push(cells);
                }
                // Huỷ bằng `sqlite3_interrupt` làm SQLite trả lỗi `interrupted`; nhận ra qua cờ `cancel`.
                Err(_) if cancel.load(Ordering::SeqCst) => return Err(cancelled()),
                Err(msg) => return Err(DbError::new(SQL_ERROR, msg)),
            }
        }
        Ok(Page { rows, done: false })
    })
}

/// Mili giây từ `start`; `try_from` đổi `u128` sang `u64`, tràn thì lấy giá trị lớn nhất thay vì panic.
fn elapsed_ms(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Dựng `StatementResult` cho câu lỗi (kết quả của riêng câu, không làm hỏng cả request).
fn statement_error(index: usize, sql: &str, start: Instant, message: String) -> StatementResult {
    StatementResult {
        index,
        sql: sql.to_owned(),
        kind: "affected",
        columns: None,
        rows: None,
        cursor_id: None,
        done: None,
        truncated: None,
        rows_affected: None,
        elapsed_ms: elapsed_ms(start),
        error: Some(DbError::new(SQL_ERROR, message)),
    }
}

/// Chạy lần lượt các câu trong `sql`, dừng ở câu lỗi đầu tiên (lỗi từng câu nằm trong
/// `StatementResult.error`, không làm hỏng cả request). Câu cuối là SELECT còn dòng thì trả
/// cursor để actor giữ (Q3).
///
/// Trả `(kết quả, cursor)`; `Held<'c>` mượn `conn` nên `conn` chỉ dùng lại được sau khi bỏ cursor.
/// Lỗi cấp request (`Err`) chỉ dành cho huỷ hoặc lỗi nội bộ; lỗi SQL nằm trong từng câu.
async fn execute<'c>(
    conn: &'c mut SqliteConnection,
    sql: &str,
    limits: Limits,
    cancel: &AtomicBool,
    cursor_id: u64,
) -> (DbResult<Vec<StatementResult>>, Option<Held<'c>>) {
    let bytes = sql.as_bytes();
    let mut offset = 0;
    let mut out: Vec<StatementResult> = Vec::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return (Err(cancelled()), None);
        }
        let rest = &bytes[offset..];
        if split::only_trivia(rest) {
            return (Ok(out), None);
        }
        let start = Instant::now();
        let index = out.len();

        // Prepare lười ngay trước khi chạy để câu sau thấy được thay đổi schema của câu trước.
        // `lock_handle` mượn connection để gọi SQLite C API trong `raw`; hết khối `match` là trả lại.
        let prepared = match conn.lock_handle().await {
            Ok(mut handle) => raw::prepare_next(&mut handle, rest),
            Err(e) => return (Err(DbError::internal(e.to_string())), None),
        };
        let prepared = match prepared {
            Ok(p) => p,
            // `s3b_cancel` có thể bật cờ ngay sau kiểm tra đầu vòng lặp rồi interrupt làm prepare
            // lỗi `interrupted`: đó là huỷ chứ không phải lỗi SQL của câu.
            Err(_) if cancel.load(Ordering::SeqCst) => return (Err(cancelled()), None),
            Err(msg) => {
                let text = String::from_utf8_lossy(split::first_statement(rest));
                out.push(statement_error(index, text.trim(), start, msg));
                return (Ok(out), None);
            }
        };
        let text = String::from_utf8_lossy(&rest[..prepared.consumed])
            .trim()
            .to_owned();
        offset += prepared.consumed;
        // `columns = None`: đoạn vừa tiêu thụ không có câu lệnh nào, bỏ qua và prepare đoạn tiếp.
        let Some(columns) = prepared.columns else {
            if prepared.consumed == 0 {
                return (Err(DbError::internal("empty statement")), None);
            }
            continue;
        };
        let is_last = split::only_trivia(&bytes[offset..]);

        // Không có cột: INSERT/UPDATE/DDL... chạy rồi báo số dòng bị ảnh hưởng.
        if columns.is_empty() {
            match run_affected(conn, &text, cancel).await {
                Ok(n) => out.push(StatementResult {
                    index,
                    sql: text,
                    kind: "affected",
                    columns: None,
                    rows: None,
                    cursor_id: None,
                    done: None,
                    truncated: None,
                    rows_affected: Some(n),
                    elapsed_ms: elapsed_ms(start),
                    error: None,
                }),
                Err(e) if e.code == CANCELLED => return (Err(e), None),
                Err(e) => {
                    out.push(statement_error(index, &text, start, e.message));
                    return (Ok(out), None);
                }
            }
            continue;
        }

        if !is_last {
            // Q3: chỉ câu cuối giữ cursor; câu trước chỉ lấy trang đầu rồi bỏ phần còn lại.
            let page = match open_cursor(conn, &text, cursor_id).await {
                Ok(mut held) => read_page(&mut held.stmt, limits, cancel),
                Err(e) => Err(e),
            };
            match page {
                Ok(page) => out.push(rows_statement(index, text, columns, page, None, start)),
                Err(e) if e.code == CANCELLED => return (Err(e), None),
                // `open_cursor` không biết cờ huỷ: interrupt làm prepare lỗi vẫn là huỷ.
                Err(_) if cancel.load(Ordering::SeqCst) => return (Err(cancelled()), None),
                Err(e) => {
                    out.push(statement_error(index, &text, start, e.message));
                    return (Ok(out), None);
                }
            }
            continue;
        }

        // Câu cuối: mọi nhánh bên dưới đều return, nên borrow `'c` của cursor không chặn vòng lặp.
        let mut held = match open_cursor(conn, &text, cursor_id).await {
            Ok(held) => held,
            Err(_) if cancel.load(Ordering::SeqCst) => return (Err(cancelled()), None),
            Err(e) => {
                out.push(statement_error(index, &text, start, e.message));
                return (Ok(out), None);
            }
        };
        return match read_page(&mut held.stmt, limits, cancel) {
            Ok(page) => {
                let done = page.done;
                let cursor = (!done).then_some(cursor_id);
                out.push(rows_statement(index, text, columns, page, cursor, start));
                // `done` thì `held` bị drop ở cuối khối: câu được finalize, nhả connection.
                (Ok(out), if done { None } else { Some(held) })
            }
            Err(e) if e.code == CANCELLED => (Err(e), None),
            Err(e) => {
                out.push(statement_error(index, &text, start, e.message));
                (Ok(out), None)
            }
        };
    }
}

/// Mở cursor cho một câu SELECT: khoá handle của connection rồi prepare lại câu để đọc dòng.
/// (Prepare lần hai rẻ so với đọc dòng; đổi lại không phải giữ handle khi chưa biết câu có
/// trả dòng hay không, và borrow của connection chỉ bắt đầu từ đây.)
async fn open_cursor<'c>(
    conn: &'c mut SqliteConnection,
    sql: &str,
    cursor_id: u64,
) -> DbResult<Held<'c>> {
    let handle = conn
        .lock_handle()
        .await
        .map_err(|e| DbError::internal(e.to_string()))?;
    // `prepare` nhận handle theo giá trị: khoá được cất vào `Stmt` và sống cùng câu.
    let stmt =
        raw::Stmt::prepare(handle, sql.as_bytes()).map_err(|msg| DbError::new(SQL_ERROR, msg))?;
    Ok(Held { cursor_id, stmt })
}

/// Dựng `StatementResult` loại `rows` từ một trang. `cursor_id` có nghĩa là actor sẽ giữ cursor.
fn rows_statement(
    index: usize,
    sql: String,
    columns: Vec<Column>,
    page: Page,
    cursor_id: Option<u64>,
    start: Instant,
) -> StatementResult {
    StatementResult {
        index,
        sql,
        kind: "rows",
        columns: Some(columns),
        rows: Some(page.rows),
        cursor_id,
        done: Some(page.done),
        // Còn dòng nhưng không giữ cursor (câu không phải cuối): Result bị cắt.
        truncated: (!page.done && cursor_id.is_none()).then_some(true),
        rows_affected: None,
        elapsed_ms: elapsed_ms(start),
        error: None,
    }
}

/// Chạy câu không trả cột. `sqlx` báo `rows_affected` của câu DML gần nhất kể cả khi câu này là
/// DDL, nên chỉ tin nó khi tổng số thay đổi của connection thật sự tăng.
/// Trả `Ok(số dòng)`; `.execute(&mut *conn)` mượn tạm connection (reborrow) để dùng lại `conn` ngay sau đó.
async fn run_affected(
    conn: &mut SqliteConnection,
    sql: &str,
    cancel: &AtomicBool,
) -> DbResult<i64> {
    let before = changes(conn).await?;
    let result = sqlx::query(AssertSqlSafe(sql.to_owned()))
        .persistent(false)
        .execute(&mut *conn)
        .await
        .map_err(|e| map_sqlx(e, cancel))?;
    let after = changes(conn).await?;
    Ok(if after != before {
        i64::try_from(result.rows_affected()).unwrap_or(i64::MAX)
    } else {
        0
    })
}

/// Tổng số dòng đã thay đổi của connection (cầu nối async tới `raw::total_changes`).
async fn changes(conn: &mut SqliteConnection) -> DbResult<i32> {
    let mut handle = conn
        .lock_handle()
        .await
        .map_err(|e| DbError::internal(e.to_string()))?;
    Ok(raw::total_changes(&mut handle))
}

/// `SELECT * FROM <schema>.<table>` dùng chung cursor với `execute`.
/// Kiểm table tồn tại trước để báo `tableNotFound`; tên được `quote_ident` nên không thể chèn SQL.
async fn table_rows<'c>(
    conn: &'c mut SqliteConnection,
    job: &Job<crate::protocol::TableRowsParams, StatementResult>,
    cursor_id: u64,
) -> (DbResult<StatementResult>, Option<Held<'c>>) {
    let p = &job.params;
    match schema::table_exists(conn, &p.schema, &p.table).await {
        Ok(true) => {}
        Ok(false) => {
            return (
                Err(DbError::new(TABLE_NOT_FOUND, "table does not exist")),
                None,
            );
        }
        Err(e) => return (Err(e.into_db(&job.cancel)), None),
    }
    let sql = format!(
        "SELECT * FROM {}.{}",
        schema::quote_ident(&p.schema),
        schema::quote_ident(&p.table)
    );
    let limits = Limits::new(p.page_size, p.max_page_bytes);
    let (res, held) = execute(conn, &sql, limits, &job.cancel, cursor_id).await;
    // `and_then`: chỉ chạy closure khi `res` là `Ok`; lấy câu đầu tiên, lỗi của câu đó thành lỗi cả request.
    let first = res.and_then(|statements| {
        let first = statements.into_iter().next();
        match first {
            Some(s) => match s.error {
                Some(err) => Err(err),
                None => Ok(s),
            },
            None => Err(DbError::internal("no statement result")),
        }
    });
    (first, held)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{FetchParams, SchemaTreeResult};
    use std::sync::Arc;
    use tokio::sync::oneshot;

    // `read_page` dùng `block_in_place`, chỉ chạy được trên runtime multi-thread (như `runtime.rs`),
    // nên mọi test ở đây dùng `flavor = "multi_thread"`.

    const BIG: usize = 16 * 1024 * 1024;
    const INFINITE_ROWS: &str =
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c";
    const INFINITE_STEP: &str =
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c";
    const OVERFLOW_AT_ROW_2: &str =
        "SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)";

    async fn mem() -> SqliteConnection {
        SqliteConnection::connect("sqlite::memory:").await.unwrap()
    }

    fn series(n: u32) -> String {
        format!(
            "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<{n}) SELECT x FROM c"
        )
    }

    fn limits(page: usize, bytes: usize) -> Limits {
        Limits::new(page, bytes)
    }

    fn first_col(page: &Page) -> Vec<&str> {
        page.rows.iter().map(|r| r[0].as_deref().unwrap()).collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn full_page_then_empty_done() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let mut held = open_cursor(&mut conn, &series(5), 7).await.ok().unwrap();
        assert_eq!(held.cursor_id, 7);
        let p = read_page(&mut held.stmt, limits(5, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["1", "2", "3", "4", "5"]);
        assert!(!p.done);
        let p = read_page(&mut held.stmt, limits(5, BIG), &cancel).unwrap();
        assert!(p.rows.is_empty());
        assert!(p.done);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn partial_last_page_is_done() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let mut held = open_cursor(&mut conn, &series(5), 1).await.ok().unwrap();
        let p = read_page(&mut held.stmt, limits(3, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["1", "2", "3"]);
        assert!(!p.done);
        let p = read_page(&mut held.stmt, limits(3, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["4", "5"]);
        assert!(p.done);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn max_bytes_stops_early_but_keeps_one_row() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        // Mỗi dòng 10 byte chuỗi.
        let sql = "SELECT 'abcdefghij' FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 \
                   UNION ALL SELECT 4 UNION ALL SELECT 5)";
        // (ngưỡng, số dòng mong đợi): dừng khi tổng byte >= ngưỡng, luôn >= 1 dòng.
        for (max_bytes, expect) in [(0, 1), (1, 1), (10, 1), (11, 2), (20, 2), (21, 3), (BIG, 5)] {
            let mut held = open_cursor(&mut conn, sql, 1).await.ok().unwrap();
            let p = read_page(&mut held.stmt, limits(100, max_bytes), &cancel).unwrap();
            assert_eq!(p.rows.len(), expect, "max_bytes={max_bytes}");
            assert_eq!(p.done, expect == 5, "max_bytes={max_bytes}");
        }
    }

    /// NULL không tính byte: dòng toàn NULL không bao giờ chạm ngưỡng.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn null_cells_cost_no_bytes() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let sql = "SELECT NULL FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)";
        let mut held = open_cursor(&mut conn, sql, 1).await.ok().unwrap();
        let p = read_page(&mut held.stmt, limits(100, 1), &cancel).unwrap();
        assert_eq!(p.rows.len(), 3);
        assert!(p.done);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn page_size_zero_is_one_row() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let mut held = open_cursor(&mut conn, &series(3), 1).await.ok().unwrap();
        let p = read_page(&mut held.stmt, limits(0, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["1"]);
        assert!(!p.done);
    }

    /// Cờ huỷ đặt trước: không đọc dòng nào, `cancelled`; bỏ cờ thì đọc tiếp từ dòng đầu.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_flag_set_before_read() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(true);
        let mut held = open_cursor(&mut conn, &series(3), 1).await.ok().unwrap();
        let e = read_page(&mut held.stmt, limits(10, BIG), &cancel)
            .err()
            .unwrap();
        assert_eq!(e.code, CANCELLED);
        cancel.store(false, Ordering::SeqCst);
        let p = read_page(&mut held.stmt, limits(10, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["1", "2", "3"]);
    }

    /// Huỷ giữa trang: thread khác đặt cờ khi trang đang đọc (kết quả vô hạn, trang cực lớn).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_mid_page_between_rows() {
        let mut conn = mem().await;
        let cancel = Arc::new(AtomicBool::new(false));
        let mut held = open_cursor(&mut conn, INFINITE_ROWS, 1).await.ok().unwrap();
        let flag = cancel.clone();
        let t = std::thread::spawn(move || flag.store(true, Ordering::SeqCst));
        let e = read_page(&mut held.stmt, limits(usize::MAX, usize::MAX), &cancel)
            .err()
            .unwrap();
        t.join().unwrap();
        assert_eq!(e.code, CANCELLED);
    }

    /// Huỷ khi `sqlite3_step` đang chạy: `sqlite3_interrupt` + cờ huỷ -> `cancelled` (không phải sqlError).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn interrupt_during_step_with_cancel_flag_is_cancelled() {
        let e = interrupt_infinite_step(true).await;
        assert_eq!(e.code, CANCELLED);
    }

    /// Interrupt mà không có cờ huỷ vẫn là lỗi SQL thường (không bị nuốt thành `cancelled`).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn interrupt_without_cancel_flag_is_sql_error() {
        let e = interrupt_infinite_step(false).await;
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.contains("interrupt"), "{}", e.message);
    }

    /// Chạy `read_page` trên câu có một `step` vô hạn, thread khác gọi interrupt lặp lại tới khi xong.
    async fn interrupt_infinite_step(set_flag: bool) -> DbError {
        let mut conn = mem().await;
        let cancel = Arc::new(AtomicBool::new(false));
        // Lấy handle interrupt TRƯỚC khi `open_cursor` (khoá nằm trong `Stmt` sau đó).
        let handle = {
            let mut h = conn.lock_handle().await.unwrap();
            // SAFETY: `conn` sống hơn `handle`, `handle` chỉ dùng trong test này.
            unsafe { raw::InterruptHandle::of(&mut h) }
        };
        let mut held = open_cursor(&mut conn, INFINITE_STEP, 1).await.ok().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let (flag, stop2) = (cancel.clone(), stop.clone());
        let t = std::thread::spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                if set_flag {
                    flag.store(true, Ordering::SeqCst);
                }
                handle.interrupt();
                std::thread::yield_now();
            }
        });
        let res = read_page(&mut held.stmt, limits(10, BIG), &cancel);
        stop.store(true, Ordering::SeqCst);
        t.join().unwrap();
        res.err().unwrap()
    }

    /// Lỗi ở dòng 2: `read_page` trả `sqlError`, các dòng đã đọc của trang đó bị bỏ.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn error_mid_page_is_sql_error() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let mut held = open_cursor(&mut conn, OVERFLOW_AT_ROW_2, 1)
            .await
            .ok()
            .unwrap();
        let e = read_page(&mut held.stmt, limits(10, BIG), &cancel)
            .err()
            .unwrap();
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.contains("integer overflow"), "{}", e.message);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn open_cursor_bad_sql_is_sql_error() {
        let mut conn = mem().await;
        let e = open_cursor(&mut conn, "SELECT * FROM nope", 1)
            .await
            .err()
            .unwrap();
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.contains("nope"));
        // Connection không bị khoá sau lỗi.
        let (res, held) = execute(
            &mut conn,
            "SELECT 1",
            limits(10, BIG),
            &AtomicBool::new(false),
            1,
        )
        .await;
        assert!(held.is_none());
        assert_eq!(
            res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
            Some("1")
        );
    }

    // ---------- execute ----------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_only_last_statement_keeps_cursor() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let sql = format!("{}; {}", series(5), series(5));
        let (res, held) = execute(&mut conn, &sql, limits(3, BIG), &cancel, 9).await;
        let st = res.unwrap();
        assert_eq!(st.len(), 2);
        // Câu đầu: còn dòng nhưng bỏ -> truncated, không cursor.
        assert_eq!(st[0].truncated, Some(true));
        assert_eq!(st[0].done, Some(false));
        assert_eq!(st[0].cursor_id, None);
        assert_eq!(st[0].rows.as_ref().unwrap().len(), 3);
        // Câu cuối: giữ cursor.
        assert_eq!(st[1].truncated, None);
        assert_eq!(st[1].cursor_id, Some(9));
        let held = held.unwrap();
        assert_eq!(held.cursor_id, 9);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_done_has_no_cursor() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (res, held) = execute(&mut conn, &series(3), limits(10, BIG), &cancel, 9).await;
        let st = res.unwrap();
        assert_eq!(st[0].done, Some(true));
        assert_eq!(st[0].cursor_id, None);
        assert!(held.is_none());
        drop(held);
        // Câu đã finalize: connection đóng được, không panic.
        conn.close().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_error_in_last_select_first_page() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (res, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(10, BIG), &cancel, 1).await;
        let st = res.unwrap();
        assert_eq!(st.len(), 1);
        assert_eq!(st[0].error.as_ref().unwrap().code, SQL_ERROR);
        assert!(st[0].rows.is_none());
        assert!(held.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_error_in_non_last_select_stops_rest() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let sql = format!("{OVERFLOW_AT_ROW_2}; SELECT 2");
        let (res, held) = execute(&mut conn, &sql, limits(10, BIG), &cancel, 1).await;
        let st = res.unwrap();
        assert_eq!(st.len(), 1);
        assert_eq!(st[0].error.as_ref().unwrap().code, SQL_ERROR);
        assert!(held.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_cancelled_before_start() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(true);
        let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 1).await;
        assert_eq!(res.err().unwrap().code, CANCELLED);
        assert!(held.is_none());
    }

    /// RETURNING có cột nên đi đường cursor, và việc ghi thật sự xảy ra kể cả khi chỉ đọc một phần.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_insert_returning_writes_all_rows() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let sql = "CREATE TABLE t(a INTEGER PRIMARY KEY, b); \
                   INSERT INTO t(b) VALUES('x'),('y'),('z') RETURNING a, b";
        let (res, held) = execute(&mut conn, sql, limits(1, BIG), &cancel, 3).await;
        let st = res.unwrap();
        assert_eq!(st[0].kind, "affected");
        assert_eq!(st[1].kind, "rows");
        assert_eq!(st[1].rows.as_ref().unwrap().len(), 1);
        assert_eq!(st[1].cursor_id, Some(3));
        // Bỏ cursor giữa chừng: 3 dòng vẫn đã được ghi.
        drop(held);
        let (res, _) = execute(
            &mut conn,
            "SELECT count(*) FROM t",
            limits(10, BIG),
            &cancel,
            4,
        )
        .await;
        assert_eq!(
            res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
            Some("3")
        );
    }

    // ---------- hold ----------

    fn fetch_job(cursor_id: u64, page: usize) -> (Cmd, oneshot::Receiver<DbResult<FetchResult>>) {
        let (reply, rx) = oneshot::channel();
        let job = Job {
            id: 1,
            params: FetchParams {
                conn_id: 0,
                cursor_id,
                page_size: page,
                max_page_bytes: BIG,
            },
            cancel: Arc::new(AtomicBool::new(false)),
            reply,
        };
        (Cmd::Fetch(job), rx)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hold_wrong_cursor_keeps_real_one_then_drains() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
        let held = held.unwrap();
        let (tx, mut rx) = mpsc::channel(8);

        let (wrong, wrong_rx) = fetch_job(99, 10);
        let (right1, right1_rx) = fetch_job(5, 2);
        let (right2, right2_rx) = fetch_job(5, 10);
        for c in [wrong, right1, right2] {
            tx.send(c).await.ok().unwrap();
        }
        // `hold` kết thúc (None) khi cursor hết dòng; không còn lệnh nào chờ.
        assert!(hold(0, held, &mut rx).await.is_none());

        assert_eq!(
            wrong_rx.await.unwrap().err().unwrap().code,
            CURSOR_NOT_FOUND
        );
        let r1 = right1_rx.await.unwrap().ok().unwrap();
        assert_eq!(r1.rows.len(), 2);
        assert!(!r1.done);
        assert_eq!(r1.rows[0][0].as_deref(), Some("3"));
        let r2 = right2_rx.await.unwrap().ok().unwrap();
        assert_eq!(r2.rows.len(), 1);
        assert_eq!(r2.rows[0][0].as_deref(), Some("5"));
        assert!(r2.done);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hold_other_command_drops_cursor_and_returns_it() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
        let held = held.unwrap();
        let (tx, mut rx) = mpsc::channel(8);
        let (reply, _schema_rx) = oneshot::channel::<DbResult<SchemaTreeResult>>();
        let other = Cmd::SchemaTree(Job {
            id: 2,
            params: (),
            cancel: Arc::new(AtomicBool::new(false)),
            reply,
        });
        tx.send(other).await.ok().unwrap();
        let back = hold(0, held, &mut rx).await;
        assert!(matches!(back, Some(Cmd::SchemaTree(_))));
        // Cursor đã bị bỏ (finalize, nhả connection): connection dùng lại và đóng được.
        let (res, _) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 6).await;
        assert!(res.is_ok());
        conn.close().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hold_error_replies_and_drops_cursor() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (_, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(10, BIG), &cancel, 5).await;
        // Câu đầu đã lỗi ngay ở trang đầu nên không có cursor; dùng pageSize 1 để lỗi nằm ở fetch.
        assert!(held.is_none());
        drop(held);
        let (_, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(1, BIG), &cancel, 5).await;
        let held = held.unwrap();
        let (tx, mut rx) = mpsc::channel(8);
        let (fetch, fetch_rx) = fetch_job(5, 10);
        let (again, again_rx) = fetch_job(5, 10);
        tx.send(fetch).await.ok().unwrap();
        tx.send(again).await.ok().unwrap();
        // Lỗi -> `hold` trả None ngay, lệnh thứ hai không được phục vụ bởi cursor cũ.
        assert!(hold(0, held, &mut rx).await.is_none());
        assert_eq!(fetch_rx.await.unwrap().err().unwrap().code, SQL_ERROR);
        // Lệnh còn lại nằm trong kênh, actor sẽ trả `cursorNotFound` ở vòng lặp chính.
        let Some(Cmd::Fetch(job)) = rx.recv().await else {
            panic!("lệnh thứ hai phải còn trong kênh");
        };
        drop(again_rx);
        assert_eq!(job.params.cursor_id, 5);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hold_closed_channel_returns_none() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
        let (tx, mut rx) = mpsc::channel::<Cmd>(8);
        drop(tx);
        assert!(hold(0, held.unwrap(), &mut rx).await.is_none());
        conn.close().await.unwrap();
    }

    /// Fetch mang cờ huỷ đã bật: `hold` trả `cancelled`, bỏ cursor (finalize) và kết thúc; connection
    /// dùng lại và đóng sạch được.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hold_fetch_with_cancel_flag_replies_cancelled_and_drops_cursor() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
        let (tx, mut rx) = mpsc::channel(8);
        let (fetch, fetch_rx) = fetch_job(5, 2);
        let Cmd::Fetch(job) = &fetch else {
            panic!("fetch_job phải trả Cmd::Fetch");
        };
        job.cancel.store(true, Ordering::SeqCst);
        tx.send(fetch).await.ok().unwrap();
        assert!(hold(0, held.unwrap(), &mut rx).await.is_none());
        assert_eq!(fetch_rx.await.unwrap().err().unwrap().code, CANCELLED);
        let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 6).await;
        assert!(held.is_none());
        drop(held);
        assert_eq!(
            res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
            Some("1")
        );
        conn.close().await.unwrap();
    }

    // ---------- drop_cursor_if_cancelled ----------

    /// Cờ huỷ bật + còn cursor (cursor có thể mang cờ interrupt treo do `cancel` chạy muộn):
    /// trả `cancelled`, bỏ cursor; connection không còn bị `interrupted` và đóng sạch được.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drop_cursor_if_cancelled_flag_on_with_cursor_drops_and_clears_interrupt() {
        let mut conn = mem().await;
        let handle = {
            let mut h = conn.lock_handle().await.unwrap();
            // SAFETY: `conn` sống hơn `handle`, `handle` chỉ dùng trong test này.
            unsafe { raw::InterruptHandle::of(&mut h) }
        };
        let no_cancel = AtomicBool::new(false);
        let (res, held) = execute(&mut conn, &series(5), limits(2, BIG), &no_cancel, 3).await;
        assert!(res.is_ok() && held.is_some());
        // Mô phỏng `cancel` chạy sau khi trang đã đọc xong: cờ bật rồi interrupt, cursor còn mở.
        let cancel = AtomicBool::new(true);
        handle.interrupt();
        let (res, held) = drop_cursor_if_cancelled(res, held, &cancel);
        assert_eq!(res.err().unwrap(), cancelled());
        assert!(held.is_none());
        drop(held);
        // Cursor đã finalize nên cờ interrupt treo được SQLite xoá: câu kế chạy bình thường.
        let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &no_cancel, 4).await;
        assert!(held.is_none());
        drop(held);
        assert_eq!(
            res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
            Some("1")
        );
        conn.close().await.unwrap();
    }

    /// Cờ huỷ không bật: kết quả và cursor giữ nguyên, cursor đọc tiếp được đúng chỗ.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drop_cursor_if_cancelled_flag_off_keeps_result_and_cursor() {
        let mut conn = mem().await;
        let cancel = AtomicBool::new(false);
        let (res, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 3).await;
        let (res, held) = drop_cursor_if_cancelled(res, held, &cancel);
        let st = res.unwrap();
        assert_eq!(st[0].cursor_id, Some(3));
        assert_eq!(st[0].rows.as_ref().unwrap().len(), 2);
        let mut held = held.unwrap();
        assert_eq!(held.cursor_id, 3);
        let p = read_page(&mut held.stmt, limits(10, BIG), &cancel).unwrap();
        assert_eq!(first_col(&p), ["3", "4", "5"]);
        assert!(p.done);
    }

    /// Không còn cursor thì kết quả không đổi dù cờ huỷ bật hay không: `Ok` giữ `Ok`, lỗi gốc giữ
    /// nguyên mã (không bị đổi thành `cancelled`).
    #[test]
    fn drop_cursor_if_cancelled_without_cursor_keeps_result() {
        for flag in [false, true] {
            let cancel = AtomicBool::new(flag);
            let (res, held) = drop_cursor_if_cancelled(Ok(42u32), None, &cancel);
            assert_eq!(res.unwrap(), 42, "flag={flag}");
            assert!(held.is_none(), "flag={flag}");

            let original = DbError::new(SQL_ERROR, "boom");
            let (res, held) = drop_cursor_if_cancelled::<u32>(Err(original.clone()), None, &cancel);
            assert_eq!(res.err().unwrap(), original, "flag={flag}");
            assert!(held.is_none(), "flag={flag}");
        }
    }
}
