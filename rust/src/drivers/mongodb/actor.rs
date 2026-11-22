//! Actor của một connection MongoDB: nhận lệnh tuần tự, chạy từng lệnh `runCommand`, giữ cursor
//! (lệnh cuối còn document) giữa các lệnh `fetch`.
//!
//! Vị trí trong luồng: `mongodb::open` spawn `run` cho mỗi connection; `drivers::request` gửi
//! `Cmd` qua kênh `mpsc`; `run` chạy lệnh rồi trả kết quả qua kênh `oneshot` trong `Job`. Chỉ
//! actor này dùng `Session` nên không cần khoá (giống `sqlserver::actor`).
//!
//! Một request `execute` có thể chứa nhiều lệnh (xem `command`), chạy lần lượt và dừng ở lệnh lỗi
//! đầu tiên. Mỗi lệnh thành một `StatementResult`:
//! - `find`/`aggregate`/`listCollections`/`listIndexes`: có cursor. Mỗi document là một dòng, đúng
//!   một cột `document` chứa Extended JSON gọn (xem `ejson`). Chỉ lệnh cuối giữ cursor để `fetch`
//!   tiếp; lệnh trước đó chỉ lấy trang đầu (`truncated`).
//! - `insert`/`update`/`delete`: `affected`, số dòng là trường `n` của server.
//! - lệnh khác: một dòng chứa cả document trả lời.
//!
//! Điều cần biết về crate `mongodb`:
//! - `run_raw_cursor_command(..).batch()` trả `RawBatchCursor`: mỗi phần tử của stream là một
//!   *batch* thô (`RawBatch`) nguyên vẹn như server gửi, ta duyệt từng document trong đó mà không
//!   giải mã (zero-copy). Một trang của ta có thể là một phần batch (khi `fetch` xin ít hơn) hoặc
//!   nhiều batch, nên `Held` nhớ batch đang đọc dở và vị trí.
//! - Thả `RawBatchCursor` còn dở thì crate tự gửi `killCursors` ngầm (best-effort), nên bỏ cursor
//!   chỉ cần `drop`.
//! - Huỷ = `select!` giữa tín hiệu huỷ và future của crate; thả future giữa chừng thì crate bỏ
//!   connection đó khỏi pool. Server vẫn có thể chạy tiếp lệnh đã gửi tới khi xong (MongoDB không
//!   có "huỷ theo request"), nhưng client không chờ nữa và connection pool vẫn dùng được.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `tokio::select!`: chờ nhiều future cùng lúc, cái nào xong trước thì chạy nhánh của nó và các
//!   future còn lại bị thả (giống `select` của Go trên nhiều channel).
//! - `Peekable`: bọc một iterator để xem phần tử kế tiếp mà không lấy nó đi.

use super::command::{self, Command, Kind};
use super::{error_text, shutdown};
use crate::drivers::Cmd;
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, affected_statement, cancelled,
    cursor_not_found, elapsed_ms, hold, rows_statement, statement_error,
};
use crate::protocol::{
    CANCELLED, Column, DbError, DbResult, ExecuteResult, INVALID_REQUEST, SQL_ERROR,
    StatementResult,
};
use crate::registry::{self, CancelSignal};
use futures_util::StreamExt;
use mongodb::Client;
use mongodb::bson::raw::RawBsonRef;
use mongodb::bson::{Bson, Document, RawDocumentBuf};
use mongodb::error::Error as MongoError;
use mongodb::raw_batch_cursor::{RawBatch, RawBatchCursor};
use std::future::IntoFuture;
use std::time::Instant;
use tokio::sync::mpsc;

/// Connection đang mở: `Client` (đã gồm pool connection và luồng theo dõi server) và database
/// mặc định của lệnh.
pub struct Session {
    pub client: Client,
    pub db: String,
}

