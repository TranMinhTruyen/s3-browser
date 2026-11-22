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

use super::{raw, schema, split};
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, affected_statement, cancelled,
    cursor_not_found, hold, rows_statement, statement_error,
};
use crate::drivers::{Cmd, Job};
use crate::protocol::{
    CANCELLED, DbError, DbResult, ExecuteResult, SQL_ERROR, StatementResult, TABLE_NOT_FOUND,
};
use crate::registry::{self, CancelSignal};
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

/// `Held` là cursor của SQLite: mỗi trang đọc bằng `read_page` (đồng bộ, `block_in_place`).
impl Cursor for Held<'_> {
    fn id(&self) -> u64 {
        self.cursor_id
    }

    async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        read_page(&mut self.stmt, limits, cancel.flag())
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
            if cancel.is_cancelled() {
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
                let (res, held) = execute(
                    &mut conn,
                    &job.params.sql,
                    limits,
                    job.cancel.flag(),
                    next_cursor,
                )
                .await;
                // Gỡ `running` TRƯỚC khi trả lời (xem `drop_cursor_if_cancelled`).
                reg.set_running(id, 0);
                let (res, held) = drop_cursor_if_cancelled(res, held, job.cancel.flag());
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
                let (res, held) = drop_cursor_if_cancelled(res, held, job.cancel.flag());
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
                let _ = job
                    .reply
                    .send(res.map_err(|e| e.into_db(job.cancel.flag())));
                reg.set_running(id, 0);
            }
            Cmd::TableInfo(job) => {
                let res =
                    schema::table_info(&mut conn, &job.params.schema, &job.params.table).await;
                let _ = job
                    .reply
                    .send(res.map_err(|e| e.into_db(job.cancel.flag())));
                reg.set_running(id, 0);
            }
        }
    }
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): vẫn đóng connection cho sạch.
    let _ = conn.close().await;
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

/// Đọc một trang: tối đa `page_size` dòng và dừng sớm khi vượt `max_bytes` (luôn có ≥ 1 dòng,
/// xem `PageBuilder`).
///
/// Hàm đồng bộ (không `async`): `sqlite3_step` chặn thread cho tới khi có dòng, có thể rất lâu với
/// câu nặng. `block_in_place` báo cho tokio chuyển các task khác sang thread khác trong lúc đó để
/// không làm đói runtime (chỉ dùng được trên runtime multi-thread, đúng cái `runtime.rs` tạo).
fn read_page(stmt: &mut raw::Stmt<'_>, limits: Limits, cancel: &AtomicBool) -> DbResult<Page> {
    tokio::task::block_in_place(|| {
        let mut page = PageBuilder::new(limits);
        while !page.is_full() {
            if cancel.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            match page.read(|| stmt.next_row()) {
                Ok(None) => return Ok(page.finish(true)),
                Ok(Some(cells)) => page.push(cells),
                // Huỷ bằng `sqlite3_interrupt` làm SQLite trả lỗi `interrupted`; nhận ra qua cờ `cancel`.
                Err(_) if cancel.load(Ordering::SeqCst) => return Err(cancelled()),
                Err(msg) => return Err(DbError::new(SQL_ERROR, msg)),
            }
        }
        Ok(page.finish(false))
    })
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
                Ok(n) => out.push(affected_statement(index, text, n, start)),
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
        Err(e) => return (Err(e.into_db(job.cancel.flag())), None),
    }
    let sql = format!(
        "SELECT * FROM {}.{}",
        schema::quote_ident(&p.schema),
        schema::quote_ident(&p.table)
    );
    let limits = Limits::new(p.page_size, p.max_page_bytes);
    let (res, held) = execute(conn, &sql, limits, job.cancel.flag(), cursor_id).await;
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
#[path = "../../../tests/unit/drivers/sqlite/actor.rs"]
mod tests;
