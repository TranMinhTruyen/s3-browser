//! Actor của một connection MySQL/MariaDB: nhận lệnh tuần tự, chạy từng câu SQL, giữ cursor
//! (result set của câu cuối còn dữ liệu) giữa các lệnh `fetch`.
//!
//! Vị trí trong luồng: `mysql::open` spawn `run` cho mỗi connection; `drivers::request` gửi
//! `Cmd` qua kênh `mpsc`; `run` chạy lệnh rồi trả kết quả qua kênh `oneshot` trong `Job`. Chỉ
//! actor này chạm vào `Conn` nên không cần khoá (giống `postgres::actor`).
//!
//! Mỗi câu chạy bằng `query_iter` (giao thức text) và trả `QueryResult`: đó chính là cursor,
//! mỗi trang đọc tiếp từ nó, không nạp cả kết quả vào RAM. Một câu có thể sinh nhiều result set
//! (`CALL` thủ tục có nhiều `SELECT`), mỗi set thành một `StatementResult` cùng `index`.
//!
//! Huỷ: `s3b_cancel` gọi `MySqlInterrupt` (mở connection phụ gửi `KILL QUERY`). Khác
//! `tokio-postgres`, các future của `mysql_async` KHÔNG an toàn nếu bị bỏ dở giữa chừng (thả
//! `query_iter` khi đang đọc mô tả cột làm gói tin sau đó bị hiểu sai), nên `drive` không bao giờ
//! thả future đang chạy: khi request bị huỷ nó chờ tiếp cho server kết thúc câu (sau `KILL`
//! là gần như tức thì). Quá hạn mà vẫn chưa xong thì đánh dấu connection hỏng.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Pin<&mut F>` / `std::pin::pin!`: giữ một future cố định tại chỗ trên stack để poll nhiều
//!   lần (và poll lại sau khi `select!` bỏ nhánh khác) mà không di chuyển hay thả nó.
//! - `now_or_never`: poll một future đúng một lần; có kết quả sẵn thì lấy, chưa thì bỏ qua (đường
//!   nhanh khi dòng đã nằm sẵn trong buffer, tránh tốn công đăng ký chờ).
//! - Lifetime `'c`: `QueryResult<'c, ..>` mượn `&'c mut Conn`, nên cursor không sống lâu hơn
//!   `Session` và compiler buộc ta không dùng `Conn` cho câu khác khi cursor còn đó.
//! - `tokio::select!`: chờ nhiều future cùng lúc, cái nào xong trước thắng, các cái còn lại bị bỏ.

use super::value::{Kind, column_kind, convert_row, type_name};
use super::{Shared, error_text, kill_query};
use crate::drivers::Cmd;
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, affected_statement, cancelled,
    cursor_not_found, hold, is_cancel_safe, millis_between, rows_statement, statement_error,
    track_tx,
};
use crate::drivers::split_sql::{Dialect, split};
use crate::protocol::{
    CANCELLED, CONN_NOT_FOUND, Column, DbError, DbResult, ExecuteResult, INVALID_REQUEST,
    SQL_ERROR, StatementResult,
};
use crate::registry::{self, CancelSignal};
use futures_util::FutureExt;
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, QueryResult, TextProtocol};
use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Đợi lệnh `COM_QUIT` gửi xong tối đa bao lâu khi đóng, quá hạn thì bỏ connection.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
/// Thời gian đọc bỏ nhanh phần còn lại của cursor trước khi quyết định `KILL` câu phía server.
const QUICK_DRAIN: Duration = Duration::from_millis(50);
/// Đọc bỏ phần dòng còn lại của cursor bị bỏ tối đa bao lâu (câu không huỷ được, ví dụ `CALL`
/// ghi dữ liệu, vẫn chạy hết phía server).
const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);
/// Sau khi request bị huỷ, chờ tối đa bao lâu cho server kết thúc câu đang chạy (đã bị `KILL`).
const CANCEL_GRACE: Duration = Duration::from_secs(10);

/// Connection đang mở cùng trạng thái cần để huỷ câu đang chạy.
pub struct Session {
    conn: Conn,
    shared: Arc<Shared>,
    /// Người dùng đang trong transaction tự mở (`BEGIN`...): khi bỏ cursor trong đó chỉ đọc bỏ
    /// chứ không `KILL`, cho nhất quán với PostgreSQL.
    in_tx: bool,
}

