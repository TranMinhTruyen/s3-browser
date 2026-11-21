//! Actor của một connection SQL Server: nhận lệnh tuần tự, chạy từng batch SQL, giữ cursor
//! (result set của batch cuối còn dữ liệu) giữa các lệnh `fetch`.
//!
//! Vị trí trong luồng: `sqlserver::open` spawn `run` cho mỗi connection; `drivers::request` gửi
//! `Cmd` qua kênh `mpsc`; `run` chạy lệnh rồi trả kết quả qua kênh `oneshot` trong `Job`. Chỉ
//! actor này chạm vào `Client` nên không cần khoá (giống `postgres::actor`, `mysql::actor`).
//!
//! Mỗi batch chạy bằng `simple_query` và trả `QueryStream`: một dòng chảy gồm `Metadata` (mô tả
//! cột của một result set) rồi các `Row`, lặp lại cho từng result set. Stream chính là cursor:
//! mỗi trang đọc tiếp từ nó, không nạp cả kết quả vào RAM. `GO` do ta tách (`split_sql`), vì
//! `GO` không phải lệnh T-SQL mà là dấu phân cách của công cụ như `sqlcmd`/SSMS.
//!
//! Điều cần biết về `tiberius`:
//! - Lỗi của server (`RAISERROR`, `1/0`, bảng không tồn tại...) KHÔNG nằm trong dòng chảy mà
//!   hiện ra ở cuối stream dưới dạng `Err(Server)`, khi cả batch đã được đọc hết. Nên connection
//!   vẫn sạch sau lỗi kiểu này. Lỗi khác (mạng, giao thức) làm connection hỏng.
//! - Số dòng bị ảnh hưởng (`UPDATE`...) bị `tiberius` bỏ đi. Với batch không có result set ta hỏi
//!   thêm `SELECT @@ROWCOUNT` (một vòng mạng nữa), kết quả là của câu cuối trong batch.
//! - Thả `Client` hay stream khi đang đọc dở giữa một token làm connection lệch pha. Vì vậy mọi
//!   chỗ phải bỏ dở (huỷ, quá hạn, bỏ cursor) đều bật cờ `stale`, và actor nối lại connection mới
//!   (xem `Session::release_if_stale`). Đó cũng là cách huỷ (Q23=A): đóng TCP thì server dừng câu
//!   đang chạy và rollback transaction.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Pin<&mut F>` / `std::pin::pin!`: giữ một future cố định tại chỗ trên stack để poll nhiều
//!   lần (và poll lại sau khi `select!` bỏ nhánh khác) mà không di chuyển nó.
//! - `now_or_never`: poll một future đúng một lần; có kết quả sẵn thì lấy, chưa thì bỏ qua (đường
//!   nhanh khi dòng đã nằm sẵn trong buffer, tránh tốn công đăng ký chờ).
//! - Lifetime `'s`: `QueryStream<'s>` mượn `&'s mut Client`, nên cursor không sống lâu hơn
//!   `Session` và compiler buộc ta không dùng `Client` cho câu khác khi cursor còn đó. Vì cùng lý
//!   do, ở chỗ nào còn một `Held` sống thì không được đụng vào `Session` (xem `run`).
//! - `AtomicBool`: cờ đọc/ghi được từ nhiều chỗ không cần khoá (`Held` và `Session` cùng giữ).
//! - `tokio::select!`: chờ nhiều future cùng lúc, cái nào xong trước thắng, các cái còn lại bị bỏ.

use super::value::{Kind, column_kinds, convert_row, protocol_columns};
use super::{Conn, StaleFlag, error_text, reconnect};
use crate::drivers::Cmd;
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, affected_statement, cancelled,
    cursor_not_found, has_write_keyword, hold, is_cancel_safe, millis_between, rows_statement,
    statement_error, track_tx, words,
};
use crate::drivers::split_sql::{Dialect, split};
use crate::protocol::{
    CANCELLED, DbError, DbResult, ExecuteResult, INVALID_REQUEST, OPEN_FAILED, SQL_ERROR,
    StatementResult,
};
use crate::registry::{self, CancelSignal};
use futures_util::{FutureExt, TryStreamExt};
use std::future::Future;
use std::pin::pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tiberius::error::Error as TdsError;
use tiberius::{Config, QueryItem, QueryStream, ResultMetadata};
use tokio::sync::mpsc;

/// Thời gian đọc bỏ nhanh phần còn lại của cursor trước khi quyết định bỏ connection.
const QUICK_DRAIN: Duration = Duration::from_millis(50);
/// Đọc bỏ phần còn lại của cursor bị bỏ tối đa bao lâu khi không được phép huỷ (đang trong
/// transaction hoặc câu có thể ghi dữ liệu); quá hạn thì bỏ connection (mất transaction).
const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);
/// Chờ `SELECT @@ROWCOUNT` tối đa bao lâu; quá hạn thì không báo số dòng và nối lại connection.
const COUNT_TIMEOUT: Duration = Duration::from_secs(5);

