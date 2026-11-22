//! Driver MySQL và MariaDB (cùng một giao thức, cùng một code): mỗi connection là một actor
//! tokio sở hữu một `mysql_async::Conn`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd` qua
//! kênh tới `actor::run` của connection, actor chạy SQL rồi trả kết quả ngược qua kênh (xem
//! `drivers` về mô hình actor). Dòng kết quả đọc bằng giao thức text của `mysql_async` rồi
//! đổi trong `value`.
//!
//! `open` nối TCP (và TLS theo `tls.mode`), đăng ký connection vào registry cùng một
//! `MySqlInterrupt` để `s3b_cancel` huỷ được câu đang chạy. MySQL không có "cancel request"
//! như PostgreSQL: muốn huỷ phải mở một connection phụ rồi gửi `KILL QUERY <thread id>`, nên
//! `Shared` giữ thread id và `Opts` (kể cả TLS) để mở được connection phụ đó khi cần.
//!
//! MySQL và MariaDB khác nhau ở những chỗ driver này không phải xử lý riêng: cả hai nói chung
//! giao thức, cùng cú pháp `KILL QUERY`. Chỗ khác duy nhất người dùng thấy: MariaDB báo cột
//! `JSON` là `longtext` (xem `value::type_name`). Tên driver (`mysql`/`mariadb`) chỉ để ghi nhận.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Arc<T>`: con trỏ đếm tham chiếu, nhiều chỗ cùng giữ một giá trị (ở đây `Shared` được
//!   actor, cursor và `interrupt` cùng dùng).
//! - `AtomicU64`/`AtomicBool`: biến mà nhiều thread đọc/ghi được không cần khoá (giống
//!   `sync/atomic` của Go).
//! - `tokio::time::timeout`: bọc một future, quá hạn thì bỏ nó và trả `Err(Elapsed)`.

/// Vòng lặp actor, chạy câu SQL, cursor.
mod actor;
/// Đổi cột và ô sang tên kiểu/chuỗi hiển thị.
mod value;

use crate::drivers::tls;
use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, OPEN_FAILED, OpenParams, OpenResult, TlsMode, TlsParams,
};
use crate::registry::{self, Interrupt};
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts, OptsBuilder, SslOpts};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::sync::mpsc;

/// Tên driver MySQL trong `open.driver`.
pub const DRIVER: &str = "mysql";
/// Tên driver MariaDB trong `open.driver`.
pub const MARIADB: &str = "mariadb";

/// Tổng thời gian cho cả quá trình nối (gồm lần thử lại khi `allow`/`prefer`).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Chờ tối đa bao lâu để connection phụ nối xong và gửi xong `KILL QUERY`.
const KILL_TIMEOUT: Duration = Duration::from_secs(5);
/// Cổng mặc định của MySQL/MariaDB.
const DEFAULT_PORT: u16 = 3306;
/// Chạy ngay sau khi nối. Server ngắt câu đang gửi dòng nếu client không đọc trong
/// `net_write_timeout` (mặc định 60 giây), mà cursor có thể nằm yên lâu giữa hai lần `fetch`,
/// nên nâng lên 1 giờ cho riêng connection này.
const INIT: &str = "SET SESSION net_write_timeout = 3600";

/// Trạng thái dùng chung giữa actor, cursor và `MySqlInterrupt` (khác thread nên đặt sau `Arc`).
pub(super) struct Shared {
    /// Cấu hình nối của connection phụ gửi `KILL QUERY`: cùng host/user/TLS với connection gốc,
    /// không có lệnh `INIT`. Chứa mật khẩu nên chỉ nằm trong RAM, không bao giờ in ra.
    kill_opts: Opts,
    /// Id thread của connection gốc trên server (`KILL QUERY` nhắm vào nó).
    thread_id: u32,
    /// Số thứ tự của lần chạy câu/đọc trang gần nhất (tăng mỗi lần `begin`).
    seq: AtomicU64,
    /// Đang có một câu/lần đọc trang chạy phía server (từ `begin` tới khi `Op` bị thả).
    busy: AtomicBool,
    /// Connection hỏng không dùng tiếp được (câu bị huỷ mà server không kết thúc, hoặc đọc bỏ
    /// quá hạn): giao thức đã lệch nhịp nên actor từ chối mọi lệnh sau đó.
    broken: AtomicBool,
    /// `interrupt` chạy ở thread của Go (ngoài runtime) nên giữ `Handle` để spawn task.
    handle: Handle,
}

