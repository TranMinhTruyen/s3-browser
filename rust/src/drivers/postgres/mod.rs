//! Driver PostgreSQL: mỗi connection là một actor tokio sở hữu `tokio_postgres::Client`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd`
//! qua kênh tới `actor::run` của connection, actor chạy SQL rồi trả kết quả ngược qua kênh
//! (xem `drivers` về mô hình actor). Dòng kết quả đọc nhị phân qua `value`/`array`, chỉ các
//! kiểu ngoài danh sách cho phép mới đọc bằng simple query (text).
//!
//! `open` nối TCP (và TLS theo `tls.mode`), spawn "connection task" của `tokio-postgres` (task
//! đó mới là thứ đọc/ghi socket; `Client` chỉ gửi yêu cầu cho nó qua kênh) rồi đăng ký
//! connection vào registry cùng một `PgInterrupt` để `s3b_cancel` huỷ được câu đang chạy.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Arc<T>`: con trỏ đếm tham chiếu, nhiều chỗ cùng giữ một giá trị bất biến (như con trỏ
//!   dùng chung của Go nhưng có đếm tham chiếu thay vì GC). Ở đây dùng cho cấu hình TLS.
//! - `tokio::spawn`: chạy một future như một task độc lập (giống `go func()`); `JoinHandle`
//!   là cách chờ hoặc dừng task đó.
//! - `tokio::time::timeout`: bọc một future, quá hạn thì bỏ nó và trả `Err(Elapsed)`.

/// Vòng lặp actor, chạy câu SQL, cursor.
mod actor;
/// Đổi mảng nhị phân sang chuỗi `{...}`.
mod array;
/// Đổi giá trị ô nhị phân sang chuỗi, danh sách kiểu đọc nhị phân.
mod value;

use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, OPEN_FAILED, OpenParams, OpenResult, TlsMode,
};
use crate::registry::{self, Interrupt};
use rustls::ClientConfig;
use std::error::Error as _;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_postgres::config::SslMode;
use tokio_postgres::{CancelToken, Client, Config, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;

/// Tên driver trong `open.driver`.
pub const DRIVER: &str = "postgres";

/// Tổng thời gian cho cả quá trình nối (gồm lần thử lại khi `allow`/`prefer`).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Chờ tối đa bao lâu để gửi xong yêu cầu huỷ (một connection mới tới server).
const CANCEL_TIMEOUT: Duration = Duration::from_secs(5);
/// Cổng mặc định của PostgreSQL.
const DEFAULT_PORT: u16 = 5432;

/// Mở connection: nối, spawn connection task, đăng ký registry rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    let Some(host) = p.host.as_deref().filter(|h| !h.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing host"));
    };
    let Some(user) = p.username.as_deref().filter(|u| !u.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing username"));
    };
    let tls = crate::drivers::tls::client_config(&p.tls)?;

    let mut config = Config::new();
    config
        .host(host)
        .port(p.port.unwrap_or(DEFAULT_PORT))
        .user(user)
        .application_name("S3Browser")
        .connect_timeout(CONNECT_TIMEOUT);
    if let Some(password) = &p.password {
        config.password(password);
    }
    // Vắng hoặc rỗng thì PostgreSQL dùng tên đăng nhập làm tên database.
    if let Some(db) = p.database.as_deref().filter(|d| !d.is_empty()) {
        config.dbname(db);
    }

    let (client, conn_task, used_tls) =
        tokio::time::timeout(CONNECT_TIMEOUT, connect(&config, p.tls.mode, tls.as_ref()))
            .await
            .map_err(|_| DbError::new(OPEN_FAILED, "connection timed out"))??;

    let interrupt = PgInterrupt {
        token: client.cancel_token(),
        tls: used_tls.clone(),
        // `interrupt` được gọi từ thread của Go (không thuộc runtime), nên giữ `Handle` để spawn.
        handle: Handle::current(),
    };
    let session = actor::Session::new(client, interrupt.token.clone(), used_tls);
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, DRIVER, tx, Arc::new(interrupt));
    tokio::spawn(actor::run(id, session, conn_task, rx));
    Ok(OpenResult { conn_id: id })
}