/// Connection đang mở cùng trạng thái cần để dùng lại hoặc nối lại nó.
pub struct Session {
    /// `None` sau khi bị bỏ (stale) và chưa nối lại.
    client: Option<Conn>,
    /// `Config` đã nối thành công (kể cả mode TLS đã chọn), dùng để nối lại.
    config: Config,
    /// Người dùng đang trong transaction tự mở (`BEGIN TRAN`...): khi bỏ cursor trong đó chỉ đọc
    /// bỏ chứ không huỷ, cho nhất quán với PostgreSQL và MySQL.
    in_tx: bool,
    /// Bật khi `client` không dùng tiếp được (xem đầu file).
    stale: StaleFlag,
    /// Bật cùng `stale` khi cursor bị bỏ mà KHÔNG phải do người dùng huỷ (xem `Held::abandon`).
    lost: StaleFlag,
    /// `client` vừa bị bỏ vì `lost`: lần nối lại kế tiếp phải báo mất trạng thái phiên thay vì
    /// lặng lẽ chạy câu tiếp trên database mặc định.
    reset_notice: bool,
    /// Phiên hiện tại đã chạy batch đổi trạng thái phiên (`USE`, `SET`, `#temp`, `BEGIN TRAN`,
    /// `sp_...`). Chỉ khi đó việc bỏ connection mới làm mất gì đó đáng báo cho người dùng.
    dirty: bool,
}

impl Session {
    pub fn new(client: Conn, config: Config) -> Self {
        Self {
            client: Some(client),
            config,
            in_tx: false,
            stale: StaleFlag::default(),
            lost: StaleFlag::default(),
            reset_notice: false,
            dirty: false,
        }
    }

    /// Bỏ connection nếu cờ `stale` đang bật. Thả `Client` là đóng TCP: server dừng câu đang
    /// chạy và rollback transaction đang mở (nên `in_tx` về `false`). Chỉ gọi khi không còn
    /// stream nào mượn `client`.
    fn release_if_stale(&mut self) {
        if self.stale.swap(false, Ordering::AcqRel) {
            self.client = None;
            self.in_tx = false;
            // Huỷ do người dùng thì họ đã biết (Q23=A); bỏ cursor thì chỉ phải báo khi phiên đã
            // có trạng thái bị mất, còn không thì nối lại im lặng.
            if self.lost.swap(false, Ordering::AcqRel) && self.dirty {
                self.reset_notice = true;
            }
            // Phiên mới bắt đầu sạch.
            self.dirty = false;
        }
    }

    /// Bảo đảm có connection dùng được, nối lại nếu vừa bỏ. Trạng thái phiên (`USE <db>`, `SET`,
    /// bảng `#temp`, transaction) của connection cũ đã mất. Nếu connection bị bỏ vì bỏ cursor
    /// (không phải huỷ) mà phiên đã có trạng thái (`dirty`) thì nối lại xong vẫn trả `sqlError`
    /// một lần để câu của request này không chạy nhầm trên database mặc định; phiên không có
    /// trạng thái thì chạy câu kế tiếp bình thường.
    async fn ensure_connected(&mut self, cancel: &CancelSignal) -> DbResult<()> {
        self.release_if_stale();
        if self.client.is_some() {
            return Ok(());
        }
        let conn = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(cancelled()),
            r = reconnect(&self.config) => r.map_err(|e| {
                DbError::new(OPEN_FAILED, format!("reconnect failed: {}", e.message))
            })?,
        };
        self.client = Some(conn);
        if std::mem::take(&mut self.reset_notice) {
            return Err(DbError::new(
                SQL_ERROR,
                "connection was reset (session state lost: database, #temp, SET); run again",
            ));
        }
        Ok(())
    }
}

/// Lỗi của `tiberius` thành `DbError`. Lỗi của server (stream đã đọc hết) thì connection còn
/// dùng được; lỗi khác (mạng, giao thức) thì bật `stale`.
fn db_error(e: &TdsError, stale: &AtomicBool) -> DbError {
    if !matches!(e, TdsError::Server(_)) {
        stale.store(true, Ordering::Release);
    }
    DbError::new(SQL_ERROR, error_text(e))
}

/// Chạy `fut` (một lần đọc/gửi của `tiberius`) tới khi xong. Request bị huỷ giữa chừng thì thả
/// `fut`, đánh dấu connection `stale` (bỏ dở giữa token làm nó lệch pha) và trả `cancelled`.
async fn drive<T>(
    fut: impl Future<Output = Result<T, TdsError>>,
    cancel: &CancelSignal,
    stale: &AtomicBool,
) -> DbResult<T> {
    let fail = |e: TdsError| {
        if cancel.is_cancelled() {
            stale.store(true, Ordering::Release);
            cancelled()
        } else {
            db_error(&e, stale)
        }
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
        () = cancel.cancelled() => {
            stale.store(true, Ordering::Release);
            Err(cancelled())
        }
        r = fut.as_mut() => r.map_err(fail),
    }
}

/// Đọc hết stream (bỏ dữ liệu). Lỗi mạng làm connection `stale`; lỗi server thì stream đã hết.
async fn drain(stream: &mut QueryStream<'_>, stale: &AtomicBool) {
    loop {
        match stream.try_next().await {
            Ok(Some(_)) => {}
            Ok(None) => return,
            Err(e) => {
                db_error(&e, stale);
                return;
            }
        }
    }
}

/// Cursor đang mở của một result set có dòng.
struct Held<'s> {
    cursor_id: u64,
    /// Stream đang đọc dở; `None` sau khi trao đi hoặc `abandon`.
    stream: Option<QueryStream<'s>>,
    /// Cách hiển thị từng cột của set này.
    kinds: Vec<Kind>,
    /// Huỷ phía server khi bỏ cursor còn dòng có an toàn không (xem `is_cancel_safe`).
    cancel_safe: bool,
    /// Đã đọc hết dòng của set này.
    finished: bool,
    /// Stream đã hết hẳn (hoặc lỗi): không còn gì để đọc bỏ.
    eof: bool,
    /// Mô tả cột của result set kế tiếp nếu set này kết thúc vì gặp nó.
    next_meta: Option<ResultMetadata>,
    /// Lỗi của server nằm ở cuối stream (xem đầu file). Nếu trang đang đọc đã có dòng thì giao
    /// trang trước, giữ lỗi ở đây để lần đọc sau (hoặc `statement`) báo, khỏi mất dòng.
    pending_error: Option<DbError>,
    /// Lúc nhận được phản hồi đầu tiên (dòng đầu hoặc kết thúc), cho `firstRowMs`.
    first_row_at: Option<Instant>,
    stale: StaleFlag,
    /// Xem `Session::lost`.
    lost: StaleFlag,
}