impl Shared {
    /// Đánh dấu bắt đầu một lần chạy phía server. `Err(cancelled)` nếu request đã bị huỷ.
    ///
    /// Thứ tự "bật `busy` rồi mới đọc cờ huỷ" khớp với `Registry::cancel` ("đặt cờ huỷ rồi mới
    /// đọc `busy` trong `interrupt`"): luôn có ít nhất một bên thấy bên kia, nên không có
    /// request bị huỷ mà vừa không chạy vừa không bị `KILL`.
    pub(super) fn begin(&self, cancel: &registry::CancelSignal) -> DbResult<Op<'_>> {
        self.seq.fetch_add(1, Ordering::SeqCst);
        self.busy.store(true, Ordering::SeqCst);
        let op = Op(self);
        if cancel.is_cancelled() {
            return Err(crate::drivers::common::cancelled());
        }
        Ok(op)
    }

    /// Connection đã hỏng chưa.
    pub(super) fn is_broken(&self) -> bool {
        self.broken.load(Ordering::SeqCst)
    }

    /// Đánh dấu connection hỏng.
    pub(super) fn mark_broken(&self) {
        self.broken.store(true, Ordering::SeqCst);
    }

    /// Còn đúng lần chạy `seq` đang chạy phía server không (dùng để không `KILL` nhầm câu sau).
    fn is_running(&self, seq: u64) -> bool {
        self.busy.load(Ordering::SeqCst) && self.seq.load(Ordering::SeqCst) == seq
    }
}

/// Giữ `busy` bật trong lúc một câu/lần đọc trang chạy; thả thì tắt (như `defer` của Go).
pub(super) struct Op<'a>(&'a Shared);

impl Drop for Op<'_> {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::SeqCst);
    }
}

/// Mở connection: nối, đăng ký registry rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    let Some(host) = p.host.as_deref().filter(|h| !h.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing host"));
    };
    let Some(user) = p.username.as_deref().filter(|u| !u.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing username"));
    };
    let driver = if p.driver == MARIADB { MARIADB } else { DRIVER };
    let ssl = ssl_opts(&p.tls)?;

    let base = OptsBuilder::default()
        .ip_or_hostname(host)
        .tcp_port(p.port.unwrap_or(DEFAULT_PORT))
        .user(Some(user))
        .pass(p.password.as_deref())
        // Vắng hoặc rỗng thì không chọn database nào (người dùng gõ `USE`).
        .db_name(p.database.as_deref().filter(|d| !d.is_empty()))
        // Chỉ dùng giao thức text, không cần cache câu đã chuẩn bị; không dùng unix socket.
        .stmt_cache_size(0usize)
        .prefer_socket(false)
        .tcp_nodelay(true);

    let (conn, kill_opts) = tokio::time::timeout(CONNECT_TIMEOUT, connect(&base, p.tls.mode, ssl))
        .await
        .map_err(|_| DbError::new(OPEN_FAILED, "connection timed out"))??;

    let shared = Arc::new(Shared {
        kill_opts,
        thread_id: conn.id(),
        seq: AtomicU64::new(0),
        busy: AtomicBool::new(false),
        broken: AtomicBool::new(false),
        handle: Handle::current(),
    });
    let session = actor::Session::new(conn, shared.clone());
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, driver, tx, Arc::new(MySqlInterrupt(shared)));
    tokio::spawn(actor::run(id, session, rx));
    Ok(OpenResult { conn_id: id })
}

/// Cấu hình TLS của `mysql_async` theo `tls.mode`; `None` = không dùng TLS (`disable`).
///
/// `mysql_async` chỉ nhận chứng chỉ gốc và hai cờ (bỏ kiểm chuỗi CA, bỏ kiểm hostname), không
/// nhận `ClientConfig` tự dựng, nên ánh xạ gần nhất so với `drivers::tls` (dùng cho PostgreSQL):
/// - `allow`/`prefer`/`require`: mã hoá, không kiểm chứng chỉ (giống `drivers::tls`).
/// - `verify-ca`: ý định là kiểm chuỗi CA, bỏ kiểm hostname, nhưng KHÔNG đạt được: `mysql_async`
///   nhận ra lỗi "sai tên" bằng cách tìm chuỗi `NotValidForName` trong `to_string()` của lỗi
///   rustls, mà rustls 0.23 không còn in tên đó, nên cờ bỏ kiểm hostname vô hiệu và `verify-ca`
///   thực tế nghiêm ngặt như `verify-full` (an toàn hơn, chỉ khác là kết nối bằng tên/IP không có
///   trong chứng chỉ thì bị từ chối). Vẫn đặt cờ để khi thư viện sửa thì có đúng hành vi.
/// - `verify-full`: kiểm cả chuỗi CA lẫn hostname.
///
/// Tin cậy: chỉ CA trong `caFile` nếu có, không thì kho chứng chỉ Windows (`root_certs_der`
/// đã gồm kho Windows); không tin thêm bộ CA có sẵn của `mysql_async` (`webpki-roots`).
fn ssl_opts(tls: &TlsParams) -> DbResult<Option<SslOpts>> {
    let verify = match tls.mode {
        TlsMode::Disable => return Ok(None),
        TlsMode::Allow | TlsMode::Prefer | TlsMode::Require => {
            return Ok(Some(
                SslOpts::default()
                    .with_danger_accept_invalid_certs(true)
                    .with_danger_skip_domain_validation(true),
            ));
        }
        TlsMode::VerifyCa | TlsMode::VerifyFull => tls.mode,
    };
    let ca = tls.ca_file.as_deref().filter(|path| !path.is_empty());
    let roots = tls::root_certs_der(ca)?
        .into_iter()
        .map(|cert| cert.as_ref().to_vec().into())
        .collect();
    Ok(Some(
        SslOpts::default()
            .with_root_certs(roots)
            // `roots` đã đủ (caFile hoặc kho Windows) nên luôn tắt bộ CA có sẵn.
            .with_disable_built_in_roots(true)
            .with_danger_skip_domain_validation(verify == TlsMode::VerifyCa),
    ))
}