/// Thử nối theo thứ tự của libpq: `disable` chỉ thường, `allow` thường rồi TLS, `prefer` TLS
/// rồi thường, các mode còn lại chỉ TLS. Trả lỗi của lần thử cuối.
/// Kết quả: client, task của connection, và cấu hình TLS nếu lần nối thành công dùng TLS.
async fn connect(
    config: &Config,
    mode: TlsMode,
    tls: Option<&Arc<ClientConfig>>,
) -> DbResult<(Client, JoinHandle<()>, Option<Arc<ClientConfig>>)> {
    let order: &[bool] = match (mode, tls) {
        (TlsMode::Allow, Some(_)) => &[false, true],
        (TlsMode::Prefer, Some(_)) => &[true, false],
        (_, Some(_)) => &[true],
        (_, None) => &[false],
    };
    let mut last = DbError::new(OPEN_FAILED, "connection failed");
    for &use_tls in order {
        let attempt = match (use_tls, tls) {
            (true, Some(cfg)) => connect_tls(config, cfg).await,
            _ => connect_plain(config).await,
        };
        match attempt {
            Ok((client, task)) => return Ok((client, task, tls.filter(|_| use_tls).cloned())),
            Err(e) => last = DbError::new(OPEN_FAILED, error_text(&e)),
        }
    }
    Err(last)
}

/// Nối không mã hoá. Task của connection chạy tới khi socket đóng; lỗi của nó sẽ hiện ra ở lần
/// gọi kế tiếp trên `Client`, nên bỏ qua kết quả ở đây.
async fn connect_plain(config: &Config) -> Result<(Client, JoinHandle<()>), tokio_postgres::Error> {
    let mut config = config.clone();
    config.ssl_mode(SslMode::Disable);
    let (client, connection) = config.connect(NoTls).await?;
    Ok((
        client,
        tokio::spawn(async move {
            let _ = connection.await;
        }),
    ))
}

/// Nối qua TLS (rustls). `MakeRustlsConnect` nhận `ClientConfig` theo giá trị nên copy từ `Arc`
/// (copy rẻ: bên trong toàn là `Arc`).
async fn connect_tls(
    config: &Config,
    tls: &Arc<ClientConfig>,
) -> Result<(Client, JoinHandle<()>), tokio_postgres::Error> {
    let mut config = config.clone();
    config.ssl_mode(SslMode::Require);
    let (client, connection) = config
        .connect(MakeRustlsConnect::new(ClientConfig::clone(tls)))
        .await?;
    Ok((
        client,
        tokio::spawn(async move {
            let _ = connection.await;
        }),
    ))
}

/// Gửi yêu cầu huỷ câu đang chạy tới server (qua một connection riêng, theo giao thức của
/// PostgreSQL), dùng cùng kiểu TLS với connection gốc. Lỗi bị bỏ qua vì huỷ là best effort.
pub(super) async fn send_cancel(token: &CancelToken, tls: Option<&Arc<ClientConfig>>) {
    let request = async {
        match tls {
            Some(cfg) => {
                token
                    .cancel_query(MakeRustlsConnect::new(ClientConfig::clone(cfg)))
                    .await
            }
            None => token.cancel_query(NoTls).await,
        }
    };
    let _ = tokio::time::timeout(CANCEL_TIMEOUT, request).await;
}

