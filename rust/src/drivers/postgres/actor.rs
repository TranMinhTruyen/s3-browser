//! Actor của một connection PostgreSQL: nhận lệnh tuần tự, chạy từng câu SQL, giữ cursor (stream
//! dòng của câu cuối còn dữ liệu) giữa các lệnh `fetch`.
//!
//! Vị trí trong luồng: `postgres::open` spawn `run` cho mỗi connection; `drivers::request` gửi
//! `Cmd` qua kênh `mpsc`; `run` chạy lệnh rồi trả kết quả qua kênh `oneshot` trong `Job`. Chỉ
//! actor này chạm vào `Client` nên không cần khoá (giống `sqlite::actor`).
//!
//! Dòng kết quả không bị nạp hết vào RAM: `tokio-postgres` đọc dòng từ server vào một kênh có
//! giới hạn (khi đầy, nó ngừng đọc socket và TCP tự báo server chậm lại), nên cursor chỉ là
//! `RowStream` đang mở; mỗi trang lấy tiếp từ stream đó. Không cần `DECLARE CURSOR`.
//!
//! Huỷ: `s3b_cancel` gọi `PgInterrupt` (gửi `CancelRequest` của giao thức PostgreSQL), đồng thời
//! mọi lần chờ I/O ở đây nằm trong `tokio::select!` với `CancelSignal` nên actor trả `cancelled`
//! ngay, không chờ server.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Pin<Box<T>>`: một giá trị nằm cố định trên heap, cần cho future/stream không được di
//!   chuyển sau khi bắt đầu poll (`RowStream` thuộc loại này).
//! - `tokio::select!`: chờ nhiều future cùng lúc, cái nào xong trước thắng, các cái còn lại bị bỏ.
//! - `now_or_never`: poll một future đúng một lần; có kết quả sẵn thì lấy, chưa thì bỏ (đường
//!   nhanh khi dòng đã nằm sẵn trong buffer, tránh tốn công đăng ký chờ).

use super::value::{Decoder, cell, decoder_for};
use super::{error_text, send_cancel};
use crate::drivers::Cmd;
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, affected_statement, cancelled,
    cursor_not_found, hold, rows_statement, statement_error,
};
use crate::drivers::split_sql::{Dialect, split};
use crate::protocol::{
    CANCELLED, Column, DbError, DbResult, ExecuteResult, INTERNAL, INVALID_REQUEST, SQL_ERROR,
    StatementResult,
};
use crate::registry::{self, CancelSignal};
use futures_util::{FutureExt, Stream, StreamExt};
use rustls::ClientConfig;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_postgres::types::{FromSql, Type};
use tokio_postgres::{CancelToken, Client, Row, RowStream, SimpleQueryMessage, SimpleQueryStream};

/// Đợi connection task tự thoát tối đa bao lâu khi đóng, quá hạn thì dừng cưỡng bức.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
/// Thời gian đọc bỏ nhanh phần còn lại của cursor trước khi quyết định huỷ câu phía server.
const QUICK_DRAIN: Duration = Duration::from_millis(50);
/// Đọc bỏ phần dòng còn lại của cursor bị bỏ tối đa bao lâu (câu không huỷ được, ví dụ DML
/// có `RETURNING`, vẫn chạy hết phía server).
const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);

/// Connection đang mở cùng những gì cần để huỷ câu đang chạy.
pub struct Session {
    client: Client,
    token: CancelToken,
    /// Cấu hình TLS nếu connection này đang dùng TLS (yêu cầu huỷ phải dùng cùng kiểu).
    tls: Option<Arc<ClientConfig>>,
    /// Người dùng đang trong transaction tự mở (`BEGIN`...): huỷ một câu trong đó làm cả
    /// transaction hỏng, nên khi bỏ cursor chỉ đọc bỏ chứ không huỷ.
    in_tx: bool,
}

impl Session {
    pub fn new(client: Client, token: CancelToken, tls: Option<Arc<ClientConfig>>) -> Self {
        Self {
            client,
            token,
            tls,
            in_tx: false,
        }
    }
}

/// Nguồn dòng của một cursor.
enum Source {
    /// Đọc nhị phân: mọi cột nằm trong danh sách kiểu cho phép (`decoders` theo thứ tự cột).
    /// `RowStream` không `Unpin`, nên đặt vào `Pin<Box<..>>` để dùng được với `StreamExt::next`.
    Binary {
        stream: Pin<Box<RowStream>>,
        decoders: Vec<Decoder>,
    },
    /// Đọc text bằng simple query khi có cột ngoài danh sách kiểu.
    Simple { stream: Pin<Box<SimpleQueryStream>> },
}

/// Cursor đang mở của một câu có dòng.
struct Held {
    cursor_id: u64,
    source: Source,
    /// Huỷ phía server khi bỏ cursor còn dòng có an toàn không (xem `is_cancel_safe`).
    cancel_safe: bool,
    /// Stream đã đọc hết hoặc đã lỗi từ phía server: không còn gì để đọc bỏ.
    finished: bool,
    /// Lúc nhận được phản hồi đầu tiên của stream (dòng đầu hoặc kết thúc), cho `firstRowMs`.
    first_row_at: Option<Instant>,
    token: CancelToken,
    tls: Option<Arc<ClientConfig>>,
}

