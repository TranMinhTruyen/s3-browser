//! Actor của một connection SQLite: nhận lệnh tuần tự, giữ cursor (stream của sqlx) giữa các lệnh.

use super::{Cmd, Job, raw, schema, split, value};
use crate::protocol::{
    CANCELLED, CURSOR_NOT_FOUND, Column, DbError, DbResult, ExecuteResult, FetchResult, SQL_ERROR,
    StatementResult, TABLE_NOT_FOUND,
};
use crate::registry;
use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{AssertSqlSafe, Connection};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::sync::mpsc;

type RowStream<'c> = BoxStream<'c, Result<SqliteRow, sqlx::Error>>;

/// Cursor đang mở: stream mượn connection nên actor không dùng được connection cho tới khi bỏ nó.
struct Held<'c> {
    cursor_id: u64,
    stream: RowStream<'c>,
}

#[derive(Clone, Copy)]
struct Limits {
    page_size: usize,
    max_bytes: usize,
}

struct Page {
    rows: Vec<Vec<Option<String>>>,
    done: bool,
}

/// Gỡ connection khỏi registry khi actor kết thúc (kể cả panic), trước khi connection bị drop,
/// để `s3b_cancel` không bao giờ interrupt handle đã đóng.
struct RegistryGuard(u64);

impl Drop for RegistryGuard {
    fn drop(&mut self) {
        registry::global().remove_conn(self.0, false);
    }
}

pub async fn run(id: u64, mut conn: SqliteConnection, mut rx: mpsc::Receiver<Cmd>) {
    let _guard = RegistryGuard(id);
    let mut next_cursor = 0u64;
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
                let (res, held) =
                    execute(&mut conn, &job.params.sql, limits, &job.cancel, next_cursor).await;
                let _ = job
                    .reply
                    .send(res.map(|statements| ExecuteResult { statements }));
                reg.set_running(id, 0);
                if let Some(held) = held {
                    pending = hold(id, held, &mut rx).await;
                }
            }
            Cmd::TableRows(job) => {
                next_cursor += 1;
                let (res, held) = table_rows(&mut conn, &job, next_cursor).await;
                let _ = job.reply.send(res);
                reg.set_running(id, 0);
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
async fn hold(conn_id: u64, mut held: Held<'_>, rx: &mut mpsc::Receiver<Cmd>) -> Option<Cmd> {
    let reg = registry::global();
    loop {
        match rx.recv().await? {
            Cmd::Fetch(job) if job.params.cursor_id == held.cursor_id => {
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                reg.set_running(conn_id, job.id);
                let page = read_page(&mut held.stream, limits, &job.cancel).await;
                reg.set_running(conn_id, 0);
                match page {
                    Ok(page) => {
                        let done = page.done;
                        let _ = job.reply.send(Ok(FetchResult {
                            rows: page.rows,
                            done,
                        }));
                        if done {
                            return None;
                        }
                    }
                    Err(e) => {
                        // Stream lỗi hoặc bị huỷ thì không đọc tiếp được.
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

fn cursor_not_found() -> DbError {
    DbError::new(CURSOR_NOT_FOUND, "cursor is closed")
}

impl Limits {
    fn new(page_size: usize, max_bytes: usize) -> Self {
        Self {
            page_size: page_size.max(1),
            max_bytes,
        }
    }
}

pub fn cancelled() -> DbError {
    DbError::new(CANCELLED, "request cancelled")
}

/// Lỗi sqlx -> `cancelled` nếu request bị huỷ, ngược lại `sqlError`.
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
async fn read_page(
    stream: &mut RowStream<'_>,
    limits: Limits,
    cancel: &AtomicBool,
) -> DbResult<Page> {
    let mut rows = Vec::with_capacity(limits.page_size.min(1024));
    let mut bytes = 0usize;
    while rows.len() < limits.page_size && (rows.is_empty() || bytes < limits.max_bytes) {
        if cancel.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        match stream.next().await {
            None => return Ok(Page { rows, done: true }),
            Some(Err(e)) => return Err(map_sqlx(e, cancel)),
            Some(Ok(row)) => {
                let cells = value::row_cells(&row).map_err(|e| map_sqlx(e, cancel))?;
                bytes += cells.iter().flatten().map(String::len).sum::<usize>();
                rows.push(cells);
            }
        }
    }
    Ok(Page { rows, done: false })
}

fn elapsed_ms(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

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
        let prepared = match conn.lock_handle().await {
            Ok(mut handle) => raw::prepare_next(&mut handle, rest),
            Err(e) => return (Err(DbError::internal(e.to_string())), None),
        };
        let prepared = match prepared {
            Ok(p) => p,
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
        let Some(columns) = prepared.columns else {
            if prepared.consumed == 0 {
                return (Err(DbError::internal("empty statement")), None);
            }
            continue;
        };
        let is_last = split::only_trivia(&bytes[offset..]);

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
            let mut stream = open_stream(conn, &text);
            match read_page(&mut stream, limits, cancel).await {
                Ok(page) => out.push(rows_statement(index, text, columns, page, None, start)),
                Err(e) if e.code == CANCELLED => return (Err(e), None),
                Err(e) => {
                    out.push(statement_error(index, &text, start, e.message));
                    return (Ok(out), None);
                }
            }
            continue;
        }

        // Câu cuối: mọi nhánh bên dưới đều return, nên borrow `'c` của stream không chặn vòng lặp.
        let mut stream = open_stream(conn, &text);
        return match read_page(&mut stream, limits, cancel).await {
            Ok(page) => {
                let done = page.done;
                let cursor = (!done).then_some(cursor_id);
                out.push(rows_statement(index, text, columns, page, cursor, start));
                let held = cursor.map(|cursor_id| Held { cursor_id, stream });
                (Ok(out), held)
            }
            Err(e) if e.code == CANCELLED => (Err(e), None),
            Err(e) => {
                out.push(statement_error(index, &text, start, e.message));
                (Ok(out), None)
            }
        };
    }
}

fn open_stream<'c>(conn: &'c mut SqliteConnection, sql: &str) -> RowStream<'c> {
    sqlx::query(AssertSqlSafe(sql.to_owned()))
        .persistent(false)
        .fetch(conn)
}

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

async fn changes(conn: &mut SqliteConnection) -> DbResult<i32> {
    let mut handle = conn
        .lock_handle()
        .await
        .map_err(|e| DbError::internal(e.to_string()))?;
    Ok(raw::total_changes(&mut handle))
}

/// `SELECT * FROM <schema>.<table>` dùng chung cursor với `execute`.
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