impl Held<'_> {
    /// Đọc một trang. Khi bật `bench-timing`, thời gian chờ dòng và thời gian đổi ô được cộng
    /// vào `page`.
    async fn read_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        if let Some(e) = self.pending_error.take() {
            return Err(e);
        }
        let mut page = PageBuilder::new(limits);
        let mut done = self.finished;
        let mut rows = 0usize;
        while !done && !page.is_full() {
            if cancel.is_cancelled() {
                // Stream đang dở giữa set: bỏ connection để server dừng câu.
                self.stale.store(true, Ordering::Release);
                return Err(cancelled());
            }
            let Some(stream) = self.stream.as_mut() else {
                break;
            };
            #[cfg(feature = "bench-timing")]
            let waited = Instant::now();
            let item = drive(stream.try_next(), cancel, &self.stale).await;
            #[cfg(feature = "bench-timing")]
            page.add_read(waited.elapsed());
            self.first_row_at.get_or_insert_with(Instant::now);
            match item {
                Ok(Some(QueryItem::Row(row))) => {
                    #[cfg(feature = "bench-timing")]
                    let converting = Instant::now();
                    let cells = convert_row(row, &self.kinds);
                    #[cfg(feature = "bench-timing")]
                    page.add_convert(converting.elapsed());
                    page.push(cells);
                    rows += 1;
                }
                // `Metadata` giữa stream = set này hết, set mới bắt đầu.
                Ok(Some(QueryItem::Metadata(meta))) => {
                    self.next_meta = Some(meta);
                    self.finished = true;
                    done = true;
                }
                Ok(None) => {
                    self.finished = true;
                    self.eof = true;
                    done = true;
                }
                Err(e) => {
                    // Lỗi của server hoặc mạng: stream đã hết (hoặc connection đã `stale`).
                    self.finished = true;
                    self.eof = true;
                    if rows == 0 || e.code == CANCELLED {
                        return Err(e);
                    }
                    self.pending_error = Some(e);
                    return Ok(page.finish(false));
                }
            }
        }
        Ok(page.finish(done))
    }
}

/// `Held` là cursor của driver: mỗi trang đọc tiếp từ stream đang mở.
impl Cursor for Held<'_> {
    fn id(&self) -> u64 {
        self.cursor_id
    }

    async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        self.read_page(limits, cancel).await
    }

    /// Bỏ cursor: đọc bỏ phần còn lại (kể cả các result set sau) để connection yên tĩnh trước
    /// lệnh kế tiếp. Câu huỷ được (xem `is_cancel_safe`, ngoài transaction) mà chưa hết trong
    /// `QUICK_DRAIN` thì bỏ connection (đóng TCP, nối lại ở lệnh sau): nhanh hơn chờ server gửi
    /// hết dòng. Đọc nhanh trước vì kết quả nhỏ đã nằm sẵn trong buffer: bỏ connection lúc đó
    /// là thừa. Thả `next()` khi hết hạn là an toàn (chỉ thả future mượn stream, trạng thái đọc
    /// dở vẫn nằm trong stream), nên câu không huỷ được cứ đọc tiếp.
    async fn abandon(mut self) {
        let Some(mut stream) = self.stream.take() else {
            return;
        };
        if self.eof || self.stale.load(Ordering::Acquire) {
            return;
        }
        let stale = &*self.stale;
        if tokio::time::timeout(QUICK_DRAIN, drain(&mut stream, stale))
            .await
            .is_ok()
        {
            return;
        }
        if self.cancel_safe {
            self.stale.store(true, Ordering::Release);
            self.lost.store(true, Ordering::Release);
            return;
        }
        if tokio::time::timeout(DRAIN_TIMEOUT, drain(&mut stream, stale))
            .await
            .is_err()
        {
            self.stale.store(true, Ordering::Release);
            self.lost.store(true, Ordering::Release);
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
                // Thả `Session` là đóng TCP (không gửi TDS logout; server tự dọn phiên).
                drop(session);
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
                // Khối riêng để `held` (mượn `session`) hết hiệu lực trước `release_if_stale`.
                {
                    let Executed {
                        mut res,
                        held,
                        count,
                    } = execute(
                        &mut session,
                        &job.params.sql,
                        limits,
                        &job.cancel,
                        next_cursor,
                    )
                    .await;
                    // Batch cuối không có result set: hỏi số dòng ảnh hưởng. `held` chắc chắn là
                    // `None` ở đây; `drop` tường minh để khoản mượn `session` kết thúc sớm.
                    let held = if count {
                        drop(held);
                        if let Ok(statements) = res.as_mut()
                            && let Err(e) = patch_count(&mut session, statements, &job.cancel).await
                        {
                            res = Err(e);
                        }
                        None
                    } else {
                        held
                    };
                    // Gỡ `running` TRƯỚC khi trả lời: từ đây `cancel` không còn tác dụng.
                    reg.set_running(id, 0);
                    let (res, held) = drop_if_cancelled(res, held, &job.cancel).await;
                    let _ = job
                        .reply
                        .send(res.map(|statements| ExecuteResult { statements }));
                    if let Some(held) = held {
                        // `hold` giữ cursor tới khi hết dòng hoặc có lệnh khác tới (trả về qua
                        // `pending`).
                        pending = hold(id, held, &mut rx).await;
                    }
                }
                // Connection bị bỏ dở (huỷ, quá hạn...): đóng ngay để server dừng câu đang chạy.
                session.release_if_stale();
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
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): `session` bị thả ở cuối hàm, đóng TCP.
}