impl Session {
    pub fn new(conn: Conn, shared: Arc<Shared>) -> Self {
        Self {
            conn,
            shared,
            in_tx: false,
        }
    }
}

/// Lỗi của `mysql_async` thành `DbError`: `cancelled` nếu request bị huỷ (server báo "Query
/// execution was interrupted" sau `KILL`), ngược lại `sqlError` với thông báo của server.
fn db_error(e: &mysql_async::Error, cancel: &CancelSignal) -> DbError {
    if cancel.is_cancelled() {
        cancelled()
    } else {
        DbError::new(SQL_ERROR, error_text(e))
    }
}

/// Chạy `fut` tới khi xong. Request bị huỷ giữa chừng thì KHÔNG thả `fut` (xem đầu file) mà chờ
/// tối đa `CANCEL_GRACE` cho nó kết thúc rồi trả kết quả của nó: lỗi thì thành `cancelled`, còn
/// `Ok` (câu kịp xong trước `KILL`) thì giữ nguyên để người gọi không mất cursor đã mở; người
/// gọi tự kiểm cờ huỷ. Quá hạn thì đánh dấu connection hỏng. Lỗi "fatal" của thư viện (mạng đứt,
/// giao thức lệch, `LOAD DATA LOCAL` khi MariaDB đòi file...) cũng làm connection hỏng: các
/// lệnh sau báo "connection is broken" thay vì lỗi khó hiểu của thư viện.
async fn drive<T>(
    fut: impl Future<Output = mysql_async::Result<T>>,
    cancel: &CancelSignal,
    shared: &Shared,
) -> DbResult<T> {
    let fail = |e: mysql_async::Error| {
        if e.is_fatal() {
            shared.mark_broken();
        }
        db_error(&e, cancel)
    };
    let mut fut = pin!(fut);
    // Đường nhanh: dòng đã có trong buffer thì lấy luôn, không cần `select!`.
    // `as_mut()` mượn lại `Pin<&mut>` nên `now_or_never` không thả `fut`.
    if let Some(r) = fut.as_mut().now_or_never() {
        return r.map_err(fail);
    }
    tokio::select! {
        // `biased`: kiểm huỷ trước, để request đã huỷ không bị coi là thành công.
        biased;
        () = cancel.cancelled() => {}
        r = fut.as_mut() => return r.map_err(fail),
    }
    match tokio::time::timeout(CANCEL_GRACE, fut).await {
        Ok(r) => r.map_err(fail),
        Err(_) => {
            shared.mark_broken();
            Err(cancelled())
        }
    }
}

/// Đổi `u64` số dòng bị ảnh hưởng sang `i64` của giao thức, tràn thì lấy giá trị lớn nhất.
fn affected(n: u64) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

/// Cursor đang mở của một result set có dòng.
struct Held<'c> {
    cursor_id: u64,
    /// Kết quả đang đọc dở; `None` sau khi `abandon` lấy đi.
    qr: Option<QueryResult<'c, 'static, TextProtocol>>,
    /// Cách hiển thị từng cột của set này.
    kinds: Vec<Kind>,
    /// Huỷ phía server khi bỏ cursor còn dòng có an toàn không (xem `is_cancel_safe`).
    cancel_safe: bool,
    /// Đã đọc hết dòng của set này (hoặc set lỗi): không còn gì để đọc bỏ ngoài các set sau.
    finished: bool,
    /// Lúc nhận được phản hồi đầu tiên (dòng đầu hoặc kết thúc), cho `firstRowMs`.
    first_row_at: Option<Instant>,
    shared: Arc<Shared>,
}