/// Chạy `fut` (một lời gọi của crate `mongodb`; các "action" của crate là `IntoFuture`, chưa chạy tới khi `.await`) tới khi xong hoặc request bị huỷ. Huỷ thì thả
/// `fut` và trả `cancelled`.
async fn drive<T>(
    fut: impl IntoFuture<Output = Result<T, MongoError>>,
    cancel: &CancelSignal,
) -> DbResult<T> {
    tokio::select! {
        // `biased`: kiểm huỷ trước, để request đã huỷ không bị coi là thành công.
        biased;
        () = cancel.cancelled() => Err(cancelled()),
        r = fut.into_future() => r.map_err(|e| DbError::new(SQL_ERROR, error_text(&e))),
    }
}

/// Cột duy nhất của kết quả có document: tên `document`, kiểu `json`.
fn document_column() -> Vec<Column> {
    vec![Column {
        name: "document".to_owned(),
        ty: "json".to_owned(),
    }]
}

/// Lỗi cho `method` chỉ SQLite hỗ trợ (cây đối tượng, thông tin table).
fn unsupported() -> DbError {
    DbError::new(INVALID_REQUEST, "method not supported by driver")
}

/// Cursor đang mở của lệnh cuối: stream batch của crate cùng batch đang đọc dở.
struct Held {
    id: u64,
    /// Đặt trong `Box` (con trỏ tới heap) vì `RawBatchCursor` lớn ~450 byte; không thì mọi giá
    /// trị `Option<Held>` luôn tốn chừng đó dù không có cursor.
    cursor: Box<RawBatchCursor>,
    /// Batch đang đọc dở (chưa lấy hết document).
    batch: Option<RawBatch>,
    /// Số document của `batch` đã đưa vào trang trước.
    pos: usize,
    /// Server đã hết batch (`cursor.id = 0` ở batch cuối hoặc stream kết thúc).
    finished: bool,
}

impl Held {
    fn new(id: u64, cursor: RawBatchCursor) -> Self {
        Self {
            id,
            cursor: Box::new(cursor),
            batch: None,
            pos: 0,
            finished: false,
        }
    }

    /// Đọc một trang: lấy document từ batch hiện tại, hết batch thì xin batch kế (`getMore`), dừng
    /// khi đủ `pageSize` dòng hoặc đủ `maxPageBytes` (luôn ≥ 1 dòng nếu còn).
    async fn read_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        let mut builder = PageBuilder::new(limits);
        while !builder.is_full() {
            let batch = match self.batch.take() {
                Some(batch) => batch,
                None => {
                    if self.finished {
                        break;
                    }
                    #[cfg(feature = "bench-timing")]
                    let waited = Instant::now();
                    let next = tokio::select! {
                        biased;
                        () = cancel.cancelled() => return Err(cancelled()),
                        next = self.cursor.next() => next,
                    };
                    #[cfg(feature = "bench-timing")]
                    builder.add_read(waited.elapsed());
                    match next {
                        None => {
                            self.finished = true;
                            break;
                        }
                        Some(Err(e)) => return Err(DbError::new(SQL_ERROR, error_text(&e))),
                        Some(Ok(batch)) => {
                            self.pos = 0;
                            batch
                        }
                    }
                }
            };
            if !self.fill(&mut builder, &batch)? {
                // Còn document trong batch nhưng trang đã đầy: giữ lại cho lần sau.
                self.batch = Some(batch);
            } else if batch_cursor_id(&batch) == 0 {
                // Batch cuối của cursor và đã lấy hết.
                self.finished = true;
            }
        }
        // Hết khi server hết batch và không còn batch dở.
        let done = self.finished && self.batch.is_none();
        Ok(builder.finish(done))
    }

    /// Chuyển document của `batch` (từ `self.pos`) thành dòng cho tới khi trang đầy. Trả `true`
    /// nếu đã lấy hết batch.
    fn fill(&mut self, builder: &mut PageBuilder, batch: &RawBatch) -> DbResult<bool> {
        let docs = batch.doc_slices().map_err(|_| bad_reply())?;
        let mut items = docs.into_iter().skip(self.pos).peekable();
        while !builder.is_full() {
            let Some(item) = items.next() else { break };
            let Ok(RawBsonRef::Document(doc)) = item else {
                return Err(bad_reply());
            };
            #[cfg(feature = "bench-timing")]
            let started = Instant::now();
            let json = super::ejson::document_to_string(doc)
                .map_err(|e| DbError::new(SQL_ERROR, e.to_string()))?;
            #[cfg(feature = "bench-timing")]
            builder.add_convert(started.elapsed());
            builder.push(vec![Some(json)]);
            self.pos += 1;
        }
        // `peek` nhìn phần tử kế mà không lấy: batch coi như hết khi không còn gì.
        Ok(items.peek().is_none())
    }
}

