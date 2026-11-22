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
mod tests {
    use super::*;
    use crate::drivers::common::cancelled;
    use crate::protocol::CANCELLED;
    use crate::registry::CancelSignal;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

    /// Id thread mà server giả báo trong lời chào; `conn.id()` của client phải bằng nó.
    const THREAD_ID: u32 = 4242;
    const PASSWORD: &str = "super-secret-pw";

    // ---- server MySQL giả ----

    /// Ghi một gói của giao thức MySQL: 3 byte độ dài (little-endian) + 1 byte số thứ tự + nội dung.
    fn write_packet(s: &mut TcpStream, seq: u8, payload: &[u8]) {
        let mut buf = Vec::with_capacity(4 + payload.len());
        buf.extend_from_slice(&u32::try_from(payload.len()).unwrap().to_le_bytes()[..3]);
        buf.push(seq);
        buf.extend_from_slice(payload);
        let _ = s.write_all(&buf);
    }

    fn read_packet(s: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
        let mut head = [0u8; 4];
        s.read_exact(&mut head).ok()?;
        let len = u32::from_le_bytes([head[0], head[1], head[2], 0]) as usize;
        let mut payload = vec![0u8; len];
        s.read_exact(&mut payload).ok()?;
        Some((head[3], payload))
    }

    /// Gói chào (Initial Handshake v10): server nói trước. Khai báo hỗ trợ SSL để client chịu
    /// gửi SSLRequest khi có cấu hình TLS (không có cờ này client từ chối ngay).
    fn greeting() -> Vec<u8> {
        let mut p = vec![0x0a];
        p.extend_from_slice(b"8.0.0\0");
        p.extend_from_slice(&THREAD_ID.to_le_bytes());
        p.extend_from_slice(b"abcdefgh\0");
        // LONG_PASSWORD | PROTOCOL_41 | SSL | SECURE_CONNECTION.
        p.extend_from_slice(&0x8a01u16.to_le_bytes());
        p.push(45);
        p.extend_from_slice(&2u16.to_le_bytes());
        // PLUGIN_AUTH (nửa cao của cờ khả năng).
        p.extend_from_slice(&0x0008u16.to_le_bytes());
        p.push(21);
        p.extend_from_slice(&[0u8; 10]);
        p.extend_from_slice(b"ijklmnopqrst\0");
        p.extend_from_slice(b"mysql_native_password\0");
        p
    }

    /// Gói OK rỗng.
    const OK: [u8; 7] = [0, 0, 0, 2, 0, 0, 0];

    /// Phục vụ một connection. Ghi vào `log`: `ssl` (client gửi SSLRequest, 32 byte), `plain`
    /// (gửi thẳng HandshakeResponse) rồi mỗi câu lệnh dạng `q:<sql>`. `accept = false` thì đóng
    /// socket ngay sau đó (nối thất bại); `true` thì trả OK cho đăng nhập và mọi câu lệnh.
    fn serve(mut s: TcpStream, accept: bool, log: UnboundedSender<String>) {
        write_packet(&mut s, 0, &greeting());
        let Some((seq, first)) = read_packet(&mut s) else {
            return;
        };
        if first.len() == 32 {
            let _ = log.send("ssl".into());
            return;
        }
        let _ = log.send("plain".into());
        if !accept {
            return;
        }
        write_packet(&mut s, seq + 1, &OK);
        // 0x03 = COM_QUERY; mọi lệnh khác (COM_QUIT...) kết thúc connection.
        while let Some((_, p)) = read_packet(&mut s) {
            if p.first() != Some(&0x03) {
                return;
            }
            let _ = log.send(format!("q:{}", String::from_utf8_lossy(&p[1..])));
            write_packet(&mut s, 1, &OK);
        }
    }