/// Thử nối theo thứ tự của libpq (giống driver PostgreSQL): `disable` chỉ thường, `allow`
/// thường rồi TLS, `prefer` TLS rồi thường, các mode còn lại chỉ TLS. Trả lỗi của lần thử cuối.
/// Kết quả: connection và `Opts` của connection phụ (cùng kiểu TLS với lần nối thành công).
async fn connect(
    base: &OptsBuilder,
    mode: TlsMode,
    ssl: Option<SslOpts>,
) -> DbResult<(Conn, Opts)> {
    let order: &[bool] = match (mode, &ssl) {
        (TlsMode::Allow, Some(_)) => &[false, true],
        (TlsMode::Prefer, Some(_)) => &[true, false],
        (_, Some(_)) => &[true],
        (_, None) => &[false],
    };
    let mut last = DbError::new(OPEN_FAILED, "connection failed");
    for &use_tls in order {
        let attempt = base.clone().ssl_opts(ssl.clone().filter(|_| use_tls));
        let kill_opts = Opts::from(attempt.clone());
        match Conn::new(Opts::from(attempt.init(vec![INIT]))).await {
            Ok(conn) => return Ok((conn, kill_opts)),
            Err(e) => last = DbError::new(OPEN_FAILED, error_text(&e)),
        }
    }
    Err(last)
}

/// Lỗi của `mysql_async` thành chuỗi: lỗi từ server có dạng `ERROR 1045 (28000): ...` giống
/// client `mysql`. Không chứa mật khẩu (câu "using password: YES" của server chỉ nói có dùng
/// hay không).
pub(super) fn error_text(e: &mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(s) => format!("ERROR {} ({}): {}", s.code, s.state, s.message),
        // `Error::Io` tự thêm tiền tố "Input/output error:" nên lấy lỗi bên trong cho khỏi lặp.
        mysql_async::Error::Io(io) => io.to_string(),
        other => other.to_string(),
    }
}

/// Huỷ câu đang chạy của connection gốc bằng `KILL QUERY` qua một connection phụ (mở khi cần,
/// đóng ngay sau đó). Lỗi bị bỏ qua vì huỷ là best effort.
///
/// `only_seq` là lần chạy phía server mà người gọi muốn huỷ: nối xong mà lần đó đã kết thúc (hoặc
/// connection đã chạy câu khác) thì không gửi, kẻo huỷ nhầm câu sau. `None` = luôn gửi (actor tự
/// huỷ câu đang đọc bỏ, biết chắc nó còn chạy). Còn một khe hở nhỏ giữa lúc kiểm và lúc server
/// nhận lệnh, bằng một lượt đi-về của mạng.
pub(super) async fn kill_query(shared: &Shared, only_seq: Option<u64>) {
    let kill = async {
        let Ok(mut conn) = Conn::new(shared.kill_opts.clone()).await else {
            return;
        };
        if only_seq.is_none_or(|seq| shared.is_running(seq)) {
            let _ = conn
                .query_drop(format!("KILL QUERY {}", shared.thread_id))
                .await;
        }
        let _ = conn.disconnect().await;
    };
    let _ = tokio::time::timeout(KILL_TIMEOUT, kill).await;
}

/// Huỷ câu đang chạy khi `s3b_cancel` (hoặc `close`) gọi, từ thread bất kỳ của Go.
struct MySqlInterrupt(Arc<Shared>);

/// `interrupt` không được chặn thread gọi nên chỉ spawn một task gửi `KILL QUERY` rồi trả về ngay.
impl Interrupt for MySqlInterrupt {
    fn interrupt(&self) {
        let shared = &self.0;
        // Không có câu nào chạy phía server (actor đang giữa hai câu): actor tự thấy cờ huỷ ở
        // chỗ `begin` hoặc đầu câu kế tiếp, không cần `KILL`.
        if !shared.busy.load(Ordering::SeqCst) {
            return;
        }
        let seq = shared.seq.load(Ordering::SeqCst);
        let shared = shared.clone();
        self.0
            .handle
            .spawn(async move { kill_query(&shared, Some(seq)).await });
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mysql/mod.rs"]
mod tests;