/// Lỗi khi server trả batch không đúng dạng.
fn bad_reply() -> DbError {
    DbError::new(SQL_ERROR, "unexpected reply from server")
}

/// `cursor.id` của batch (0 = server đã đóng cursor, không còn batch sau).
fn batch_cursor_id(batch: &RawBatch) -> i64 {
    batch
        .as_raw_document()
        .get_document("cursor")
        .and_then(|c| c.get_i64("id"))
        .unwrap_or(0)
}

impl Cursor for Held {
    fn id(&self) -> u64 {
        self.id
    }

    async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        self.read_page(limits, cancel).await
    }

    // `abandon` giữ mặc định (`drop`): thả `RawBatchCursor` còn dở là crate gửi `killCursors`.
}

/// Vòng lặp của actor: nhận từng `Cmd` rồi chạy tới khi gặp `Close` hoặc kênh đóng.
/// Nhận `session` và `rx` theo giá trị (move): actor là chủ sở hữu duy nhất của chúng.
pub async fn run(id: u64, session: Session, mut rx: mpsc::Receiver<Cmd>) {
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
        let cmd = match cmd {
            Cmd::Close(done) => {
                reg.remove_conn(id, false);
                shutdown(session.client).await;
                let _ = done.send(());
                return;
            }
            other => other,
        };
        // Đánh dấu đang chạy rồi mới kiểm cờ huỷ (cùng lý do với `sqlite::actor`): hoặc ta thấy
        // cờ và không chạy, hoặc `cancel` thấy `running` và gọi interrupt đúng request này.
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
                let Executed { res, held } =
                    execute(&session, &job.params.sql, limits, &job.cancel, next_cursor).await;
                // Gỡ `running` TRƯỚC khi trả lời: từ đây `cancel` không còn tác dụng.
                reg.set_running(id, 0);
                // Cờ huỷ bật đúng lúc request vừa xong: bỏ cursor và báo `cancelled`.
                let (res, held) = if held.is_some() && job.cancel.is_cancelled() {
                    (Err(cancelled()), None)
                } else {
                    (res, held)
                };
                let _ = job
                    .reply
                    .send(res.map(|statements| ExecuteResult { statements }));
                if let Some(held) = held {
                    // `hold` giữ cursor tới khi hết dòng hoặc có lệnh khác tới (trả về qua
                    // `pending`).
                    pending = hold(id, held, &mut rx).await;
                }
            }
            Cmd::Fetch(job) => {
                // Cursor còn mở được xử lý trong `hold`; tới đây nghĩa là không có.
                let _ = job.reply.send(Err(cursor_not_found()));
                reg.set_running(id, 0);
            }
            Cmd::TableRows(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
            Cmd::SchemaTree(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
            Cmd::TableInfo(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
        }
    }
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): `session` bị thả ở cuối hàm.
}

/// Kết quả của `execute`.
struct Executed {
    /// Kết quả từng lệnh. Lỗi cấp request (`Err`) chỉ dành cho huỷ.
    res: DbResult<Vec<StatementResult>>,
    /// Cursor của lệnh cuối còn document để actor giữ.
    held: Option<Held>,
}