/// Lý do `next_item` không trả được phần tử.
enum Fail {
    /// Request bị huỷ khi đang chờ; stream chưa đọc xong.
    Cancelled,
    /// Server báo lỗi (stream đã kết thúc); đã đổi sang `DbError`.
    Server(DbError),
}

/// Lỗi của `tokio-postgres` thành `DbError`: `cancelled` nếu request bị huỷ (server báo
/// "canceling statement" sau yêu cầu huỷ), ngược lại `sqlError` với thông báo của server.
fn db_error(e: &tokio_postgres::Error, cancel: &CancelSignal) -> DbError {
    if cancel.is_cancelled() {
        cancelled()
    } else {
        DbError::new(SQL_ERROR, error_text(e))
    }
}

/// Chờ `fut` nhưng thôi ngay khi request bị huỷ (trả `cancelled`).
async fn or_cancel<T>(
    cancel: &CancelSignal,
    fut: impl Future<Output = Result<T, tokio_postgres::Error>>,
) -> DbResult<T> {
    tokio::select! {
        // `biased`: kiểm huỷ trước, để request đã huỷ không bị coi là thành công.
        biased;
        () = cancel.cancelled() => Err(cancelled()),
        r = fut => r.map_err(|e| db_error(&e, cancel)),
    }
}

/// Lấy phần tử kế tiếp của stream, thôi chờ nếu request bị huỷ.
async fn next_item<S, T>(stream: &mut S, cancel: &CancelSignal) -> Result<Option<T>, Fail>
where
    S: Stream<Item = Result<T, tokio_postgres::Error>> + Unpin,
{
    // Đường nhanh: dòng đã có trong buffer thì lấy luôn, không cần `select!`.
    let item = match stream.next().now_or_never() {
        Some(item) => item,
        None => tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(Fail::Cancelled),
            item = stream.next() => item,
        },
    };
    item.transpose()
        .map_err(|e| Fail::Server(db_error(&e, cancel)))
}

/// Mượn nguyên byte của một ô (`Row::try_get` không có cách lấy byte thô khác): `accepts` luôn
/// đúng nên mọi kiểu đều đọc được, và `Option<Raw>` cho `None` khi ô là NULL.
struct Raw<'a>(&'a [u8]);

impl<'a> FromSql<'a> for Raw<'a> {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Raw(raw))
    }

    fn accepts(_: &Type) -> bool {
        true
    }
}

/// Giải mã một dòng nhị phân thành các ô chuỗi (`None` = NULL).
fn decode_row(row: &Row, decoders: &[Decoder]) -> DbResult<Vec<Option<String>>> {
    let mut cells = Vec::with_capacity(decoders.len());
    for (i, &dec) in decoders.iter().enumerate() {
        let raw: Option<Raw<'_>> = row
            .try_get(i)
            .map_err(|e| DbError::internal(e.to_string()))?;
        cells.push(raw.map(|r| cell(dec, r.0)));
    }
    Ok(cells)
}

/// Cell của một dòng simple query (đã là text).
fn simple_row(row: &tokio_postgres::SimpleQueryRow) -> DbResult<Vec<Option<String>>> {
    (0..row.len())
        .map(|i| {
            row.try_get(i)
                .map(|v| v.map(str::to_owned))
                .map_err(|e| DbError::internal(e.to_string()))
        })
        .collect()
}

/// Đọc một dòng từ nguồn: `Ok(None)` là hết dòng. Dòng nhị phân được giải mã ngay ở đây.
/// Khi bật `bench-timing`, thời gian chờ dòng và thời gian giải mã được cộng vào `page`.
#[cfg_attr(not(feature = "bench-timing"), allow(unused_variables))]
async fn read_row(
    source: &mut Source,
    cancel: &CancelSignal,
    page: &mut PageBuilder,
) -> Result<Option<Vec<Option<String>>>, Fail> {
    match source {
        Source::Binary { stream, decoders } => {
            #[cfg(feature = "bench-timing")]
            let waited = Instant::now();
            let item = next_item(stream, cancel).await?;
            #[cfg(feature = "bench-timing")]
            page.add_read(waited.elapsed());
            let Some(row) = item else { return Ok(None) };
            #[cfg(feature = "bench-timing")]
            let converting = Instant::now();
            let cells = decode_row(&row, decoders).map_err(Fail::Server)?;
            #[cfg(feature = "bench-timing")]
            page.add_convert(converting.elapsed());
            Ok(Some(cells))
        }
        Source::Simple { stream } => loop {
            match next_item(stream, cancel).await? {
                // Bỏ qua mô tả cột và `CommandComplete`; chỉ dòng dữ liệu mới là kết quả.
                Some(SimpleQueryMessage::Row(r)) => {
                    return simple_row(&r).map(Some).map_err(Fail::Server);
                }
                Some(_) => {}
                None => return Ok(None),
            }
        },
    }
}