    /// Server giả: trả cổng và kênh nhận log. Thread chặn ở `accept` tới hết process; cổng tự
    /// chọn nên các test không đụng nhau.
    fn fake_server(accept: bool) -> (u16, UnboundedReceiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = unbounded_channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let log = tx.clone();
                std::thread::spawn(move || serve(stream, accept, log));
            }
        });
        (port, rx)
    }

    /// Server nhận TCP nhưng không nói gì (để thử timeout). Giữ socket mở tới hết process.
    fn silent_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                held.push(stream);
            }
        });
        port
    }

    /// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
    fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    /// Lấy hết những gì đã có trong log (không chờ).
    fn drain(rx: &mut UnboundedReceiver<String>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(line) = rx.try_recv() {
            out.push(line);
        }
        out
    }

    /// Chờ dòng log kế tiếp (có chặn trên để test không treo nếu code sai).
    async fn next(rx: &mut UnboundedReceiver<String>) -> String {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("hết hạn chờ server giả")
            .expect("server giả đóng kênh")
    }

    /// Cấu hình nối tới `port`. Đặt sẵn `max_allowed_packet`/`wait_timeout` để client khỏi hỏi
    /// server hai biến đó lúc nối (server giả không trả được result set).
    fn base(port: u16) -> OptsBuilder {
        OptsBuilder::default()
            .ip_or_hostname("127.0.0.1")
            .tcp_port(port)
            .user(Some("u"))
            .pass(Some(PASSWORD))
            .prefer_socket(false)
            .stmt_cache_size(0usize)
            .max_allowed_packet(Some(1 << 24))
            .wait_timeout(Some(3600))
    }

    fn tls(mode: TlsMode, ca_file: Option<&str>) -> TlsParams {
        TlsParams {
            mode,
            ca_file: ca_file.map(str::to_owned),
        }
    }

    /// File trong `rust/tests/fixtures/` (cert dựng sẵn, không cần Docker).
    fn fx(name: &str) -> String {
        format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    fn params(json: serde_json::Value) -> OpenParams {
        serde_json::from_value(json).unwrap()
    }

    /// `Shared` trỏ tới server giả `port`, thread id 777.
    fn shared(port: u16) -> Arc<Shared> {
        Arc::new(Shared {
            kill_opts: Opts::from(base(port)),
            thread_id: 777,
            seq: AtomicU64::new(0),
            busy: AtomicBool::new(false),
            broken: AtomicBool::new(false),
            handle: Handle::current(),
        })
    }

    /// Thứ tự các lần nối server giả thấy khi `connect` ở `mode` (server luôn đóng socket),
    /// kèm lỗi cuối.
    async fn attempts(mode: TlsMode, ssl: Option<SslOpts>) -> (Vec<String>, DbError) {
        tls::install_provider();
        let (port, mut rx) = fake_server(false);
        let Err(err) = connect(&base(port), mode, ssl).await else {
            panic!("server giả không bao giờ cho nối");
        };
        (drain(&mut rx), err)
    }

    // ---- ssl_opts: ánh xạ 6 mode ----

    #[test]
    fn disable_has_no_ssl_opts_even_with_a_bad_ca_file() {
        assert!(
            ssl_opts(&tls(TlsMode::Disable, Some("Z:/khong/ton/tai.pem")))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn allow_prefer_require_encrypt_without_verifying_and_ignore_ca_file() {
        for mode in [TlsMode::Allow, TlsMode::Prefer, TlsMode::Require] {
            // caFile hỏng cũng không sao: các mode này không dùng tới nó.
            let o = ssl_opts(&tls(mode, Some("Z:/khong/ton/tai.pem")))
                .unwrap()
                .unwrap();
            assert!(o.accept_invalid_certs(), "{mode:?}");
            assert!(o.skip_domain_validation(), "{mode:?}");
            assert!(o.root_certs().is_empty(), "{mode:?}");
            assert!(!o.disable_built_in_roots(), "{mode:?}");
        }
    }

    #[test]
    fn verify_ca_skips_only_the_hostname_check() {
        let ca = fx("ca.pem");
        let o = ssl_opts(&tls(TlsMode::VerifyCa, Some(&ca)))
            .unwrap()
            .unwrap();
        assert!(!o.accept_invalid_certs());
        assert!(o.skip_domain_validation());
    }

    #[test]
    fn verify_full_checks_chain_and_hostname() {
        let ca = fx("ca.pem");
        let o = ssl_opts(&tls(TlsMode::VerifyFull, Some(&ca)))
            .unwrap()
            .unwrap();
        assert!(!o.accept_invalid_certs());
        assert!(!o.skip_domain_validation());
    }

    #[test]
    fn verify_modes_with_ca_file_trust_only_that_file() {
        let ca = fx("ca.pem");
        let mut bundle = std::fs::read(&ca).unwrap();
        bundle.extend(std::fs::read(fx("ca_other.pem")).unwrap());
        let two = std::env::temp_dir().join(format!("s3b_my_ca_{}.pem", std::process::id()));
        std::fs::write(&two, &bundle).unwrap();
        for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
            let one = ssl_opts(&tls(mode, Some(&ca))).unwrap().unwrap();
            assert_eq!(one.root_certs().len(), 1, "{mode:?}");
            assert!(one.disable_built_in_roots(), "{mode:?}");
            let both = ssl_opts(&tls(mode, two.to_str())).unwrap().unwrap();
            assert_eq!(both.root_certs().len(), 2, "{mode:?}");
            assert!(both.disable_built_in_roots(), "{mode:?}");
        }
        let _ = std::fs::remove_file(&two);
    }

    #[test]
    fn verify_modes_without_ca_file_use_only_the_windows_store_and_never_built_in_roots() {
        for ca in [None, Some("")] {
            for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
                let o = ssl_opts(&tls(mode, ca)).unwrap().unwrap();
                assert!(!o.root_certs().is_empty(), "{mode:?}: kho Windows rỗng");
                // C1: `roots` đã là kho Windows nên bộ CA có sẵn luôn tắt.
                assert!(o.disable_built_in_roots(), "{mode:?}");
            }
        }
    }

    #[test]
    fn verify_modes_with_a_bad_ca_file_fail_with_open_failed() {
        for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
            let Err(e) = ssl_opts(&tls(mode, Some("Z:/khong/ton/tai.pem"))) else {
                panic!("{mode:?} phải lỗi");
            };
            assert_eq!(e.code, OPEN_FAILED);
            assert!(!e.message.contains("khong/ton/tai"), "{}", e.message);
        }
    }

    // ---- open: kiểm input ----

    #[tokio::test]
    async fn open_requires_a_host() {
        for host in [serde_json::Value::Null, serde_json::json!("")] {
            let p = params(serde_json::json!({
                "driver": "mysql", "host": host, "username": "u"
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, INVALID_REQUEST);
            assert_eq!(err.message, "missing host");
        }
        let p = params(serde_json::json!({"driver": "mariadb", "username": "u"}));
        assert_eq!(open(p).await.err().unwrap().code, INVALID_REQUEST);
    }

    #[tokio::test]
    async fn open_requires_a_username() {
        for user in [serde_json::Value::Null, serde_json::json!("")] {
            let p = params(serde_json::json!({
                "driver": "mysql", "host": "127.0.0.1", "username": user
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, INVALID_REQUEST);
            assert_eq!(err.message, "missing username");
        }
    }

    #[tokio::test]
    async fn open_with_unreadable_ca_file_fails_before_connecting() {
        // Cổng đóng: nếu code có nối thì lỗi sẽ là lỗi nối, không phải lỗi CA.
        let port = closed_port();
        for mode in ["verify-ca", "verify-full"] {
            let p = params(serde_json::json!({
                "driver": "mysql", "host": "127.0.0.1", "port": port, "username": "u",
                "password": PASSWORD,
                "tls": {"mode": mode, "caFile": "Z:/khong/ton/tai/ca.pem"}
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, OPEN_FAILED, "{mode}");
            assert!(err.message.contains("caFile"), "{}", err.message);
            assert!(!err.message.contains(PASSWORD));
        }
    }

    #[tokio::test]
    async fn open_to_a_refused_port_is_open_failed_without_the_password() {
        let p = params(serde_json::json!({
            "driver": "mysql", "host": "127.0.0.1", "port": closed_port(),
            "username": "u", "password": PASSWORD
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED);
        assert!(!err.message.is_empty());
        assert!(!err.message.contains(PASSWORD), "{}", err.message);
    }

    #[tokio::test]
    async fn open_to_a_server_that_hangs_up_is_open_failed() {
        for driver in ["mysql", "mariadb"] {
            let (port, mut rx) = fake_server(false);
            let p = params(serde_json::json!({
                "driver": driver, "host": "127.0.0.1", "port": port,
                "username": "u", "password": PASSWORD, "database": "d"
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, OPEN_FAILED, "{driver}");
            assert!(!err.message.contains(PASSWORD), "{}", err.message);
            // `disable` (mặc định) chỉ nối thường, đúng một lần.
            assert_eq!(drain(&mut rx), ["plain"], "{driver}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn open_to_a_silent_server_times_out() {
        // Đồng hồ ảo: tự nhảy tới 10 giây khi mọi task đang chờ, nên không chờ thật.
        let p = params(serde_json::json!({
            "driver": "mysql", "host": "127.0.0.1", "port": silent_server(),
            "username": "u", "password": PASSWORD
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED);
        assert_eq!(err.message, "connection timed out");
    }

    // ---- connect: thứ tự thử theo từng mode (server giả luôn từ chối) ----

    #[tokio::test]
    async fn disable_tries_only_plain() {
        let (order, err) = attempts(TlsMode::Disable, None).await;
        assert_eq!(order, ["plain"]);
        assert_eq!(err.code, OPEN_FAILED);
    }

    #[tokio::test]
    async fn allow_tries_plain_then_tls() {
        let ssl = ssl_opts(&tls(TlsMode::Allow, None)).unwrap();
        let (order, err) = attempts(TlsMode::Allow, ssl).await;
        assert_eq!(order, ["plain", "ssl"]);
        assert_eq!(err.code, OPEN_FAILED);
    }

    #[tokio::test]
    async fn prefer_tries_tls_then_plain() {
        let ssl = ssl_opts(&tls(TlsMode::Prefer, None)).unwrap();
        let (order, err) = attempts(TlsMode::Prefer, ssl).await;
        assert_eq!(order, ["ssl", "plain"]);
        assert_eq!(err.code, OPEN_FAILED);
    }

    #[tokio::test]
    async fn require_and_verify_modes_try_only_tls() {
        let ca = fx("ca.pem");
        for mode in [TlsMode::Require, TlsMode::VerifyCa, TlsMode::VerifyFull] {
            let ssl = ssl_opts(&tls(mode, Some(&ca))).unwrap();
            let (order, err) = attempts(mode, ssl).await;
            assert_eq!(order, ["ssl"], "{mode:?}");
            assert_eq!(err.code, OPEN_FAILED, "{mode:?}");
        }
    }

    #[tokio::test]
    async fn without_ssl_opts_only_plain_is_tried_whatever_the_mode() {
        let (order, _) = attempts(TlsMode::Prefer, None).await;
        assert_eq!(order, ["plain"]);
    }

    #[tokio::test]
    async fn connect_errors_never_contain_the_password() {
        for mode in [
            TlsMode::Disable,
            TlsMode::Allow,
            TlsMode::Prefer,
            TlsMode::Require,
        ] {
            let ssl = ssl_opts(&tls(mode, None)).unwrap();
            let (_, err) = attempts(mode, ssl).await;
            assert!(!err.message.contains(PASSWORD), "{mode:?}: {}", err.message);
        }
    }

    // ---- connect: server giả chấp nhận ----

    #[tokio::test]
    async fn connect_runs_init_on_the_main_connection_only() {
        let (port, mut rx) = fake_server(true);
        let (conn, kill_opts) = connect(&base(port), TlsMode::Disable, None).await.unwrap();
        assert_eq!(conn.id(), THREAD_ID);
        assert_eq!(drain(&mut rx), ["plain", &format!("q:{INIT}")]);
        // Connection phụ gửi KILL không chạy lệnh INIT.
        assert!(kill_opts.init().is_empty());
        assert!(kill_opts.ssl_opts().is_none());
        conn.disconnect().await.unwrap();
    }

    #[tokio::test]
    async fn allow_stops_at_the_first_success_and_keeps_plain_for_kill() {
        let ssl = ssl_opts(&tls(TlsMode::Allow, None)).unwrap();
        let (port, mut rx) = fake_server(true);
        let (conn, kill_opts) = connect(&base(port), TlsMode::Allow, ssl).await.unwrap();
        assert_eq!(drain(&mut rx), ["plain", &format!("q:{INIT}")]);
        assert!(kill_opts.ssl_opts().is_none());
        conn.disconnect().await.unwrap();
    }

    #[tokio::test]
    async fn prefer_falls_back_to_plain_and_kill_uses_the_kind_that_worked() {
        tls::install_provider();
        let ssl = ssl_opts(&tls(TlsMode::Prefer, None)).unwrap();
        let (port, mut rx) = fake_server(true);
        // Server giả không bắt tay TLS được nên lần TLS rớt, lần thường thành công.
        let (conn, kill_opts) = connect(&base(port), TlsMode::Prefer, ssl).await.unwrap();
        assert_eq!(drain(&mut rx), ["ssl", "plain", &format!("q:{INIT}")]);
        assert!(kill_opts.ssl_opts().is_none());
        conn.disconnect().await.unwrap();
    }

    // ---- kill_query ----

    #[tokio::test]
    async fn kill_query_without_seq_always_sends_kill() {
        let (port, mut rx) = fake_server(true);
        let s = shared(port);
        kill_query(&s, None).await;
        assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);
    }

    #[tokio::test]
    async fn kill_query_sends_kill_only_while_that_seq_is_still_running() {
        let (port, mut rx) = fake_server(true);
        let s = shared(port);
        let cancel = CancelSignal::new();

        // Đang chạy đúng lần 1: gửi.
        let op = s.begin(&cancel).unwrap();
        kill_query(&s, Some(1)).await;
        assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);

        // Lần 1 đã xong (không còn busy): chỉ nối rồi đóng, không KILL.
        drop(op);
        kill_query(&s, Some(1)).await;
        assert_eq!(drain(&mut rx), ["plain"]);

        // Đang chạy lần 2 mà người gọi nhắm lần 1: không được huỷ nhầm câu sau.
        let _op = s.begin(&cancel).unwrap();
        kill_query(&s, Some(1)).await;
        assert_eq!(drain(&mut rx), ["plain"]);
        kill_query(&s, Some(2)).await;
        assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);
    }

    #[tokio::test]
    async fn kill_query_to_an_unreachable_server_returns_quietly() {
        // Từ chối kết nối trên Windows mất ~2 giây, nên chỉ thử một lần.
        let s = shared(closed_port());
        kill_query(&s, None).await;
    }

    #[tokio::test(start_paused = true)]
    async fn kill_query_gives_up_after_the_timeout_on_a_silent_server() {
        let s = shared(silent_server());
        kill_query(&s, None).await;
    }

    // ---- Interrupt ----

    #[tokio::test]
    async fn interrupt_when_idle_spawns_nothing() {
        let (port, mut rx) = fake_server(true);
        let s = shared(port);
        let int = MySqlInterrupt(s.clone());
        let metrics = Handle::current().metrics();
        let before = metrics.num_alive_tasks();
        int.interrupt();
        assert_eq!(metrics.num_alive_tasks(), before);
        assert!(drain(&mut rx).is_empty());
    }

    #[tokio::test]
    async fn interrupt_while_busy_sends_kill_query_for_the_connection() {
        let (port, mut rx) = fake_server(true);
        let s = shared(port);
        let int = MySqlInterrupt(s.clone());
        let _op = s.begin(&CancelSignal::new()).unwrap();
        let metrics = Handle::current().metrics();
        let before = metrics.num_alive_tasks();
        // `interrupt` trả về ngay (chỉ spawn), việc gửi KILL chạy ở task riêng.
        int.interrupt();
        assert_eq!(metrics.num_alive_tasks(), before + 1);
        assert_eq!(next(&mut rx).await, "plain");
        assert_eq!(next(&mut rx).await, "q:KILL QUERY 777");
    }

    // ---- Shared / Op ----

    #[tokio::test]
    async fn begin_marks_busy_until_the_op_is_dropped() {
        let s = shared(closed_port());
        let cancel = CancelSignal::new();
        assert!(!s.busy.load(Ordering::SeqCst));
        let op = s.begin(&cancel).unwrap();
        assert!(s.busy.load(Ordering::SeqCst));
        assert!(s.is_running(1));
        assert!(!s.is_running(2));
        drop(op);
        assert!(!s.busy.load(Ordering::SeqCst));
        assert!(!s.is_running(1));
        // Lần sau tăng seq.
        let _op = s.begin(&cancel).unwrap();
        assert!(s.is_running(2));
        assert!(!s.is_running(1));
    }

    #[tokio::test]
    async fn begin_on_a_cancelled_request_fails_and_clears_busy() {
        let s = shared(closed_port());
        let cancel = CancelSignal::new();
        cancel.cancel();
        let Err(err) = s.begin(&cancel) else {
            panic!("request đã huỷ thì begin phải lỗi");
        };
        assert_eq!(err.code, CANCELLED);
        assert_eq!(err.message, cancelled().message);
        // Op đã bị thả trong `begin` nên không để `busy` kẹt (sẽ khiến `interrupt` KILL nhầm).
        assert!(!s.busy.load(Ordering::SeqCst));
        assert!(!s.is_running(1));
    }

    #[tokio::test]
    async fn broken_flag_is_sticky() {
        let s = shared(closed_port());
        assert!(!s.is_broken());
        s.mark_broken();
        assert!(s.is_broken());
        s.mark_broken();
        assert!(s.is_broken());
    }

    // ---- error_text ----

    #[test]
    fn error_text_of_a_server_error_looks_like_the_mysql_client() {
        let e = mysql_async::Error::Server(mysql_async::ServerError {
            code: 1045,
            state: "28000".into(),
            message: "Access denied for user 'u'@'h' (using password: YES)".into(),
        });
        assert_eq!(
            error_text(&e),
            "ERROR 1045 (28000): Access denied for user 'u'@'h' (using password: YES)"
        );
    }

    #[test]
    fn error_text_of_an_io_error_has_one_io_prefix() {
        let e = mysql_async::Error::Io(mysql_async::IoError::Io(std::io::Error::other("boom")));
        let text = error_text(&e);
        assert_eq!(text, "Input/output error: boom");
        assert_eq!(text.matches("Input/output error").count(), 1);
    }

    #[test]
    fn error_text_of_other_errors_is_their_display() {
        let e = mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed);
        assert_eq!(error_text(&e), e.to_string());
        assert!(!error_text(&e).is_empty());
    }

    #[tokio::test]
    async fn error_text_of_a_refused_connection_names_the_cause_without_the_password() {
        let e = Conn::new(Opts::from(base(closed_port())))
            .await
            .err()
            .unwrap();
        let text = error_text(&e);
        assert!(text.starts_with("Input/output error"), "{text}");
        assert_eq!(text.matches("Input/output error").count(), 1, "{text}");
        assert!(!text.contains(PASSWORD));
    }

    #[test]
    fn constants_match_the_mysql_defaults() {
        assert_eq!(DEFAULT_PORT, 3306);
        assert_eq!(DRIVER, "mysql");
        assert_eq!(MARIADB, "mariadb");
    }
}