/// Kết thúc của một lệnh trong `execute`.
enum Step {
    /// Chạy xong; lệnh cuối có thể trả cursor còn dòng.
    Continue(Option<Held>),
    /// Lệnh lỗi (đã ghi vào kết quả): các lệnh sau không chạy.
    Stop,
    /// Request bị huỷ.
    Cancelled(DbError),
}

/// Chạy lần lượt các lệnh trong `sql`, dừng ở lệnh lỗi đầu tiên (lỗi từng lệnh nằm trong
/// `StatementResult.error`, không làm hỏng cả request). Lỗi cú pháp ở lệnh thứ k thì k-1 lệnh
/// trước vẫn chạy.
async fn execute(
    session: &Session,
    sql: &str,
    limits: Limits,
    cancel: &CancelSignal,
    cursor_id: u64,
) -> Executed {
    let parsed = command::parse(sql);
    let count = parsed.commands.len();
    let mut out: Vec<StatementResult> = Vec::with_capacity(count + 1);
    let run = Run {
        limits,
        cancel,
        cursor_id,
    };
    for (index, mut cmd) in parsed.commands.into_iter().enumerate() {
        // Chỉ lệnh cuối (không có lỗi cú pháp theo sau) được giữ cursor.
        let keep = index + 1 == count && parsed.error.is_none();
        match statement(session, &mut cmd, index, &run, keep, &mut out).await {
            Step::Continue(held) if keep => {
                return Executed { res: Ok(out), held };
            }
            Step::Continue(_) => {}
            Step::Stop => {
                return Executed {
                    res: Ok(out),
                    held: None,
                };
            }
            Step::Cancelled(e) => {
                return Executed {
                    res: Err(e),
                    held: None,
                };
            }
        }
    }
    if let Some(e) = parsed.error {
        out.push(statement_error(count, &e.text, Instant::now(), e.message));
    }
    Executed {
        res: Ok(out),
        held: None,
    }
}

/// Tham số chung của mọi lệnh trong một request.
#[derive(Clone, Copy)]
struct Run<'a> {
    limits: Limits,
    cancel: &'a CancelSignal,
    cursor_id: u64,
}

/// Ghi lỗi của lệnh vào `out` (hoặc trả huỷ).
fn fail(
    out: &mut Vec<StatementResult>,
    index: usize,
    text: &str,
    start: Instant,
    e: DbError,
) -> Step {
    if e.code == CANCELLED {
        return Step::Cancelled(e);
    }
    out.push(statement_error(index, text, start, e.message));
    Step::Stop
}