/// Xử lý race giữa `s3b_cancel` và lúc request vừa đọc xong trang: cờ huỷ đã bật mà còn giữ
/// cursor thì bỏ cursor ngay và trả `cancelled`. Gọi SAU `set_running(id, 0)`.
async fn drop_if_cancelled<'s, T>(
    res: DbResult<T>,
    held: Option<Held<'s>>,
    cancel: &CancelSignal,
) -> (DbResult<T>, Option<Held<'s>>) {
    match held {
        Some(held) if cancel.is_cancelled() => {
            // Huỷ = bỏ connection (Q23=A): không đọc bỏ phần còn lại.
            held.stale.store(true, Ordering::Release);
            held.abandon().await;
            (Err(cancelled()), None)
        }
        other => (res, other),
    }
}

/// Kết thúc của một batch trong `execute`.
enum Step {
    /// Batch chạy xong, chạy batch kế tiếp.
    Continue,
    /// Batch xong nhưng không có result set nào: cần hỏi số dòng ảnh hưởng (kết quả `affected`
    /// đã được ghi với `rowsAffected` trống để người gọi điền).
    Count,
    /// Batch lỗi (đã ghi vào kết quả): các batch sau không chạy.
    Stop,
    /// Request bị huỷ.
    Cancelled(DbError),
}

/// Kết quả của `execute`.
struct Executed<'s> {
    /// Kết quả từng batch. Lỗi cấp request (`Err`) chỉ dành cho huỷ.
    res: DbResult<Vec<StatementResult>>,
    /// Cursor của batch cuối còn dòng để actor giữ.
    held: Option<Held<'s>>,
    /// Batch cuối thuộc loại `Step::Count`: người gọi điền `rowsAffected` cho kết quả cuối.
    count: bool,
}

/// Chạy lần lượt các batch trong `sql` (tách theo `GO`), dừng ở batch lỗi đầu tiên (lỗi từng
/// batch nằm trong `StatementResult.error`, không làm hỏng cả request). Batch cuối có dòng còn
/// dư thì trả cursor để actor giữ; batch có dòng nhưng không phải batch cuối chỉ lấy trang đầu
/// (`truncated`).
///
/// Batch cuối tách khỏi vòng lặp vì chỉ batch đó mới trả cursor mượn `session`: compiler không
/// cho trả một khoản mượn từ bên trong vòng lặp khi nó có thể còn sống sang vòng sau. Cũng vì
/// vậy việc hỏi số dòng của batch cuối do `run` làm, không làm trong hàm này.
async fn execute<'s>(
    session: &'s mut Session,
    sql: &str,
    limits: Limits,
    cancel: &CancelSignal,
    cursor_id: u64,
) -> Executed<'s> {
    let ranges = split(Dialect::SqlServer, sql);
    let Some(last) = ranges.len().checked_sub(1) else {
        return Executed {
            res: Ok(Vec::new()),
            held: None,
            count: false,
        };
    };
    let mut out: Vec<StatementResult> = Vec::with_capacity(ranges.len());
    let run = Run {
        limits,
        cancel,
        cursor_id,
    };
    for (index, range) in ranges[..last].iter().enumerate() {
        let (step, _) = statement(session, &sql[range.clone()], index, &run, false, &mut out).await;
        let res = match step {
            Step::Continue => continue,
            Step::Count => match patch_count(session, &mut out, cancel).await {
                Ok(()) => continue,
                Err(e) => Err(e),
            },
            Step::Stop => Ok(out),
            Step::Cancelled(e) => Err(e),
        };
        return Executed {
            res,
            held: None,
            count: false,
        };
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
        Step::Continue | Step::Stop => Executed {
            res: Ok(out),
            held,
            count: false,
        },
        Step::Count => Executed {
            res: Ok(out),
            held,
            count: true,
        },
        Step::Cancelled(e) => Executed {
            res: Err(e),
            held,
            count: false,
        },
    }
}

/// Batch có thể đổi trạng thái phiên không: `USE`, `SET`, bảng tạm `#`/`##`, `BEGIN TRAN[SACTION]`,
/// thủ tục `sp_...` (như `sp_executesql`, `sp_rename`). Quét thô như `has_write_keyword`: nhận
/// nhầm chỉ khiến báo "connection was reset" thừa, không bỏ sót.
fn changes_session_state(sql: &str) -> bool {
    if sql.contains('#') {
        return true;
    }
    let mut words = words(sql);
    while let Some(w) = words.next() {
        let is = |kw: &str| w.eq_ignore_ascii_case(kw);
        let sp = w.get(..3).is_some_and(|p| p.eq_ignore_ascii_case("sp_"));
        if is("use") || is("set") || sp {
            return true;
        }
        // `EXECUTE AS` đổi ngữ cảnh bảo mật của phiên.
        if (is("exec") || is("execute"))
            && words
                .clone()
                .next()
                .is_some_and(|n| n.eq_ignore_ascii_case("as"))
        {
            return true;
        }
    }
    opens_tran(sql)
}