/// `Held` là cursor của driver: mỗi trang đọc tiếp từ stream đang mở.
impl Cursor for Held {
    fn id(&self) -> u64 {
        self.cursor_id
    }

    async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
        let mut page = PageBuilder::new(limits);
        let mut done = self.finished;
        while !done && !page.is_full() {
            if cancel.is_cancelled() {
                return Err(cancelled());
            }
            let row = read_row(&mut self.source, cancel, &mut page).await;
            self.first_row_at.get_or_insert_with(Instant::now);
            match row {
                Ok(Some(cells)) => page.push(cells),
                Ok(None) => {
                    self.finished = true;
                    done = true;
                }
                Err(Fail::Cancelled) => return Err(cancelled()),
                Err(Fail::Server(e)) => {
                    // Lỗi giải mã phía ta (`internal`) thì stream còn dữ liệu, để `abandon` đọc
                    // bỏ; lỗi của server thì câu đã kết thúc.
                    self.finished = e.code != INTERNAL;
                    return Err(e);
                }
            }
        }
        Ok(page.finish(done))
    }

    /// Bỏ cursor còn dòng: đọc bỏ phần còn lại để connection yên tĩnh trước khi nhận lệnh kế
    /// tiếp. Câu huỷ được (xem `is_cancel_safe`) mà chưa hết trong `QUICK_DRAIN` thì huỷ phía
    /// server rồi đọc tiếp. Đọc nhanh trước vì kết quả nhỏ đã nằm sẵn trong buffer: huỷ lúc đó
    /// là thừa, và yêu cầu huỷ tới server sau khi câu đã xong sẽ huỷ nhầm lệnh kế tiếp.
    async fn abandon(mut self) {
        if self.finished {
            return;
        }
        let Held {
            source,
            token,
            tls,
            cancel_safe,
            ..
        } = &mut self;
        let mut drain = std::pin::pin!(async {
            match source {
                Source::Binary { stream, .. } => while let Some(Ok(_)) = stream.next().await {},
                Source::Simple { stream } => while let Some(Ok(_)) = stream.next().await {},
            }
        });
        if *cancel_safe {
            if tokio::time::timeout(QUICK_DRAIN, drain.as_mut())
                .await
                .is_ok()
            {
                return;
            }
            send_cancel(token, tls.as_ref()).await;
        }
        let _ = tokio::time::timeout(DRAIN_TIMEOUT, drain).await;
    }
}

/// Từ đầu tiên của câu (chữ cái, không phân biệt hoa thường) và từ thứ hai.
fn first_words(sql: &str) -> (&str, &str) {
    let mut words = sql
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|w| !w.is_empty());
    (words.next().unwrap_or(""), words.next().unwrap_or(""))
}

/// Huỷ phía server một câu còn dòng có an toàn không: chỉ câu đọc thuần (`SELECT`, `VALUES`,
/// `TABLE`, `SHOW`, và `WITH` không chứa `INSERT`/`UPDATE`/`DELETE`/`MERGE`). Câu ghi dữ liệu
/// (`INSERT ... RETURNING`) mà bị huỷ giữa chừng sẽ rollback cả câu, nên chỉ đọc bỏ.
/// Câu bắt đầu bằng dấu `(` hoặc từ khác thì coi là không an toàn.
/// Giới hạn đã biết: `SELECT` gọi hàm có tác dụng phụ vẫn bị huỷ.
fn is_cancel_safe(sql: &str) -> bool {
    if !sql.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return false;
    }
    let (first, _) = first_words(sql);
    let is = |kw: &str| first.eq_ignore_ascii_case(kw);
    if is("select") || is("values") || is("table") || is("show") {
        return true;
    }
    is("with")
        && !sql
            .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .any(|w| {
                ["insert", "update", "delete", "merge"]
                    .iter()
                    .any(|kw| w.eq_ignore_ascii_case(kw))
            })
}

/// Theo dõi người dùng có đang trong transaction tự mở không (xem `Session::in_tx`).
fn track_tx(in_tx: &mut bool, sql: &str) {
    let mut words = sql
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|w| !w.is_empty());
    let first = words.next().unwrap_or("");
    let is = |kw: &str| first.eq_ignore_ascii_case(kw);
    if is("begin") || is("start") {
        *in_tx = true;
    } else if is("commit") || is("end") || is("rollback") || is("abort") {
        // `WORK`/`TRANSACTION` là từ thừa: `ROLLBACK WORK TO SAVEPOINT s` vẫn là rollback về savepoint.
        let mut rest = words.skip_while(|w| {
            w.eq_ignore_ascii_case("work") || w.eq_ignore_ascii_case("transaction")
        });
        let next = rest.next().unwrap_or("");
        let after = rest.next().unwrap_or("");
        // `... TO SAVEPOINT` và `COMMIT/ROLLBACK PREPARED` không kết thúc transaction hiện tại;
        // `... AND CHAIN` kết thúc rồi mở ngay transaction mới nên vẫn đang trong transaction
        // (`AND NO CHAIN` là mặc định, kết thúc bình thường).
        let keeps_tx = next.eq_ignore_ascii_case("to")
            || next.eq_ignore_ascii_case("prepared")
            || (next.eq_ignore_ascii_case("and") && after.eq_ignore_ascii_case("chain"));
        if !keeps_tx {
            *in_tx = false;
        }
    }
}