impl Held<'_> {
    /// Đọc một trang, KHÔNG đánh dấu `busy` (người gọi lo: `statement` hoặc `next_page`).
    /// Khi bật `bench-timing`, thời gian chờ dòng và thời gian đổi ô được cộng vào `page`.
    async fn read_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        let mut page = PageBuilder::new(limits);
        let mut done = self.finished;
        while !done && !page.is_full() {
            if cancel.is_cancelled() {
                return Err(cancelled());
            }
            let Some(qr) = self.qr.as_mut() else { break };
            #[cfg(feature = "bench-timing")]
            let waited = Instant::now();
            let item = drive(qr.next(), cancel, &self.shared).await;
            #[cfg(feature = "bench-timing")]
            page.add_read(waited.elapsed());
            self.first_row_at.get_or_insert_with(Instant::now);
            match item {
                Ok(Some(row)) => {
                    #[cfg(feature = "bench-timing")]
                    let converting = Instant::now();
                    let cells = convert_row(row, &self.kinds);
                    #[cfg(feature = "bench-timing")]
                    page.add_convert(converting.elapsed());
                    page.push(cells);
                }
                Ok(None) => {
                    self.finished = true;
                    done = true;
                }
                Err(e) => {
                    // Lỗi của server hoặc mạng: set đã kết thúc, không còn gì để đọc bỏ.
                    self.finished = true;
                    return Err(e);
                }
            }
        }
        Ok(page.finish(done))
    }
}

/// `Held` là cursor của driver: mỗi trang đọc tiếp từ result set đang mở.
impl Cursor for Held<'_> {
    fn id(&self) -> u64 {
        self.cursor_id
    }

    async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        let shared = self.shared.clone();
        // `_op` giữ cờ `busy` bật tới hết hàm: trong lúc đó `s3b_cancel` mới `KILL` được.
        let _op = shared.begin(cancel)?;
        self.read_page(limits, cancel).await
    }

    /// Bỏ cursor: đọc bỏ phần còn lại (kể cả các result set sau) để connection yên tĩnh trước
    /// khi nhận lệnh kế tiếp, nếu không `mysql_async` sẽ làm việc đó (và báo lỗi nếu có) ở câu
    /// sau. Câu huỷ được (xem `is_cancel_safe`) mà chưa hết trong `QUICK_DRAIN` thì `KILL` rồi
    /// đọc tiếp. Đọc nhanh trước vì kết quả nhỏ đã nằm sẵn trong buffer: `KILL` lúc đó là thừa
    /// và có thể trúng lệnh kế tiếp.
    async fn abandon(mut self) {
        let Some(qr) = self.qr.take() else { return };
        if self.shared.is_broken() {
            return;
        }
        let mut drain = pin!(qr.drop_result());
        if !self.finished && self.cancel_safe {
            if tokio::time::timeout(QUICK_DRAIN, drain.as_mut())
                .await
                .is_ok()
            {
                return;
            }
            kill_query(&self.shared, None).await;
        }
        // Không thả `drain` giữa chừng (xem đầu file): quá hạn thì coi connection là hỏng.
        if tokio::time::timeout(DRAIN_TIMEOUT, drain).await.is_err() {
            self.shared.mark_broken();
        }
    }
}

/// Lỗi cho `method` chỉ SQLite hỗ trợ (cây đối tượng, thông tin table).
fn unsupported() -> DbError {
    DbError::new(INVALID_REQUEST, "method not supported by driver")
}

/// Vòng lặp của actor: nhận từng `Cmd` rồi chạy tới khi gặp `Close` hoặc kênh đóng.
/// Nhận `session` và `rx` theo giá trị (move): actor là chủ sở hữu duy nhất của chúng.
pub async fn run(id: u64, mut session: Session, mut rx: mpsc::Receiver<Cmd>) {
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
                shutdown(session).await;
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
                if session.shared.is_broken() {
                    reg.set_running(id, 0);
                    let _ = job.reply.send(Err(broken()));
                    continue;
                }
                next_cursor += 1;
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                let (res, held) = execute(
                    &mut session,
                    &job.params.sql,
                    limits,
                    &job.cancel,
                    next_cursor,
                )
                .await;
                // Gỡ `running` TRƯỚC khi trả lời: từ đây `cancel` không gọi interrupt nữa.
                reg.set_running(id, 0);
                let (res, held) = drop_if_cancelled(res, held, &job.cancel).await;
                let _ = job
                    .reply
                    .send(res.map(|statements| ExecuteResult { statements }));
                if let Some(held) = held {
                    // `hold` giữ cursor tới khi hết dòng hoặc có lệnh khác tới (trả về qua `pending`).
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
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): vẫn đóng connection cho sạch.
    shutdown(session).await;
}