/// Batch có chứa `BEGIN TRAN|TRANSACTION|DISTRIBUTED` ở bất kỳ vị trí nào không. `track_tx`
/// chỉ xét từ đầu batch (`BEGIN TRY BEGIN TRAN ...` bị coi là không mở transaction), nên
/// phải quét thêm ở đây. Quét thô: nhận nhầm chỉ làm cursor bị coi là không an toàn để bỏ.
fn opens_tran(sql: &str) -> bool {
    let mut words = words(sql);
    while let Some(w) = words.next() {
        if w.eq_ignore_ascii_case("begin")
            && words.clone().next().is_some_and(|n| {
                ["tran", "transaction", "distributed"]
                    .iter()
                    .any(|kw| n.eq_ignore_ascii_case(kw))
            })
        {
            return true;
        }
    }
    false
}

/// Cancel batch này có an toàn không (không ghi, không đổi trạng thái, và không đang trong
/// transaction của người dùng).
fn cancel_safe(in_tx: bool, text: &str) -> bool {
    !in_tx && is_cancel_safe(text) && !has_write_keyword(text)
}

/// Tham số chung của mọi batch trong một request.
struct Run<'a> {
    limits: Limits,
    cancel: &'a CancelSignal,
    cursor_id: u64,
}

/// Chạy một batch và ghi kết quả (mỗi result set một `StatementResult`) vào `out`. `keep` cho
/// phép trả cursor (chỉ batch cuối).
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

    // Batch trước có thể đã làm connection `stale` (`@@ROWCOUNT` quá hạn, cursor bị cắt phải bỏ):
    // nối lại trước khi chạy.
    if let Err(e) = session.ensure_connected(cancel).await {
        if e.code == CANCELLED {
            return (Step::Cancelled(e), None);
        }
        out.push(statement_error(index, text, start, e.message));
        return (Step::Stop, None);
    }
    // Cancel an toàn hay không phụ thuộc trạng thái transaction TRƯỚC batch này.
    let cancel_safe = cancel_safe(session.in_tx, text);
    track_tx(&mut session.in_tx, text);
    session.in_tx |= opens_tran(text);
    session.dirty |= changes_session_state(text);
    let stale = session.stale.clone();
    let Some(client) = session.client.as_mut() else {
        out.push(statement_error(
            index,
            text,
            start,
            "connection is closed".to_owned(),
        ));
        return (Step::Stop, None);
    };

    let mut stream = match drive(client.simple_query(text.to_owned()), cancel, &stale).await {
        Ok(stream) => stream,
        Err(e) => return (fail(out, index, text, start, e), None),
    };
    let mut item = match drive(stream.try_next(), cancel, &stale).await {
        Ok(item) => item,
        Err(e) => return (fail(out, index, text, start, e), None),
    };

    // Mỗi vòng xử lý một result set. Batch không có result set (`UPDATE`...) thành `affected`
    // (số dòng điền sau); mỗi result set có cột thành `rows`.
    let mut produced_rows = false;
    loop {
        let meta = match item {
            Some(QueryItem::Metadata(meta)) => meta,
            None => {
                if produced_rows {
                    return (Step::Continue, None);
                }
                let mut res = affected_statement(index, text.to_owned(), 0, start);
                res.rows_affected = None;
                out.push(res);
                return (Step::Count, None);
            }
            // `tiberius` luôn gửi `Metadata` trước `Row`; gặp ngược lại là stream lệch.
            Some(QueryItem::Row(_)) => {
                stale.store(true, Ordering::Release);
                out.push(statement_error(
                    index,
                    text,
                    start,
                    "unexpected row without column metadata".to_owned(),
                ));
                return (Step::Stop, None);
            }
        };

        produced_rows = true;
        let columns = protocol_columns(meta.columns());
        let mut held = Held {
            cursor_id: run.cursor_id,
            stream: Some(stream),
            kinds: column_kinds(meta.columns()),
            cancel_safe,
            finished: false,
            eof: false,
            next_meta: None,
            pending_error: None,
            first_row_at: None,
            stale: stale.clone(),
            lost: session.lost.clone(),
        };
        match held.read_page(run.limits, cancel).await {
            Ok(mut page) => {
                // Lỗi đứng sau các dòng vừa đọc: trả dòng trước, rồi ghi lỗi và dừng.
                let pending = held.pending_error.take();
                if pending.is_some() {
                    page.done = true;
                }
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
                if let Some(e) = pending {
                    out.push(statement_error(index, text, start, e.message));
                    return (Step::Stop, None);
                }
                if keep_cursor {
                    return (Step::Continue, Some(held));
                }
                // Còn dòng (kết quả bị cắt): bỏ cả batch, các set sau không được đọc.
                if !done {
                    held.abandon().await;
                    return (Step::Continue, None);
                }
                // Hết dòng của set này: lấy lại stream để đọc set kế tiếp (nếu có).
                match (held.stream.take(), held.next_meta.take()) {
                    (Some(s), Some(next)) => {
                        stream = s;
                        item = Some(QueryItem::Metadata(next));
                    }
                    _ => return (Step::Continue, None),
                }
            }
            // Lỗi của server/mạng: stream đã hết hoặc connection đã `stale`, thả `held` là đủ.
            Err(e) => return (fail(out, index, text, start, e), None),
        }
    }
}

/// Ghi lỗi của batch vào `out` (hoặc trả huỷ).
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