/// Lỗi cho `method` chỉ SQLite hỗ trợ (cây đối tượng, thông tin table).
fn unsupported() -> DbError {
    DbError::new(INVALID_REQUEST, "method not supported by driver")
}

/// Vòng lặp của actor: nhận từng `Cmd` rồi chạy tới khi gặp `Close` hoặc kênh đóng.
/// Nhận `session`, `conn_task` và `rx` theo giá trị (move): actor là chủ sở hữu duy nhất của chúng.
pub async fn run(
    id: u64,
    mut session: Session,
    conn_task: JoinHandle<()>,
    mut rx: mpsc::Receiver<Cmd>,
) {
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
                shutdown(session, conn_task).await;
                let _ = done.send(());
                return;
            }
            other => other,
        };
        // Đánh dấu đang chạy rồi mới kiểm cờ huỷ (cùng lý do với `sqlite::actor`): hoặc ta thấy
        // cờ và không chạy, hoặc `cancel` thấy `running` và gửi yêu cầu huỷ đúng request này.
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
                let (res, held) = execute(
                    &mut session,
                    &job.params.sql,
                    limits,
                    &job.cancel,
                    next_cursor,
                )
                .await;
                // Gỡ `running` TRƯỚC khi trả lời: từ đây `cancel` không gửi yêu cầu huỷ nữa.
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
    shutdown(session, conn_task).await;
}

/// Đóng connection: thả `Client` (kênh yêu cầu đóng nên connection task gửi `Terminate` rồi
/// tự thoát), chờ một lúc rồi dừng cưỡng bức nếu chưa thoát.
async fn shutdown(session: Session, mut conn_task: JoinHandle<()>) {
    drop(session);
    if tokio::time::timeout(CLOSE_TIMEOUT, &mut conn_task)
        .await
        .is_err()
    {
        conn_task.abort();
    }
}

/// Xử lý race giữa `s3b_cancel` và lúc request vừa đọc xong trang: yêu cầu huỷ đã gửi đi sẽ
/// làm câu còn dòng của cursor lỗi ở lần `fetch` sau (hoặc bị bỏ lỡ). Cờ huỷ đã bật mà còn giữ
/// cursor thì bỏ cursor ngay và trả `cancelled`. Gọi SAU `set_running(id, 0)`.
async fn drop_if_cancelled<T>(
    res: DbResult<T>,
    held: Option<Held>,
    cancel: &CancelSignal,
) -> (DbResult<T>, Option<Held>) {
    match held {
        Some(held) if cancel.is_cancelled() => {
            held.abandon().await;
            (Err(cancelled()), None)
        }
        other => (res, other),
    }
}

/// Không tham số: `query_raw`/`execute_raw` nhận iterator có biết trước độ dài.
fn no_params() -> impl ExactSizeIterator<Item = &'static (dyn tokio_postgres::types::ToSql + Sync)>
{
    std::iter::empty()
}

/// Mili giây của một khoảng thời gian, tràn thì lấy giá trị lớn nhất (không panic).
fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