/// Lỗi khi connection đã hỏng (xem `Shared::broken`): người dùng cần mở lại connection.
fn broken() -> DbError {
    DbError::new(CONN_NOT_FOUND, "connection is broken, reconnect")
}

/// Đóng connection: gửi `COM_QUIT` rồi đóng socket, quá hạn thì bỏ. Luôn gọi `disconnect` kể cả
/// khi connection hỏng: nó đặt cờ `disconnected` trước khi đọc, nên `Conn` bị thả sau đó không
/// spawn task `cleanup_for_pool` đọc bỏ không timeout (rò task và TCP).
async fn shutdown(session: Session) {
    let _ = tokio::time::timeout(CLOSE_TIMEOUT, session.conn.disconnect()).await;
}

/// Xử lý race giữa `s3b_cancel` và lúc request vừa đọc xong trang: `KILL` đã gửi đi có thể làm
/// cursor lỗi ở lần `fetch` sau (hoặc bị bỏ lỡ). Cờ huỷ đã bật mà còn giữ cursor thì bỏ cursor
/// ngay và trả `cancelled`. Gọi SAU `set_running(id, 0)`.
async fn drop_if_cancelled<'c, T>(
    res: DbResult<T>,
    held: Option<Held<'c>>,
    cancel: &CancelSignal,
) -> (DbResult<T>, Option<Held<'c>>) {
    match held {
        Some(held) if cancel.is_cancelled() => {
            held.abandon().await;
            (Err(cancelled()), None)
        }
        other => (res, other),
    }
}

/// Kết thúc của một câu trong `execute`.
enum Step {
    /// Câu chạy xong, chạy câu kế tiếp.
    Continue,
    /// Câu lỗi (đã ghi vào kết quả): các câu sau không chạy.
    Stop,
    /// Request bị huỷ.
    Cancelled(DbError),
}

/// Chạy lần lượt các câu trong `sql`, dừng ở câu lỗi đầu tiên (lỗi từng câu nằm trong
/// `StatementResult.error`, không làm hỏng cả request). Câu cuối có dòng còn dư thì trả cursor
/// để actor giữ; câu có dòng nhưng không phải câu cuối chỉ lấy trang đầu (`truncated`).
/// Lỗi cấp request (`Err`) chỉ dành cho huỷ.
///
/// Câu cuối tách khỏi vòng lặp vì chỉ câu đó mới trả cursor mượn `session.conn`: compiler không
/// cho trả một khoản mượn từ bên trong vòng lặp khi nó có thể còn sống sang vòng sau.
async fn execute<'s>(
    session: &'s mut Session,
    sql: &str,
    limits: Limits,
    cancel: &CancelSignal,
    cursor_id: u64,
) -> (DbResult<Vec<StatementResult>>, Option<Held<'s>>) {
    let ranges = split(Dialect::MySql, sql);
    let Some(last) = ranges.len().checked_sub(1) else {
        return (Ok(Vec::new()), None);
    };
    let mut out: Vec<StatementResult> = Vec::with_capacity(ranges.len());
    let run = Run {
        limits,
        cancel,
        cursor_id,
    };
    for (index, range) in ranges[..last].iter().enumerate() {
        let (step, _) = statement(session, &sql[range.clone()], index, &run, false, &mut out).await;
        match step {
            Step::Continue => {}
            Step::Stop => return (Ok(out), None),
            Step::Cancelled(e) => return (Err(e), None),
        }
    }
    let (step, held) = statement(
        session,
        &sql[ranges[last].clone()],
        last,
        &run,
        true,
        &mut out,
    )
    .await;
    match step {
        Step::Continue | Step::Stop => (Ok(out), held),
        Step::Cancelled(e) => (Err(e), held),
    }
}

/// Tham số chung của mọi câu trong một request.
struct Run<'a> {
    limits: Limits,
    cancel: &'a CancelSignal,
    cursor_id: u64,
}