/// Điền `rowsAffected` cho kết quả cuối của `out` bằng số dòng của câu cuối batch vừa chạy.
async fn patch_count(
    session: &mut Session,
    out: &mut [StatementResult],
    cancel: &CancelSignal,
) -> DbResult<()> {
    let (n, in_tx) = row_count(session, cancel).await?;
    if let Some(last) = out.last_mut() {
        last.rows_affected = n;
    }
    // `@@TRANCOUNT` từ server chính xác hơn quét chữ: batch TRY/CATCH đã COMMIT thì không kẹt
    // `true`.
    if let Some(in_tx) = in_tx {
        session.in_tx = in_tx;
    }
    Ok(())
}

/// `SELECT @@ROWCOUNT, @@TRANCOUNT` chạy như một batch riêng (không nối vào batch của người dùng vì
/// có lệnh phải đứng một mình trong batch, ví dụ `CREATE PROCEDURE`). `@@ROWCOUNT` giữ giá trị
/// của câu trước trong cùng phiên (hai biến cùng tính trong một câu nên không bị câu này làm đổi).
/// Trả (số dòng, còn transaction mở không). Mọi lỗi (trừ huỷ) chỉ làm hai giá trị trống.
async fn row_count(
    session: &mut Session,
    cancel: &CancelSignal,
) -> DbResult<(Option<i64>, Option<bool>)> {
    if let Err(e) = session.ensure_connected(cancel).await {
        return if e.code == CANCELLED {
            Err(e)
        } else {
            Ok((None, None))
        };
    }
    let stale = session.stale.clone();
    let Some(client) = session.client.as_mut() else {
        return Ok((None, None));
    };
    let read = async {
        let mut stream = client
            .simple_query("SELECT @@ROWCOUNT, @@TRANCOUNT")
            .await?;
        let mut res = (None, None);
        while let Some(item) = stream.try_next().await? {
            if let QueryItem::Row(row) = item
                && res == (None, None)
            {
                res = split_counts(row.get::<i32, _>(0), row.get::<i32, _>(1));
            }
        }
        Ok(res)
    };
    match tokio::time::timeout(COUNT_TIMEOUT, drive(read, cancel, &stale)).await {
        Ok(Ok(r)) => Ok(r),
        Ok(Err(e)) if e.code == CANCELLED => Err(e),
        Ok(Err(_)) => Ok((None, None)),
        Err(_) => {
            // Thả giữa chừng: connection lệch pha, bỏ.
            stale.store(true, Ordering::Release);
            Ok((None, None))
        }
    }
}