/// Chạy một lệnh và ghi kết quả vào `out`. `keep` cho phép trả cursor (chỉ lệnh cuối).
async fn statement(
    session: &Session,
    cmd: &mut Command,
    index: usize,
    run: &Run<'_>,
    keep: bool,
    out: &mut Vec<StatementResult>,
) -> Step {
    let Run {
        limits,
        cancel,
        cursor_id,
    } = *run;
    let start = Instant::now();
    let text = std::mem::take(&mut cmd.text);
    let raw = match cmd.to_raw(limits.page_size) {
        Ok(raw) => raw,
        Err(message) => {
            out.push(statement_error(index, &text, start, message));
            return Step::Stop;
        }
    };
    let db = session
        .client
        .database(cmd.db.as_deref().unwrap_or(&session.db));

    match cmd.kind {
        Kind::Find | Kind::Cursor => {
            // `batch_size` là kích thước batch của các `getMore` sau (lệnh đầu đã được gắn
            // `batchSize` trong `to_raw`).
            let batch_size = u32::try_from(limits.page_size).unwrap_or(u32::MAX);
            let opened = drive(
                db.run_raw_cursor_command(raw)
                    .batch_size(batch_size)
                    .batch(),
                cancel,
            )
            .await;
            let cursor = match opened {
                Ok(cursor) => cursor,
                Err(e) => return fail(out, index, &text, start, e),
            };
            // Batch đầu nằm sẵn trong reply của lệnh mở cursor, nên mốc "có dòng đầu" là lúc này,
            // trước khi đổi cả trang sang JSON (cùng mốc với các driver khác).
            let first_row_ms = elapsed_ms(start);
            let mut held = Held::new(cursor_id, cursor);
            let page = match held.read_page(limits, cancel).await {
                Ok(page) => page,
                Err(e) => return fail(out, index, &text, start, e),
            };
            let keep_cursor = keep && !page.done;
            let mut res = rows_statement(
                index,
                text,
                document_column(),
                page,
                keep_cursor.then_some(cursor_id),
                start,
            );
            res.first_row_ms = Some(first_row_ms);
            out.push(res);
            // Còn dòng mà không giữ cursor: `held` bị thả ở cuối nhánh, crate tự `killCursors`.
            Step::Continue(keep_cursor.then_some(held))
        }
        Kind::Write => match drive(db.run_raw_command(raw), cancel).await {
            Ok(reply) => match written(&reply) {
                Ok(n) => {
                    out.push(affected_statement(index, text, n, start));
                    Step::Continue(None)
                }
                Err(message) => {
                    out.push(statement_error(index, &text, start, message));
                    Step::Stop
                }
            },
            Err(e) => fail(out, index, &text, start, e),
        },
        Kind::Plain => match drive(db.run_raw_command(raw), cancel).await {
            Ok(reply) => {
                let first_row_ms = elapsed_ms(start);
                match reply_row(&reply) {
                    Ok(json) => {
                        let mut builder = PageBuilder::new(limits);
                        builder.push(vec![Some(json)]);
                        let mut res = rows_statement(
                            index,
                            text,
                            document_column(),
                            builder.finish(true),
                            None,
                            start,
                        );
                        res.first_row_ms = Some(first_row_ms);
                        out.push(res);
                        Step::Continue(None)
                    }
                    Err(message) => {
                        out.push(statement_error(index, &text, start, message));
                        Step::Stop
                    }
                }
            }
            Err(e) => fail(out, index, &text, start, e),
        },
    }
}

/// Document trả lời của lệnh thường thành chuỗi Extended JSON cho dòng kết quả.
fn reply_row(reply: &Document) -> Result<String, String> {
    let raw = RawDocumentBuf::try_from(reply).map_err(|e| e.to_string())?;
    super::ejson::document_to_string(&raw).map_err(|e| e.to_string())
}

/// Số document bị ảnh hưởng của lệnh ghi, hoặc lỗi nếu server báo `writeErrors`/
/// `writeConcernError` (lệnh vẫn `ok: 1` nên crate không tự coi là lỗi).
fn written(reply: &Document) -> Result<i64, String> {
    let n = match reply.get("n") {
        Some(Bson::Int32(n)) => i64::from(*n),
        Some(Bson::Int64(n)) => *n,
        // Số thực của server rất cũ; làm tròn xuống, `as` bão hoà ở giá trị biên.
        Some(Bson::Double(n)) => *n as i64,
        _ => 0,
    };
    let first_error = |key: &str| {
        let item = match reply.get(key) {
            Some(Bson::Array(items)) => items.first(),
            other => other,
        };
        let Some(Bson::Document(err)) = item else {
            return None;
        };
        let message = err.get_str("errmsg").unwrap_or("unknown error");
        Some(match err.get("code") {
            Some(Bson::Int32(code)) => format!("{message} (code {code})"),
            _ => message.to_owned(),
        })
    };
    if let Some(e) = first_error("writeErrors") {
        return Err(format!("write error: {e}; {n} succeeded"));
    }
    if let Some(e) = first_error("writeConcernError") {
        return Err(format!("write concern error: {e}; {n} written"));
    }
    Ok(n)
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mongodb/actor.rs"]
mod tests;