/// Chạy một câu và ghi kết quả (mỗi result set một `StatementResult`) vào `out`. `keep` cho
/// phép trả cursor (chỉ câu cuối).
async fn statement<'s>(
    session: &'s mut Session,
    text: &str,
    index: usize,
    run: &Run<'_>,
    keep: bool,
    out: &mut Vec<StatementResult>,
) -> (Step, Option<Held<'s>>) {
    let cancel = run.cancel;
    let start = Instant::now();

    // Cancel an toàn hay không phụ thuộc trạng thái transaction TRƯỚC câu này.
    let cancel_safe = !session.in_tx && is_cancel_safe(text);
    track_tx(&mut session.in_tx, text);
    let shared = session.shared.clone();
    let op = match shared.begin(cancel) {
        Ok(op) => op,
        Err(e) => return (Step::Cancelled(e), None),
    };
    let mut qr = match drive(session.conn.query_iter(text.to_owned()), cancel, &shared).await {
        Ok(qr) => qr,
        Err(e) if e.code == CANCELLED => return (Step::Cancelled(e), None),
        Err(e) => {
            out.push(statement_error(index, text, start, e.message));
            return (Step::Stop, None);
        }
    };

    // Mỗi vòng xử lý một result set. Set không có dòng (`UPDATE`...) thành `affected`; set có
    // dòng thành `rows`. `CALL` thủ tục kết thúc bằng một gói OK không có dòng: bỏ qua nếu
    // trước đó câu đã có set có dòng.
    let mut produced_rows = false;
    loop {
        let columns: Vec<Column> = qr
            .columns_ref()
            .iter()
            .map(|c| Column {
                name: c.name_str().into_owned(),
                ty: type_name(c).to_owned(),
            })
            .collect();
        if columns.is_empty() {
            let last_set = qr.is_empty();
            if !produced_rows {
                let n = affected(qr.affected_rows());
                out.push(affected_statement(index, text.to_owned(), n, start));
            }
            if last_set {
                break;
            }
            // Sang set kế tiếp (`next` trả `None` vì set này không có dòng).
            if let Err(e) = drive(qr.next(), cancel, &shared).await {
                return (fail(out, index, text, start, e), None);
            }
            continue;
        }

        produced_rows = true;
        let kinds = qr.columns_ref().iter().map(column_kind).collect();
        let mut held = Held {
            cursor_id: run.cursor_id,
            qr: Some(qr),
            kinds,
            cancel_safe,
            finished: false,
            first_row_at: None,
            shared: shared.clone(),
        };
        match held.read_page(run.limits, cancel).await {
            Ok(page) => {
                let done = page.done;
                let keep_cursor = keep && !done;
                let mut res = rows_statement(
                    index,
                    text.to_owned(),
                    columns,
                    page,
                    keep_cursor.then_some(run.cursor_id),
                    start,
                );
                res.first_row_ms = held.first_row_at.map(|t| millis_between(start, t));
                out.push(res);
                if keep_cursor {
                    drop(op);
                    return (Step::Continue, Some(held));
                }
                // Hết dòng: lấy lại `QueryResult` để đọc các set sau. Còn dòng (kết quả bị cắt):
                // bỏ cả câu, các set sau không được đọc.
                if !held.finished {
                    held.abandon().await;
                    return (Step::Continue, None);
                }
                match held.qr.take() {
                    Some(next) => qr = next,
                    None => return (Step::Continue, None),
                }
                if qr.is_empty() {
                    break;
                }
            }
            // Lỗi của server/mạng: set đã kết thúc (`finished`), thả `held` là đủ.
            Err(e) => {
                if e.code == CANCELLED {
                    held.abandon().await;
                }
                return (fail(out, index, text, start, e), None);
            }
        }
    }

    // Đọc nốt phần còn lại (gói OK cuối của `CALL`, hoặc lỗi nằm ở set cuối) để không rơi vào
    // câu sau.
    match drive(qr.drop_result(), cancel, &shared).await {
        Ok(()) => (Step::Continue, None),
        Err(e) if e.code == CANCELLED => (Step::Cancelled(e), None),
        Err(e) => {
            out.push(statement_error(index, text, start, e.message));
            (Step::Stop, None)
        }
    }
}

/// Ghi lỗi của câu vào `out` (hoặc trả huỷ).
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

#[cfg(test)]
mod tests {
    use super::*;
    use mysql_async::{DriverError, Opts, ServerError};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use tokio::runtime::Handle;