/// Đổi hai cột `(@@ROWCOUNT, @@TRANCOUNT)` thành (số dòng, còn trong transaction không).
fn split_counts(rows: Option<i32>, trancount: Option<i32>) -> (Option<i64>, Option<bool>) {
    (rows.map(i64::from), trancount.map(|t| t > 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// `Held` không có stream (không cần server): đủ để thử các nhánh không đọc dòng.
    fn held(stale: &StaleFlag) -> Held<'static> {
        Held {
            cursor_id: 9,
            stream: None,
            kinds: Vec::new(),
            cancel_safe: true,
            finished: false,
            eof: false,
            next_meta: None,
            pending_error: None,
            first_row_at: None,
            stale: stale.clone(),
            lost: StaleFlag::default(),
        }
    }

    fn limits() -> Limits {
        Limits::new(10, 1 << 20)
    }

    fn is_stale(f: &StaleFlag) -> bool {
        f.load(Ordering::Acquire)
    }

    fn io_error() -> TdsError {
        TdsError::Io {
            kind: std::io::ErrorKind::ConnectionReset,
            message: "reset".to_owned(),
        }
    }

    // ---- db_error ----

    #[test]
    fn db_error_marks_the_connection_stale_for_every_non_server_error() {
        let errors = [
            io_error(),
            TdsError::Protocol("bad token".into()),
            TdsError::Tls("handshake".to_owned()),
            TdsError::Utf8,
            TdsError::Encoding("enc".into()),
        ];
        for e in errors {
            let stale = AtomicBool::new(false);
            let got = db_error(&e, &stale);
            assert_eq!(got.code, SQL_ERROR, "{e}");
            assert_eq!(got.message, error_text(&e));
            assert!(stale.load(Ordering::Acquire), "{e}");
        }
    }

    // ---- drive ----

    #[tokio::test]
    async fn drive_returns_a_ready_value_without_touching_stale() {
        let cancel = CancelSignal::new();
        let stale = AtomicBool::new(false);
        let r = drive(async { Ok::<_, TdsError>(7) }, &cancel, &stale).await;
        assert_eq!(r.unwrap(), 7);
        assert!(!stale.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn drive_maps_a_ready_error_and_marks_stale() {
        let cancel = CancelSignal::new();
        let stale = AtomicBool::new(false);
        let r = drive(async { Err::<(), _>(io_error()) }, &cancel, &stale).await;
        let e = r.unwrap_err();
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.contains("reset"));
        assert!(stale.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn drive_reports_cancelled_when_an_error_comes_after_the_cancel() {
        // Huỷ = đóng TCP nên lỗi I/O đến sau tín hiệu huỷ phải thành `cancelled`, không phải lỗi SQL.
        let cancel = CancelSignal::new();
        cancel.cancel();
        let stale = AtomicBool::new(false);
        let r = drive(async { Err::<(), _>(io_error()) }, &cancel, &stale).await;
        assert_eq!(r.unwrap_err().code, CANCELLED);
        assert!(stale.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn drive_drops_a_pending_future_when_already_cancelled() {
        let cancel = CancelSignal::new();
        cancel.cancel();
        let stale = AtomicBool::new(false);
        let r = drive(
            std::future::pending::<Result<(), TdsError>>(),
            &cancel,
            &stale,
        )
        .await;
        assert_eq!(r.unwrap_err().code, CANCELLED);
        assert!(stale.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn drive_stops_waiting_when_the_cancel_arrives_later() {
        let cancel = Arc::new(CancelSignal::new());
        let stale = Arc::new(AtomicBool::new(false));
        let waiter = {
            let (cancel, stale) = (cancel.clone(), stale.clone());
            tokio::spawn(async move {
                drive(
                    std::future::pending::<Result<(), TdsError>>(),
                    &cancel,
                    &stale,
                )
                .await
            })
        };
        // Cho task kịp chờ (không sleep thật): nhường vài lượt rồi mới huỷ.
        for _ in 0..5 {
            tokio::task::yield_now().await;
        }
        assert!(!waiter.is_finished());
        cancel.cancel();
        let e = waiter.await.unwrap().unwrap_err();
        assert_eq!(e.code, CANCELLED);
        assert!(stale.load(Ordering::Acquire));
    }

    // ---- helper nhỏ ----

    #[test]
    fn schema_methods_are_invalid_request() {
        let e = unsupported();
        assert_eq!(e.code, INVALID_REQUEST);
        assert_eq!(e.message, "method not supported by driver");
    }

    // ---- Held ----

    #[tokio::test]
    async fn pending_error_is_reported_once_before_any_row() {
        let stale = StaleFlag::default();
        let mut h = held(&stale);
        h.pending_error = Some(DbError::new(
            SQL_ERROR,
            "Msg 8134, Level 16: divide by zero",
        ));
        let cancel = CancelSignal::new();
        let e = h
            .read_page(limits(), &cancel)
            .await
            .err()
            .expect("phải lỗi");
        assert_eq!(e.code, SQL_ERROR);
        assert!(e.message.contains("8134"));
        assert!(h.pending_error.is_none(), "lỗi chỉ báo một lần");
        assert!(!is_stale(&stale), "lỗi server không làm connection hỏng");
        // Lần sau không còn lỗi: cursor đã `finished` nên trang rỗng và xong.
        h.finished = true;
        let page = h.read_page(limits(), &cancel).await.expect("hết lỗi");
        assert!(page.rows.is_empty());
        assert!(page.done);
    }

    #[tokio::test]
    async fn a_finished_cursor_returns_an_empty_done_page() {
        let stale = StaleFlag::default();
        let mut h = held(&stale);
        h.finished = true;
        let page = h
            .read_page(limits(), &CancelSignal::new())
            .await
            .ok()
            .unwrap();
        assert!(page.rows.is_empty());
        assert!(page.done);
        assert!(!is_stale(&stale));
    }

    #[tokio::test]
    async fn read_page_on_a_cancelled_request_is_cancelled_and_marks_stale() {
        let stale = StaleFlag::default();
        let mut h = held(&stale);
        let cancel = CancelSignal::new();
        cancel.cancel();
        let e = h.read_page(limits(), &cancel).await.err().unwrap();
        assert_eq!(e.code, CANCELLED);
        assert!(
            is_stale(&stale),
            "stream đang dở giữa set nên phải bỏ connection"
        );
    }

    #[tokio::test]
    async fn a_cursor_without_a_stream_gives_an_open_empty_page() {
        let stale = StaleFlag::default();
        let mut h = held(&stale);
        let page = h
            .read_page(limits(), &CancelSignal::new())
            .await
            .ok()
            .unwrap();
        assert!(page.rows.is_empty());
        assert!(!page.done);
        assert!(!is_stale(&stale));
    }

    #[tokio::test]
    async fn cursor_trait_exposes_the_id_and_reads_pages() {
        let stale = StaleFlag::default();
        let mut h = held(&stale);
        assert_eq!(Cursor::id(&h), 9);
        h.finished = true;
        let page = Cursor::next_page(&mut h, limits(), &CancelSignal::new())
            .await
            .ok()
            .unwrap();
        assert!(page.done);
    }

    #[tokio::test]
    async fn abandon_without_a_stream_does_nothing() {
        let stale = StaleFlag::default();
        held(&stale).abandon().await;
        assert!(!is_stale(&stale));
    }

    // ---- drop_if_cancelled ----

    #[tokio::test]
    async fn drop_if_cancelled_keeps_the_result_and_cursor_when_not_cancelled() {
        let stale = StaleFlag::default();
        let (res, kept) = drop_if_cancelled(Ok(5), Some(held(&stale)), &CancelSignal::new()).await;
        assert_eq!(res.unwrap(), 5);
        assert!(kept.is_some());
        assert!(!is_stale(&stale));
    }

    #[tokio::test]
    async fn drop_if_cancelled_replaces_the_result_and_drops_the_cursor() {
        let stale = StaleFlag::default();
        let cancel = CancelSignal::new();
        cancel.cancel();
        let (res, kept) = drop_if_cancelled(Ok(5), Some(held(&stale)), &cancel).await;
        assert_eq!(res.unwrap_err().code, CANCELLED);
        assert!(kept.is_none());
        assert!(is_stale(&stale), "huỷ = bỏ connection");
    }

    #[tokio::test]
    async fn drop_if_cancelled_without_a_cursor_passes_the_result_through() {
        let cancel = CancelSignal::new();
        cancel.cancel();
        let (res, kept) = drop_if_cancelled::<i32>(Ok(5), None, &cancel).await;
        assert_eq!(res.unwrap(), 5);
        assert!(kept.is_none());
        let (res, _) =
            drop_if_cancelled::<i32>(Err(DbError::new(SQL_ERROR, "x")), None, &cancel).await;
        assert_eq!(res.unwrap_err().code, SQL_ERROR);
    }

    // ---- fail ----

    #[test]
    fn fail_turns_a_cancel_into_a_step_and_other_errors_into_a_statement_error() {
        let mut out = Vec::new();
        let step = fail(&mut out, 2, "select 1", Instant::now(), cancelled());
        assert!(matches!(step, Step::Cancelled(ref e) if e.code == CANCELLED));
        assert!(out.is_empty(), "huỷ không ghi kết quả của câu");

        let step = fail(
            &mut out,
            2,
            "select 1/0",
            Instant::now(),
            DbError::new(SQL_ERROR, "Msg 8134"),
        );
        assert!(matches!(step, Step::Stop));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].index, 2);
        assert_eq!(out[0].sql, "select 1/0");
        assert_eq!(out[0].error.as_ref().unwrap().message, "Msg 8134");
    }

    // ---- split_counts (B13) ----

    #[test]
    fn split_counts_maps_rowcount_and_trancount() {
        assert_eq!(split_counts(Some(5), Some(0)), (Some(5), Some(false)));
        assert_eq!(split_counts(Some(1), Some(2)), (Some(1), Some(true)));
        assert_eq!(split_counts(None, None), (None, None));
        assert_eq!(split_counts(Some(3), None), (Some(3), None));
        assert_eq!(split_counts(None, Some(1)), (None, Some(true)));
        assert_eq!(split_counts(Some(0), Some(1)), (Some(0), Some(true)));
        // Biên: `i32::MAX` giữ nguyên khi nới sang i64; trancount âm không phải "trong transaction".
        assert_eq!(
            split_counts(Some(i32::MAX), Some(i32::MAX)),
            (Some(i64::from(i32::MAX)), Some(true))
        );
        assert_eq!(split_counts(Some(-1), Some(-1)), (Some(-1), Some(false)));
    }

    // ---- changes_session_state (B5) ----

    #[test]
    fn session_state_changing_batches_are_detected() {
        for sql in [
            "USE master",
            "use [shop]",
            "SET NOCOUNT ON",
            "set transaction isolation level snapshot",
            "SELECT * INTO #t FROM x",
            "create table ##g (a int)",
            "SELECT * FROM #temp",
            "EXEC sp_executesql N'select 1'",
            "exec SP_rename 'a', 'b'",
            "BEGIN TRAN",
            "begin transaction",
            "BEGIN
TRANSACTION t1",
            "SELECT 1; USE other",
            // B10
            "EXECUTE AS USER = 'x'",
            "exec as login='a'",
            "BEGIN DISTRIBUTED TRANSACTION",
        ] {
            assert!(changes_session_state(sql), "{sql}");
        }
    }

    /// Cách `statement` ghép `track_tx` với `opens_tran` (B9). Gọi `statement` cần server thật,
    /// nên mô phỏng đúng hai dòng đó; phần có DB nằm ở `tests/mssql.rs`.
    fn in_tx_after(start: bool, sql: &str) -> bool {
        let mut in_tx = start;
        track_tx(&mut in_tx, sql);
        in_tx |= opens_tran(sql);
        in_tx
    }

    #[test]
    fn begin_tran_nested_in_try_block_sets_in_tx_and_commit_clears_it() {
        let try_tran = "BEGIN TRY BEGIN TRAN UPDATE t SET a=1 END TRY BEGIN CATCH END CATCH";
        assert!(opens_tran(try_tran));
        // `track_tx` một mình bỏ sót (chỉ xét đầu batch): đây là lỗi B9.
        let mut only_track = false;
        track_tx(&mut only_track, try_tran);
        assert!(!only_track);
        assert!(in_tx_after(false, try_tran));
        let try_select = "BEGIN TRY SELECT 1 END TRY BEGIN CATCH END CATCH";
        assert!(!opens_tran(try_select));
        assert!(!in_tx_after(false, try_select));
        // COMMIT sau đó thì thoát transaction.
        assert!(!in_tx_after(true, "COMMIT"));
        assert!(!in_tx_after(true, "ROLLBACK TRAN"));
        // Batch thường không làm mất trạng thái đang trong transaction.
        assert!(in_tx_after(true, "SELECT 1"));
    }

    #[test]
    fn plain_batches_do_not_change_session_state() {
        for sql in [
            "SELECT 1",
            "select * from dbo.t where a = 1",
            "INSERT INTO t VALUES (1)",
            "SELECT used, settings, spx FROM t",
            // `BEGIN TRY` không mở transaction.
            "BEGIN TRY SELECT 1 END TRY BEGIN CATCH SELECT 2 END CATCH",
            // B10: `EXEC` không kèm `AS` và không phải `sp_`.
            "EXEC p",
            "",
        ] {
            assert!(!changes_session_state(sql), "{sql:?}");
        }
    }

    #[test]
    fn cancel_safe_needs_a_read_start_and_no_write_keyword_anywhere_in_the_batch() {
        // B3: cách `statement` ghép hai hàm (`!in_tx` không xét ở đây).
        let safe = |sql: &str| cancel_safe(false, sql);
        assert!(safe("SELECT 1"));
        assert!(safe("select * from t"));
        // Bắt đầu bằng SELECT nhưng batch có ghi: chỉ `is_cancel_safe` thì nhận nhầm.
        assert!(is_cancel_safe("SELECT 1; UPDATE ##probe SET a = 2"));
        assert!(!safe("SELECT 1; UPDATE ##probe SET a = 2"));
        assert!(!safe("SELECT a INTO #x FROM t"));
        assert!(!safe("SELECT 1; EXEC p"));
        assert!(!safe("UPDATE t SET a = 1"));
    }
}