/// Lỗi của `tokio-postgres` thành chuỗi: lỗi từ server thì lấy nguyên thông báo của server,
/// lỗi khác thì nối cả chuỗi nguyên nhân (`source`), vì `Display` của nó chỉ nói chung chung
/// ("error connecting to server"). Không chứa mật khẩu.
pub(super) fn error_text(e: &tokio_postgres::Error) -> String {
    if let Some(db) = e.as_db_error() {
        return db.message().to_owned();
    }
    let mut text = e.to_string();
    let mut source = e.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

/// Huỷ câu đang chạy khi `s3b_cancel` (hoặc `close`) gọi, từ thread bất kỳ của Go.
struct PgInterrupt {
    token: CancelToken,
    tls: Option<Arc<ClientConfig>>,
    handle: Handle,
}

/// `interrupt` không được chặn thread gọi nên chỉ spawn một task gửi yêu cầu rồi trả về ngay.
impl Interrupt for PgInterrupt {
    fn interrupt(&self) {
        let (token, tls) = (self.token.clone(), self.tls.clone());
        self.handle
            .spawn(async move { send_cancel(&token, tls.as_ref()).await });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TlsParams;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// Server giả: ghi lại mỗi lần nối là `ssl` (client gửi SSLRequest) hay `plain` (gửi thẳng
    /// StartupMessage). SSLRequest được trả `N` (không hỗ trợ TLS), còn lại đóng socket ngay.
    /// Thread chặn ở `accept` tới hết process; cổng tự chọn nên các test không đụng nhau.
    fn fake_server() -> (u16, Arc<Mutex<Vec<&'static str>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let log = Arc::new(Mutex::new(Vec::new()));
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut head = [0u8; 8];
                if stream.read_exact(&mut head).is_err() {
                    continue;
                }
                // Mã SSLRequest 80877103 = 0x04d2162f nằm ở byte 4..8.
                if head[4..8] == [0x04, 0xd2, 0x16, 0x2f] {
                    seen.lock().unwrap().push("ssl");
                    let _ = std::io::Write::write_all(&mut stream, b"N");
                } else {
                    seen.lock().unwrap().push("plain");
                }
            }
        });
        (port, log)
    }

    /// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
    fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn config(port: u16) -> Config {
        let mut c = Config::new();
        c.host("127.0.0.1")
            .port(port)
            .user("u")
            .password("super-secret-pw")
            .connect_timeout(Duration::from_secs(5));
        c
    }

    fn tls_for(mode: TlsMode) -> Option<Arc<ClientConfig>> {
        crate::drivers::tls::client_config(&TlsParams {
            mode,
            ca_file: None,
        })
        .ok()
        .flatten()
    }

    /// Thứ tự các lần nối server giả thấy khi `connect` ở `mode`, kèm lỗi cuối.
    async fn attempts(mode: TlsMode) -> (Vec<&'static str>, DbError) {
        let (port, log) = fake_server();
        let tls = tls_for(mode);
        let Err(err) = connect(&config(port), mode, tls.as_ref()).await else {
            panic!("server giả không bao giờ nối được");
        };
        let order = log.lock().unwrap().clone();
        (order, err)
    }

    fn params(json: serde_json::Value) -> OpenParams {
        serde_json::from_value(json).unwrap()
    }

    // ---- open: kiểm input ----

    #[tokio::test]
    async fn open_requires_a_host() {
        for host in [serde_json::Value::Null, serde_json::json!("")] {
            let p = params(serde_json::json!({
                "driver": "postgres", "host": host, "username": "u"
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, INVALID_REQUEST);
            assert_eq!(err.message, "missing host");
        }
        let p = params(serde_json::json!({"driver": "postgres", "username": "u"}));
        assert_eq!(open(p).await.err().unwrap().code, INVALID_REQUEST);
    }

    #[tokio::test]
    async fn open_requires_a_username() {
        for user in [serde_json::Value::Null, serde_json::json!("")] {
            let p = params(serde_json::json!({
                "driver": "postgres", "host": "127.0.0.1", "username": user
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
                "driver": "postgres", "host": "127.0.0.1", "port": port, "username": "u",
                "password": "super-secret-pw",
                "tls": {"mode": mode, "caFile": "Z:/khong/ton/tai/ca.pem"}
            }));
            let err = open(p).await.err().unwrap();
            assert_eq!(err.code, OPEN_FAILED, "{mode}");
            assert!(!err.message.contains("super-secret-pw"));
        }
    }

    #[tokio::test]
    async fn open_to_a_refused_port_is_open_failed_without_the_password() {
        let p = params(serde_json::json!({
            "driver": "postgres", "host": "127.0.0.1", "port": closed_port(),
            "username": "u", "password": "super-secret-pw"
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED);
        assert!(!err.message.is_empty());
        assert!(!err.message.contains("super-secret-pw"), "{}", err.message);
    }

    #[tokio::test]
    async fn open_to_a_server_that_hangs_up_is_open_failed() {
        let (port, log) = fake_server();
        let p = params(serde_json::json!({
            "driver": "postgres", "host": "127.0.0.1", "port": port,
            "username": "u", "password": "super-secret-pw", "database": "d"
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED);
        assert!(!err.message.contains("super-secret-pw"));
        // `disable` (mặc định) chỉ nối thường, đúng một lần.
        assert_eq!(*log.lock().unwrap(), ["plain"]);
    }

    // ---- connect: thứ tự thử theo từng mode ----

    #[tokio::test]
    async fn disable_tries_only_plain() {
        let (order, err) = attempts(TlsMode::Disable).await;
        assert_eq!(order, ["plain"]);
        assert_eq!(err.code, OPEN_FAILED);
    }

    #[tokio::test]
    async fn allow_tries_plain_then_tls() {
        let (order, err) = attempts(TlsMode::Allow).await;
        assert_eq!(order, ["plain", "ssl"]);
        // Trả lỗi của lần thử CUỐI (TLS), không phải lần thường.
        assert_eq!(err.code, OPEN_FAILED);
        assert!(err.message.contains("TLS"), "{}", err.message);
    }

    #[tokio::test]
    async fn prefer_tries_tls_then_plain() {
        let (order, err) = attempts(TlsMode::Prefer).await;
        assert_eq!(order, ["ssl", "plain"]);
        // Lần cuối là nối thường nên lỗi không nhắc tới TLS.
        assert_eq!(err.code, OPEN_FAILED);
        assert!(!err.message.contains("TLS"), "{}", err.message);
    }

    #[tokio::test]
    async fn require_and_verify_modes_try_only_tls() {
        for mode in [TlsMode::Require, TlsMode::VerifyCa, TlsMode::VerifyFull] {
            // `connect` chỉ xem có cấu hình TLS hay không; dùng config không kiểm cert cho cả ba
            // để khỏi cần CA thật (việc kiểm chứng chỉ do `drivers::tls` lo và test riêng).
            let (port, log) = fake_server();
            let tls = tls_for(TlsMode::Require);
            let err = connect(&config(port), mode, tls.as_ref())
                .await
                .err()
                .unwrap();
            assert_eq!(*log.lock().unwrap(), ["ssl"], "{mode:?}");
            assert!(err.message.contains("TLS"), "{mode:?}: {}", err.message);
        }
    }

    #[tokio::test]
    async fn without_a_tls_config_only_plain_is_tried_whatever_the_mode() {
        let (port, log) = fake_server();
        let err = connect(&config(port), TlsMode::Prefer, None)
            .await
            .err()
            .unwrap();
        assert_eq!(err.code, OPEN_FAILED);
        assert_eq!(*log.lock().unwrap(), ["plain"]);
    }

    #[tokio::test]
    async fn connect_errors_never_contain_the_password() {
        for mode in [
            TlsMode::Disable,
            TlsMode::Allow,
            TlsMode::Prefer,
            TlsMode::Require,
        ] {
            let (_, err) = attempts(mode).await;
            assert!(!err.message.contains("super-secret-pw"), "{mode:?}");
        }
    }

    // ---- error_text ----

    #[tokio::test]
    async fn error_text_chains_the_causes_of_a_connection_error() {
        let port = closed_port();
        let e = connect_plain(&config(port)).await.err().unwrap();
        let text = error_text(&e);
        // `Display` của tokio-postgres chỉ có phần chung; nguyên nhân thật phải được nối vào.
        assert!(text.starts_with(&e.to_string()), "{text}");
        assert!(text.contains(": "), "{text}");
        assert!(text.len() > e.to_string().len(), "{text}");
        assert!(!text.contains("super-secret-pw"));
    }

    #[test]
    fn default_port_is_the_postgres_port() {
        assert_eq!(DEFAULT_PORT, 5432);
        assert_eq!(DRIVER, "postgres");
    }
}