    /// `Shared` không nối tới đâu cả: `drive` chỉ dùng cờ `broken`.
    fn shared() -> Shared {
        Shared {
            kill_opts: Opts::default(),
            thread_id: 1,
            seq: AtomicU64::new(0),
            busy: AtomicBool::new(false),
            broken: AtomicBool::new(false),
            handle: Handle::current(),
        }
    }

    fn server_error(code: u16, message: &str) -> mysql_async::Error {
        mysql_async::Error::Server(ServerError {
            code,
            state: "HY000".into(),
            message: message.into(),
        })
    }

    /// Lỗi "fatal" của thư viện (connection không dùng tiếp được).
    fn fatal_error() -> mysql_async::Error {
        mysql_async::Error::Driver(DriverError::ConnectionClosed)
    }

    // ---- db_error ----

    #[test]
    fn db_error_is_sql_error_with_the_server_text_when_not_cancelled() {
        let cancel = CancelSignal::new();
        let e = db_error(
            &server_error(1064, "You have an error in your SQL syntax"),
            &cancel,
        );
        assert_eq!(e.code, SQL_ERROR);
        assert_eq!(
            e.message,
            "ERROR 1064 (HY000): You have an error in your SQL syntax"
        );
    }

    #[test]
    fn db_error_is_cancelled_once_the_request_was_cancelled() {
        let cancel = CancelSignal::new();
        cancel.cancel();
        // Sau KILL QUERY server báo 1317 "Query execution was interrupted": thành `cancelled`.
        let e = db_error(
            &server_error(1317, "Query execution was interrupted"),
            &cancel,
        );
        assert_eq!(e.code, CANCELLED);
        assert_eq!(e.message, cancelled().message);
        assert!(!e.message.contains("1317"));
    }

    #[test]
    fn db_error_of_a_driver_error_uses_its_display_text() {
        let cancel = CancelSignal::new();
        let e = db_error(&fatal_error(), &cancel);
        assert_eq!(e.code, SQL_ERROR);
        assert_eq!(e.message, fatal_error().to_string());
        assert!(!e.message.is_empty());
    }

    #[test]
    fn db_error_of_an_io_error_has_a_single_prefix() {
        let cancel = CancelSignal::new();
        let io = mysql_async::Error::Io(mysql_async::IoError::Io(std::io::Error::other("reset")));
        let e = db_error(&io, &cancel);
        assert_eq!(e.message, "Input/output error: reset");
    }

    // ---- drive ----

    #[tokio::test]
    async fn drive_returns_a_ready_value_without_touching_the_flags() {
        let s = shared();
        let cancel = CancelSignal::new();
        let r = drive(async { Ok::<_, mysql_async::Error>(7) }, &cancel, &s).await;
        assert_eq!(r.unwrap(), 7);
        assert!(!s.is_broken());
    }