/// Chạy lần lượt các câu trong `sql`, dừng ở câu lỗi đầu tiên (lỗi từng câu nằm trong
/// `StatementResult.error`, không làm hỏng cả request). Câu cuối có dòng còn dư thì trả cursor
/// để actor giữ; câu có dòng nhưng không phải câu cuối chỉ lấy trang đầu (`truncated`).
///
/// Mỗi câu `prepare` ngay trước khi chạy để thấy thay đổi schema của câu trước; kiểu cột từ đó
/// quyết định đọc nhị phân hay simple query. Lỗi cấp request (`Err`) chỉ dành cho huỷ.
async fn execute(
    session: &mut Session,
    sql: &str,
    limits: Limits,
    cancel: &CancelSignal,
    cursor_id: u64,
) -> (DbResult<Vec<StatementResult>>, Option<Held>) {
    let ranges = split(Dialect::Postgres, sql);
    let last = ranges.len().saturating_sub(1);
    let mut out: Vec<StatementResult> = Vec::with_capacity(ranges.len());
    for (index, range) in ranges.into_iter().enumerate() {
        if cancel.is_cancelled() {
            return (Err(cancelled()), None);
        }
        let text = &sql[range];
        let start = Instant::now();

        // `tokio-postgres` không nói được giao thức COPY và sẽ đóng connection khi server mở
        // COPY, nên báo lỗi ngay thay vì để mất connection.
        if first_words(text).0.eq_ignore_ascii_case("copy") {
            out.push(statement_error(
                index,
                text,
                start,
                "COPY is not supported".to_owned(),
            ));
            return (Ok(out), None);
        }
        let stmt = match or_cancel(cancel, session.client.prepare(text)).await {
            Ok(stmt) => stmt,
            Err(e) if e.code == CANCELLED => return (Err(e), None),
            Err(e) => {
                out.push(statement_error(index, text, start, e.message));
                return (Ok(out), None);
            }
        };
        // Cancel an toàn hay không phụ thuộc trạng thái transaction TRƯỚC câu này.
        let cancel_safe = !session.in_tx && is_cancel_safe(text);
        track_tx(&mut session.in_tx, text);

        // Không có cột: INSERT/UPDATE/DDL... chạy rồi báo số dòng bị ảnh hưởng.
        if stmt.columns().is_empty() {
            match or_cancel(cancel, session.client.execute_raw(&stmt, no_params())).await {
                Ok(n) => out.push(affected_statement(
                    index,
                    text.to_owned(),
                    i64::try_from(n).unwrap_or(i64::MAX),
                    start,
                )),
                Err(e) if e.code == CANCELLED => return (Err(e), None),
                Err(e) => {
                    out.push(statement_error(index, text, start, e.message));
                    return (Ok(out), None);
                }
            }
            continue;
        }

        let columns: Vec<Column> = stmt
            .columns()
            .iter()
            .map(|c| Column {
                name: c.name().to_owned(),
                ty: c.type_().name().to_owned(),
            })
            .collect();
        // Mọi cột trong danh sách thì đọc nhị phân; chỉ một cột ngoài danh sách thì cả câu chạy
        // bằng simple query (Q31=A).
        let decoders: Option<Vec<Decoder>> = stmt
            .columns()
            .iter()
            .map(|c| decoder_for(c.type_()))
            .collect();
        let source = match decoders {
            Some(decoders) => or_cancel(cancel, session.client.query_raw(&stmt, no_params()))
                .await
                .map(|stream| Source::Binary {
                    stream: Box::pin(stream),
                    decoders,
                }),
            None => or_cancel(cancel, session.client.simple_query_raw(text))
                .await
                .map(|stream| Source::Simple {
                    stream: Box::pin(stream),
                }),
        };
        let source = match source {
            Ok(source) => source,
            Err(e) if e.code == CANCELLED => return (Err(e), None),
            Err(e) => {
                out.push(statement_error(index, text, start, e.message));
                return (Ok(out), None);
            }
        };
        let mut held = Held {
            cursor_id,
            source,
            cancel_safe,
            finished: false,
            first_row_at: None,
            token: session.token.clone(),
            tls: session.tls.clone(),
        };

        match held.next_page(limits, cancel).await {
            Ok(page) => {
                let done = page.done;
                let keep = index == last && !done;
                let mut res = rows_statement(
                    index,
                    text.to_owned(),
                    columns,
                    page,
                    keep.then_some(cursor_id),
                    start,
                );
                res.first_row_ms = held
                    .first_row_at
                    .map(|t| millis(t.saturating_duration_since(start)));
                out.push(res);
                if keep {
                    return (Ok(out), Some(held));
                }
                // Câu không phải cuối còn dòng (kết quả bị cắt): bỏ phần còn lại.
                held.abandon().await;
            }
            Err(e) if e.code == CANCELLED => {
                held.abandon().await;
                return (Err(e), None);
            }
            Err(e) => {
                held.abandon().await;
                out.push(statement_error(index, text, start, e.message));
                return (Ok(out), None);
            }
        }
    }
    (Ok(out), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;
    use std::net::TcpListener;

    /// Một `tokio_postgres::Error` thật (kiểu này không tự dựng được): nối tới server giả đóng
    /// socket ngay khi nhận, nên lỗi ra rất nhanh và không cần Docker.
    async fn real_error() -> tokio_postgres::Error {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            // Nhận một connection rồi đóng ngay.
            drop(listener.accept());
        });
        let mut config = tokio_postgres::Config::new();
        config
            .host("127.0.0.1")
            .port(port)
            .user("u")
            .password("super-secret-pw")
            .connect_timeout(Duration::from_secs(5));
        config
            .connect(tokio_postgres::NoTls)
            .await
            .err()
            .expect("server giả đóng socket nên phải lỗi")
    }

    type Item = Result<i32, tokio_postgres::Error>;

    // ---- first_words ----

    #[test]
    fn first_words_returns_the_first_two_alphabetic_words() {
        assert_eq!(first_words("select 1"), ("select", ""));
        assert_eq!(first_words("SELECT * FROM t"), ("SELECT", "FROM"));
        assert_eq!(first_words("rollback to savepoint s1"), ("rollback", "to"));
        // Ký tự không phải chữ cái là dấu ngăn từ (kể cả số, `_`, dấu câu).
        assert_eq!(first_words("begin;"), ("begin", ""));
        assert_eq!(first_words("(select 1)"), ("select", ""));
        assert_eq!(first_words("  \n\tcommit   work"), ("commit", "work"));
        assert_eq!(first_words("1 select"), ("select", ""));
        assert_eq!(first_words("end/*x*/transaction"), ("end", "x"));
        assert_eq!(first_words(""), ("", ""));
        assert_eq!(first_words("123 456"), ("", ""));
        assert_eq!(first_words("héllo wörld"), ("h", "llo"));
    }

    // ---- is_cancel_safe ----

    #[test]
    fn plain_reads_are_cancel_safe() {
        for sql in [
            "select 1",
            "SELECT * FROM t WHERE a = 1",
            "SeLeCt 1",
            "values (1), (2)",
            "VALUES (1)",
            "table t",
            "TABLE public.t",
            "show all",
            "SHOW search_path",
            "select * from t for update",
            "select 'x' union all select 'y'",
        ] {
            assert!(is_cancel_safe(sql), "{sql}");
        }
    }

    #[test]
    fn with_is_cancel_safe_only_without_write_keywords() {
        assert!(is_cancel_safe("with a as (select 1) select * from a"));
        assert!(is_cancel_safe(
            "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10) SELECT * FROM r"
        ));
        // Tên chứa từ khoá nhưng không phải từ khoá.
        assert!(is_cancel_safe(
            "with update_log as (select 1) select * from update_log"
        ));
        assert!(is_cancel_safe(
            "with insertion as (select 1) select * from insertion"
        ));
        assert!(is_cancel_safe(
            "with merged as (select 1) select * from merged"
        ));
        for sql in [
            "with x as (insert into t values (1) returning *) select * from x",
            "WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x",
            "with x as (delete from t returning *) select * from x",
            "with x as (merge into t using s on true when matched then delete returning *) select 1",
            "with a as (select 1) insert into t select * from a",
            "with a as (select 1) DELETE from t",
        ] {
            assert!(!is_cancel_safe(sql), "{sql}");
        }
    }

    #[test]
    fn statements_that_write_or_are_unknown_are_not_cancel_safe() {
        for sql in [
            "insert into t values (1) returning id",
            "update t set a = 1 returning a",
            "delete from t returning a",
            "merge into t using s on true when matched then delete",
            "explain analyze select 1",
            "call proc()",
            "create table t (a int)",
            "refresh materialized view v",
            "do $$ begin end $$",
            "begin",
            "selectfoo 1",
            // Bắt đầu bằng `(` hoặc ký tự khác chữ cái: coi là không an toàn.
            "(select 1)",
            " select 1",
            "\nselect 1",
            "1",
            "",
            "-- c\nselect 1",
        ] {
            assert!(!is_cancel_safe(sql), "{sql:?}");
        }
    }

    #[test]
    fn with_keyword_inside_a_string_is_treated_conservatively() {
        // Giới hạn đã biết: không phân tích chuỗi/comment, nên từ khoá trong literal làm câu bị
        // coi là không an toàn (chỉ đọc bỏ, không huỷ); sai theo hướng an toàn.
        assert!(!is_cancel_safe(
            "with a as (select 'delete') select * from a"
        ));
    }

    // ---- track_tx ----

    fn after(start: bool, sqls: &[&str]) -> bool {
        let mut in_tx = start;
        for sql in sqls {
            track_tx(&mut in_tx, sql);
        }
        in_tx
    }

    #[test]
    fn begin_and_start_open_a_transaction() {
        for sql in [
            "begin",
            "BEGIN",
            "Begin",
            "begin transaction",
            "BEGIN ISOLATION LEVEL SERIALIZABLE",
            "begin read only",
            "start transaction",
            "START TRANSACTION READ WRITE",
        ] {
            assert!(after(false, &[sql]), "{sql}");
            // Đã trong transaction thì vẫn trong transaction.
            assert!(after(true, &[sql]), "{sql}");
        }
    }

    #[test]
    fn commit_end_rollback_abort_close_the_transaction() {
        for sql in [
            "commit",
            "COMMIT",
            "commit work",
            "commit transaction",
            "end",
            "END TRANSACTION",
            "rollback",
            "ROLLBACK",
            "rollback work",
            "abort",
            "ABORT WORK",
        ] {
            assert!(!after(true, &[sql]), "{sql}");
            assert!(!after(false, &[sql]), "{sql}");
        }
    }

    #[test]
    fn rollback_to_savepoint_and_prepared_do_not_end_the_transaction() {
        for sql in [
            "rollback to savepoint s1",
            "ROLLBACK TO s1",
            "rollback to s1",
            "commit prepared 'tx1'",
            "rollback prepared 'tx1'",
            "COMMIT PREPARED 'tx1'",
        ] {
            assert!(after(true, &[sql]), "{sql}");
            assert!(!after(false, &[sql]), "{sql}");
        }
    }

    #[test]
    fn other_statements_leave_the_transaction_state_alone() {
        for sql in [
            "select 1",
            "savepoint s1",
            "release savepoint s1",
            "insert into t values (1)",
            "set transaction isolation level serializable",
            "",
            // Không phải từ `begin`/`end`/`commit` nguyên vẹn.
            "beginning",
            "endpoint",
            "commits",
        ] {
            assert!(after(true, &[sql]), "{sql:?}");
            assert!(!after(false, &[sql]), "{sql:?}");
        }
    }

    #[test]
    fn transaction_state_follows_a_script() {
        assert!(after(
            false,
            &["begin", "select 1", "savepoint a", "rollback to a"]
        ));
        assert!(!after(false, &["begin", "select 1", "commit"]));
        assert!(after(false, &["begin", "commit", "begin"]));
        assert!(!after(false, &["begin", "rollback to a", "rollback"]));
        assert!(!after(false, &["start transaction", "end", "select 1"]));
    }

    #[test]
    fn rollback_work_to_savepoint_does_not_end_the_transaction() {
        // Từ thứ hai là `work`/`transaction`, `to` là từ thứ ba nên `track_tx` không nhận ra.
        for sql in [
            "rollback work to savepoint s1",
            "ROLLBACK TRANSACTION TO SAVEPOINT s1",
            "rollback work to s1",
        ] {
            assert!(after(true, &[sql]), "{sql}");
        }
    }

    #[test]
    fn and_chain_keeps_the_transaction_open() {
        for sql in [
            "commit and chain",
            "COMMIT AND CHAIN",
            "rollback work and chain",
            "ROLLBACK TRANSACTION AND CHAIN",
            "end and chain",
            "abort and chain;",
        ] {
            assert!(after(true, &[sql]), "{sql}");
            assert!(!after(false, &[sql]), "{sql}");
        }
    }

    #[test]
    fn and_no_chain_and_noise_words_end_the_transaction() {
        for sql in [
            "commit and no chain",
            "ROLLBACK WORK AND NO CHAIN",
            "COMMIT WORK",
            "END TRANSACTION",
            "abort",
            "commit;",
            "commit\n",
            "\n  rollback\n;\n",
            "commit transaction and no chain;",
        ] {
            assert!(!after(true, &[sql]), "{sql:?}");
        }
    }

    #[test]
    fn semicolons_and_newlines_do_not_change_the_result() {
        for sql in [
            "rollback\nto\nsavepoint s1;",
            "ROLLBACK TRANSACTION\n  TO SAVEPOINT s1\n;",
            "commit\nand\nchain;",
            "commit prepared 'x';",
        ] {
            assert!(after(true, &[sql]), "{sql:?}");
        }
        assert!(!after(true, &["commit\n;"]));
    }

    // ---- COPY ----

    #[test]
    fn copy_is_detected_even_after_comments_and_in_scripts() {
        let first_of = |sql: &str| -> Vec<String> {
            split(Dialect::Postgres, sql)
                .into_iter()
                .map(|r| first_words(&sql[r]).0.to_ascii_lowercase())
                .collect()
        };
        assert_eq!(first_of("COPY t TO STDOUT"), ["copy"]);
        assert_eq!(first_of("copy t from stdin"), ["copy"]);
        assert_eq!(first_of("-- c\ncopy t to stdout"), ["copy"]);
        assert_eq!(first_of("/* c */ Copy (select 1) to stdout"), ["copy"]);
        assert_eq!(first_of("select 1; copy t to stdout"), ["select", "copy"]);
        // Không nhầm với câu chỉ chứa chữ `copy`.
        assert_eq!(first_of("select 'copy'"), ["select"]);
        assert_eq!(first_of("select * from copy_t"), ["select"]);
        assert_eq!(first_of("create table copy_t (a int)"), ["create"]);
    }

    // ---- hàm nhỏ ----

    #[test]
    fn millis_saturates_instead_of_overflowing() {
        assert_eq!(millis(Duration::ZERO), 0);
        assert_eq!(millis(Duration::from_millis(1500)), 1500);
        assert_eq!(millis(Duration::from_micros(999)), 0);
        assert_eq!(millis(Duration::MAX), u64::MAX);
    }

    #[test]
    fn unsupported_is_an_invalid_request() {
        let e = unsupported();
        assert_eq!(e.code, INVALID_REQUEST);
        assert_eq!(e.message, "method not supported by driver");
    }

    #[test]
    fn no_params_is_an_empty_exact_size_iterator() {
        let it = no_params();
        assert_eq!(it.len(), 0);
        assert_eq!(it.count(), 0);
    }

    #[test]
    fn raw_borrows_the_bytes_for_every_type() {
        for ty in [Type::INT4, Type::MONEY, Type::TEXT, Type::RECORD] {
            assert!(Raw::accepts(&ty), "{ty}");
        }
        let bytes = [1u8, 2, 3];
        let raw = Raw::from_sql(&Type::INT4, &bytes).ok().unwrap();
        assert_eq!(raw.0, &bytes);
        // NULL không do `Raw` xử lý: `Option<Raw>` cho `None`.
        let null = <Option<Raw<'_>> as FromSql>::from_sql_null(&Type::INT4);
        assert!(null.ok().unwrap().is_none());
    }

    // ---- db_error ----

    #[tokio::test]
    async fn db_error_is_sql_error_with_the_server_text() {
        let e = real_error().await;
        let cancel = CancelSignal::new();
        let mapped = db_error(&e, &cancel);
        assert_eq!(mapped.code, SQL_ERROR);
        assert_eq!(mapped.message, error_text(&e));
        assert!(!mapped.message.is_empty());
        // Thông báo lỗi không được chứa mật khẩu.
        assert!(!mapped.message.contains("super-secret-pw"));
    }

    #[tokio::test]
    async fn db_error_after_cancel_is_cancelled() {
        let e = real_error().await;
        let cancel = CancelSignal::new();
        cancel.cancel();
        let mapped = db_error(&e, &cancel);
        assert_eq!(mapped.code, CANCELLED);
    }

    // ---- or_cancel ----

    #[tokio::test]
    async fn or_cancel_returns_the_value_when_not_cancelled() {
        let cancel = CancelSignal::new();
        let r = or_cancel(&cancel, async { Ok::<_, tokio_postgres::Error>(5) }).await;
        assert_eq!(r.ok(), Some(5));
    }

    #[tokio::test]
    async fn or_cancel_maps_errors_to_sql_error() {
        let e = real_error().await;
        let text = error_text(&e);
        let cancel = CancelSignal::new();
        let r = or_cancel(&cancel, async { Err::<i32, _>(e) }).await;
        let err = r.err().unwrap();
        assert_eq!(err.code, SQL_ERROR);
        assert_eq!(err.message, text);
    }

    #[tokio::test]
    async fn or_cancel_prefers_cancellation_even_when_the_future_is_ready() {
        let cancel = CancelSignal::new();
        cancel.cancel();
        let r = or_cancel(&cancel, async { Ok::<_, tokio_postgres::Error>(5) }).await;
        assert_eq!(r.err().unwrap().code, CANCELLED);
    }

    #[tokio::test]
    async fn or_cancel_stops_waiting_when_cancelled_later() {
        let cancel = CancelSignal::new();
        let never = std::future::pending::<Item>();
        let (r, ()) = tokio::join!(or_cancel(&cancel, never), async {
            tokio::task::yield_now().await;
            cancel.cancel();
        });
        assert_eq!(r.err().unwrap().code, CANCELLED);
    }

    // ---- next_item ----

    #[tokio::test]
    async fn next_item_yields_items_then_none() {
        let cancel = CancelSignal::new();
        let mut s = stream::iter(vec![Ok(1), Ok(2)] as Vec<Item>);
        assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(1))));
        assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(2))));
        assert!(matches!(next_item(&mut s, &cancel).await, Ok(None)));
    }

    #[tokio::test]
    async fn next_item_reports_server_errors() {
        let e = real_error().await;
        let text = error_text(&e);
        let cancel = CancelSignal::new();
        let mut s = stream::iter(vec![Err(e)] as Vec<Item>);
        match next_item(&mut s, &cancel).await {
            Err(Fail::Server(err)) => {
                assert_eq!(err.code, SQL_ERROR);
                assert_eq!(err.message, text);
            }
            _ => panic!("phải là lỗi của server"),
        }
    }

    #[tokio::test]
    async fn next_item_turns_server_errors_into_cancelled_after_cancel() {
        // Server báo "canceling statement" sau yêu cầu huỷ: người dùng thấy `cancelled`.
        let e = real_error().await;
        let cancel = CancelSignal::new();
        cancel.cancel();
        let mut s = stream::iter(vec![Err(e)] as Vec<Item>);
        match next_item(&mut s, &cancel).await {
            Err(Fail::Server(err)) => assert_eq!(err.code, CANCELLED),
            _ => panic!("phải là lỗi cancelled"),
        }
    }

    #[tokio::test]
    async fn next_item_fast_path_ignores_a_cancel_flag_when_a_row_is_buffered() {
        // Dòng đã nằm sẵn trong buffer thì lấy luôn; vòng `next_page` mới là nơi kiểm cờ huỷ.
        let cancel = CancelSignal::new();
        cancel.cancel();
        let mut s = stream::iter(vec![Ok(7)] as Vec<Item>);
        assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(7))));
    }

    #[tokio::test]
    async fn next_item_stops_waiting_when_cancelled() {
        let cancel = CancelSignal::new();
        let mut s = stream::pending::<Item>();
        let (r, ()) = tokio::join!(next_item(&mut s, &cancel), async {
            tokio::task::yield_now().await;
            cancel.cancel();
        });
        assert!(matches!(r, Err(Fail::Cancelled)));
    }

    #[tokio::test]
    async fn next_item_returns_cancelled_at_once_when_already_cancelled_and_idle() {
        let cancel = CancelSignal::new();
        cancel.cancel();
        let mut s = stream::pending::<Item>();
        assert!(matches!(
            next_item(&mut s, &cancel).await,
            Err(Fail::Cancelled)
        ));
    }

    // ---- drop_if_cancelled ----

    #[tokio::test]
    async fn drop_if_cancelled_without_a_cursor_keeps_the_result() {
        let cancel = CancelSignal::new();
        let (res, held) = drop_if_cancelled(Ok(3), None, &cancel).await;
        assert_eq!(res.ok(), Some(3));
        assert!(held.is_none());
        // Cờ huỷ bật mà không có cursor thì kết quả giữ nguyên (không có gì để bỏ).
        cancel.cancel();
        let (res, held) = drop_if_cancelled(Ok(4), None, &cancel).await;
        assert_eq!(res.ok(), Some(4));
        assert!(held.is_none());
        let (res, _) = drop_if_cancelled::<i32>(Err(unsupported()), None, &cancel).await;
        assert_eq!(res.err().unwrap().code, INVALID_REQUEST);
    }
}