    #[tokio::test]
    async fn drive_maps_a_server_error_without_marking_the_connection_broken() {
        let s = shared();
        let cancel = CancelSignal::new();
        let r = drive(
            async { Err::<(), _>(server_error(1146, "no table")) },
            &cancel,
            &s,
        )
        .await;
        let e = r.unwrap_err();
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.starts_with("ERROR 1146"), "{}", e.message);
        assert!(!s.is_broken(), "lỗi của server không làm hỏng connection");
    }

    #[tokio::test]
    async fn drive_marks_the_connection_broken_on_a_fatal_error() {
        let s = shared();
        let cancel = CancelSignal::new();
        let e = drive(async { Err::<(), _>(fatal_error()) }, &cancel, &s)
            .await
            .unwrap_err();
        assert_eq!(e.code, SQL_ERROR);
        assert!(s.is_broken());
    }

    #[tokio::test]
    async fn drive_waits_for_a_future_that_needs_more_than_one_poll() {
        let s = shared();
        let cancel = CancelSignal::new();
        let r = drive(
            async {
                tokio::task::yield_now().await;
                Ok::<_, mysql_async::Error>("done")
            },
            &cancel,
            &s,
        )
        .await;
        assert_eq!(r.unwrap(), "done");
    }

    #[tokio::test]
    async fn drive_on_a_cancelled_request_still_lets_the_future_finish() {
        // Không thả future giữa chừng: huỷ xong thì chờ nó kết thúc rồi mới trả.
        let s = shared();
        let cancel = CancelSignal::new();
        cancel.cancel();
        let r = drive(
            async {
                tokio::task::yield_now().await;
                Ok::<_, mysql_async::Error>(1)
            },
            &cancel,
            &s,
        )
        .await;
        assert_eq!(r.unwrap(), 1, "câu kịp xong thì giữ nguyên kết quả");
        assert!(!s.is_broken());
    }

    #[tokio::test]
    async fn drive_turns_the_error_of_a_cancelled_request_into_cancelled() {
        let s = shared();
        let cancel = CancelSignal::new();
        cancel.cancel();
        let e = drive(
            async {
                tokio::task::yield_now().await;
                Err::<(), _>(server_error(1317, "Query execution was interrupted"))
            },
            &cancel,
            &s,
        )
        .await
        .unwrap_err();
        assert_eq!(e.code, CANCELLED);
        assert!(
            !s.is_broken(),
            "server báo gọn thì connection còn dùng được"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn drive_gives_up_after_the_grace_period_and_marks_the_connection_broken() {
        let s = shared();
        let cancel = CancelSignal::new();
        cancel.cancel();
        // Future không bao giờ xong: đồng hồ ảo nhảy tới hết `CANCEL_GRACE`.
        let e = drive(
            std::future::pending::<mysql_async::Result<()>>(),
            &cancel,
            &s,
        )
        .await
        .unwrap_err();
        assert_eq!(e.code, CANCELLED);
        assert!(s.is_broken());
    }

    #[tokio::test(start_paused = true)]
    async fn drive_keeps_the_result_when_the_cancel_arrives_while_waiting() {
        let s = shared();
        let cancel = Arc::new(CancelSignal::new());
        let trigger = cancel.clone();
        let canceller = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            trigger.cancel();
        });
        let fut = async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            Ok::<_, mysql_async::Error>(5)
        };
        // Huỷ lúc giây 1, future xong ở giây 3 (< CANCEL_GRACE): kết quả được giữ.
        assert_eq!(drive(fut, &cancel, &s).await.unwrap(), 5);
        canceller.await.unwrap();
        assert!(!s.is_broken());
    }

    // ---- shutdown ----

    /// Giá trị `KEY=value` trong `test-env/db/db.env`.
    fn env_value(key: &str) -> Option<String> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-env/db/db.env");
        let text = std::fs::read_to_string(path).ok()?;
        text.lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    }

    /// Opts tới server test (`port_key` = `MYSQL_PORT`/`MARIADB_PORT`); thiếu server thì
    /// `S3B_REQUIRE_DB=1` fail, ngược lại in `SKIP` và trả `None`.
    fn server_opts(port_key: &str, user_key: &str) -> Option<Opts> {
        let port = env_value(port_key).and_then(|p| p.parse::<u16>().ok());
        let password = std::env::var("S3B_MYSQL_PASSWORD")
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| env_value("DB_PASSWORD"));
        let reachable = port.is_some_and(|p| {
            std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([127, 0, 0, 1], p)),
                Duration::from_millis(800),
            )
            .is_ok()
        });
        let (Some(port), Some(password), true) = (port, password, reachable) else {
            let msg = format!("SKIP shutdown {port_key}: chưa có server/mật khẩu test-env");
            assert!(
                !std::env::var("S3B_REQUIRE_DB").is_ok_and(|v| v == "1"),
                "{msg}"
            );
            eprintln!("{msg}");
            return None;
        };
        Some(
            mysql_async::OptsBuilder::default()
                .ip_or_hostname("127.0.0.1")
                .tcp_port(port)
                .user(env_value(user_key).or_else(|| Some("root".into())))
                .pass(Some(password))
                .into(),
        )
    }

    /// Số connection server đã đếm là "đóng không đàng hoàng" (`Aborted_clients`): `disconnect`
    /// gửi `COM_QUIT` nên không tăng, thả `Conn` thô (đóng socket) thì tăng.
    async fn aborted_clients(monitor: &mut Conn) -> u64 {
        let (_, v): (String, String) = monitor
            .query_first("show global status like 'Aborted_clients'")
            .await
            .unwrap()
            .unwrap();
        v.parse().unwrap()
    }

    /// B4: connection đã `broken` thì `shutdown` vẫn phải `disconnect` (gửi `COM_QUIT`) chứ không
    /// thả `Conn` thô, vì `Drop` của `mysql_async` khi `disconnected=false` spawn `cleanup_for_pool`
    /// đọc bỏ không timeout. Quan sát phía server: thread biến mất mà không bị tính là aborted.
    async fn shutdown_of_a_broken_connection_quits_cleanly(port_key: &str, user_key: &str) {
        let Some(opts) = server_opts(port_key, user_key) else {
            return;
        };
        let mut monitor = Conn::new(opts.clone()).await.unwrap();
        let victim = Conn::new(opts).await.unwrap();
        let tid = victim.id();
        let before = aborted_clients(&mut monitor).await;

        let shared = Arc::new(shared());
        shared.mark_broken();
        assert!(shared.is_broken());
        let started = Instant::now();
        shutdown(Session::new(victim, shared)).await;
        assert!(
            started.elapsed() < CLOSE_TIMEOUT,
            "shutdown phải xong trong hạn đóng"
        );

        // Thread phía server biến mất (thăm dò theo điều kiện, không ngủ cố định).
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let n: u64 = monitor
                .query_first(format!(
                    "select count(*) from information_schema.processlist where id = {tid}"
                ))
                .await
                .unwrap()
                .unwrap();
            if n == 0 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "thread {tid} vẫn còn trên server"
            );
            tokio::task::yield_now().await;
        }
        assert_eq!(
            aborted_clients(&mut monitor).await,
            before,
            "shutdown phải gửi COM_QUIT (disconnect), không thả socket thô"
        );
        monitor.disconnect().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn shutdown_of_a_broken_mysql_connection_quits_cleanly() {
        shutdown_of_a_broken_connection_quits_cleanly("MYSQL_PORT", "MYSQL_USER").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn shutdown_of_a_broken_mariadb_connection_quits_cleanly() {
        shutdown_of_a_broken_connection_quits_cleanly("MARIADB_PORT", "MARIADB_USER").await;
    }

    // ---- hàm nhỏ ----

    #[test]
    fn affected_saturates_instead_of_wrapping() {
        assert_eq!(affected(0), 0);
        assert_eq!(affected(5), 5);
        assert_eq!(affected(i64::MAX as u64), i64::MAX);
        assert_eq!(affected(u64::MAX), i64::MAX);
    }

    #[test]
    fn broken_and_unsupported_errors_have_stable_codes() {
        let b = broken();
        assert_eq!(b.code, CONN_NOT_FOUND);
        assert!(b.message.contains("broken"));
        let u = unsupported();
        assert_eq!(u.code, INVALID_REQUEST);
        assert_eq!(u.message, "method not supported by driver");
    }

    #[test]
    fn fail_records_a_statement_error_and_stops() {
        let mut out = Vec::new();
        let step = fail(
            &mut out,
            2,
            "select x",
            Instant::now(),
            DbError::new(SQL_ERROR, "boom"),
        );
        assert!(matches!(step, Step::Stop));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].index, 2);
        assert_eq!(out[0].sql, "select x");
        assert_eq!(out[0].error.as_ref().unwrap().message, "boom");
    }

    #[test]
    fn fail_on_a_cancelled_error_returns_cancelled_without_a_statement() {
        let mut out = Vec::new();
        let step = fail(&mut out, 0, "select 1", Instant::now(), cancelled());
        assert!(matches!(step, Step::Cancelled(e) if e.code == CANCELLED));
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn drop_if_cancelled_without_a_cursor_passes_the_result_through() {
        let cancel = CancelSignal::new();
        let (res, held) = drop_if_cancelled::<u8>(Ok(3), None, &cancel).await;
        assert_eq!(res.unwrap(), 3);
        assert!(held.is_none());
        cancel.cancel();
        // Đã huỷ nhưng không giữ cursor nào: kết quả không bị đổi.
        let (res, held) = drop_if_cancelled::<u8>(Ok(4), None, &cancel).await;
        assert_eq!(res.unwrap(), 4);
        assert!(held.is_none());
    }
}
