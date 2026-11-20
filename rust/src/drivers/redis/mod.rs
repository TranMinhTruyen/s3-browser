//! Driver Redis: mỗi connection là một actor tokio sở hữu một `MultiplexedConnection` của crate
//! `redis`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd` qua
//! kênh tới `actor::run` của connection, actor chạy lệnh rồi trả kết quả ngược qua kênh (xem
//! `drivers` về mô hình actor). Văn bản lệnh do `command` tách token, reply do `value` đổi
//! thành bảng.
//!
//! `open`:
//! - Tự mở TCP (và TLS bằng `tokio-rustls`) rồi giao stream cho crate `redis`
//!   (`MultiplexedConnection::new_with_config`). Ta không dùng TLS có sẵn của crate vì nó dựng
//!   `ClientConfig` riêng, không cho chọn đủ 6 mode và verifier của `tls.rs`; nhờ vậy cả 5 driver
//!   mạng dùng chung một cách kiểm chứng chỉ. Mật khẩu chỉ nằm trong `RedisConnectionInfo`
//!   (không qua chuỗi URL nên không lọt vào thông báo lỗi).
//! - Thương lượng giao thức: thử RESP3 (`HELLO 3`) để nhận map/set/double/bool thật; server cũ
//!   hơn 6.0 không có `HELLO` thì lùi về RESP2 (`HGETALL` khi đó là mảng phẳng, không phải map).
//! - Gửi `PING` để lỗi xác thực hoặc chọn DB hiện ngay lúc mở. `database` là số DB (`SELECT n`).
//!
//! TLS (xem `attempts`, theo thứ tự của libpq như các driver khác):
//! - `disable`: không TLS. `allow`: thường rồi TLS. `prefer`: TLS rồi thường. `require`: chỉ TLS.
//!   Ba mode `allow`/`prefer`/`require` mã hoá nhưng không kiểm chứng chỉ.
//! - `verify-ca`: TLS kiểm chuỗi CA, bỏ qua hostname. `verify-full`: kiểm cả hostname. Tin cậy:
//!   các CA trong `caFile` nếu có, không thì kho chứng chỉ của Windows (`tls::client_config`).
//!
//! Huỷ: Redis không có "huỷ lệnh đang chạy" (lệnh chạy xong hoặc nối lại), nên khi request bị
//! huỷ actor thả cả connection (đóng TCP) và nối lại ở lệnh kế tiếp; xem `actor`.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `tokio::spawn` chạy một future thành task nền và trả `JoinHandle`; `abort()` dừng task đó.
//!   `Drop` (như `defer` của Go) cho `Live` đảm bảo task nền dừng và TCP đóng khi connection bị thả.
//! - Generic với ràng buộc `C: AsyncRead + AsyncWrite`: một hàm nhận cả TCP thường lẫn TCP
//!   đã bọc TLS, compiler sinh sẵn bản riêng cho từng kiểu.
//! - `tokio::time::timeout`: bọc một future, quá hạn thì bỏ nó và trả `Err(Elapsed)`.

/// Vòng lặp actor, chạy lệnh, cursor.
mod actor;
/// Tách văn bản thành các lệnh Redis.
pub mod command;
/// Đổi reply của Redis thành bảng.
pub mod value;

use crate::drivers::tls;
use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, OPEN_FAILED, OpenParams, OpenResult, TlsMode,
};
use crate::registry::{self, Interrupt};
use redis::aio::MultiplexedConnection;
use redis::{AsyncConnectionConfig, ErrorKind, ProtocolVersion, RedisConnectionInfo, RedisError};
use rustls::pki_types::ServerName;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_rustls::TlsConnector;

/// Tên driver Redis trong `open.driver`.
pub const DRIVER: &str = "redis";

/// Tổng thời gian cho cả quá trình nối (TCP, TLS, xác thực, `PING`). Mode `allow`/`prefer` thử
/// hai lần, mỗi lần được một nửa. Cũng là thời gian tối đa của một lần nối lại sau khi huỷ.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Cổng mặc định của Redis.
const DEFAULT_PORT: u16 = 6379;

/// Mở connection: nối, đăng ký registry rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    let Some(host) = p.host.as_deref().filter(|h| !h.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing host"));
    };
    let db = database_number(p.database.as_deref())?;
    let plan = attempts(&p)?;

    let mut target = Target {
        host: host.to_owned(),
        port: p.port.unwrap_or(DEFAULT_PORT),
        username: p.username.filter(|u| !u.is_empty()),
        password: p.password.filter(|w| !w.is_empty()),
        db,
        tls: None,
        protocol: ProtocolVersion::RESP3,
    };
    let live = connect_any(&mut target, plan).await?;

    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, DRIVER, tx, Arc::new(NoInterrupt));
    tokio::spawn(actor::run(id, actor::Session::new(live, target), rx));
    Ok(OpenResult { conn_id: id })
}

/// Số DB từ `database` của `open`: trống = 0, còn lại phải là số nguyên không âm.
fn database_number(database: Option<&str>) -> DbResult<i64> {
    match database.map(str::trim).filter(|d| !d.is_empty()) {
        None => Ok(0),
        Some(text) => {
            text.parse::<i64>().ok().filter(|n| *n >= 0).ok_or_else(|| {
                DbError::new(INVALID_REQUEST, "database must be a non-negative number")
            })
        }
    }
}

/// Các cấu hình TLS để thử lần lượt, theo thứ tự của libpq (giống driver PostgreSQL, MySQL, SQL
/// Server và MongoDB): `None` = không TLS. Ánh xạ mode: xem đầu file.
fn attempts(p: &OpenParams) -> DbResult<Vec<Option<TlsConnector>>> {
    // `None` khi `disable`; các mode khác luôn `Some`.
    let secure = tls::client_config(&p.tls)?.map(TlsConnector::from);
    Ok(match p.tls.mode {
        TlsMode::Disable => vec![None],
        TlsMode::Allow => vec![None, secure],
        TlsMode::Prefer => vec![secure, None],
        TlsMode::Require | TlsMode::VerifyCa | TlsMode::VerifyFull => vec![secure],
    })
}

/// Thời gian cho mỗi lần thử khi có `tries` lần: chia đều `CONNECT_TIMEOUT`.
fn budget(tries: usize) -> Duration {
    CONNECT_TIMEOUT / u32::try_from(tries.max(1)).unwrap_or(1)
}

/// Thử nối theo từng cấu hình TLS cho tới khi có cái thành công; mỗi lần tối đa `budget`. Cấu
/// hình thành công được ghi vào `target` (để nối lại đúng cách đó). Server đã trả lời mà từ
/// chối (sai mật khẩu, DB không tồn tại) thì dừng ngay, không thử mode khác. Lỗi: của lần thử cuối.
async fn connect_any(target: &mut Target, plan: Vec<Option<TlsConnector>>) -> DbResult<Live> {
    let budget = budget(plan.len());
    let mut last = DbError::new(OPEN_FAILED, "connection failed");
    for tls in plan {
        target.tls = tls;
        match tokio::time::timeout(budget, target.connect_negotiated()).await {
            Ok(Ok(live)) => return Ok(live),
            Ok(Err(f)) => {
                last = DbError::new(OPEN_FAILED, f.message);
                if f.answered {
                    break;
                }
            }
            Err(_) => last = DbError::new(OPEN_FAILED, "connection timed out"),
        }
    }
    Err(last)
}

/// Cách nối tới server, giữ lại để nối lại sau khi huỷ. Mật khẩu chỉ nằm trong RAM của actor và
/// không bao giờ được in ra (struct này cố ý không có `Debug`).
pub struct Target {
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    /// DB hiện tại; actor cập nhật khi người dùng `SELECT` thành công để nối lại không về DB 0.
    db: i64,
    /// `None` = không TLS.
    tls: Option<TlsConnector>,
    /// Giao thức đã thương lượng được lúc mở.
    protocol: ProtocolVersion,
}

/// Lý do một lần nối thất bại.
struct Failure {
    /// Không chứa mật khẩu (chỉ lời server hoặc lỗi mạng/TLS).
    message: String,
    /// Server đã trả lời và từ chối (xác thực, DB, quyền): thử mode TLS khác vô ích.
    answered: bool,
    /// Server không có `HELLO` (Redis < 6): lùi về RESP2.
    resp3_unsupported: bool,
}

impl Failure {
    /// Lỗi mạng hoặc TLS (chưa tới bước Redis trả lời).
    fn transport(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            answered: false,
            resp3_unsupported: false,
        }
    }
}

impl From<RedisError> for Failure {
    fn from(e: RedisError) -> Self {
        Self {
            // Server trả lời bằng `-CODE chi tiết` (kể cả mã crate không phân loại như `WRONGPASS`,
            // `NOAUTH`, `NOPERM`: kind là `Extension` nhưng `code()` có giá trị) hoặc báo xác thực hỏng.
            answered: e.kind() == ErrorKind::AuthenticationFailed || e.code().is_some(),
            resp3_unsupported: e.kind() == ErrorKind::RESP3NotSupported,
            message: error_text(&e),
        }
    }
}

/// Lỗi của crate `redis` thành chuỗi. Lỗi của server có dạng `WRONGPASS invalid username-password
/// pair or user is disabled.`; lỗi khác dùng mô tả của crate. Không chứa mật khẩu: crate chỉ
/// nhận nó trong `RedisConnectionInfo` và thông báo chỉ nêu lời server hoặc lỗi mạng.
pub fn error_text(e: &RedisError) -> String {
    match (e.code(), e.detail()) {
        (Some(code), Some(detail)) => format!("{code} {detail}"),
        (Some(code), None) => code.to_owned(),
        _ => e.to_string(),
    }
}

impl Target {
    /// `RedisConnectionInfo` cho một lần nối (đăng nhập + chọn DB nằm trong bước khởi tạo của crate).
    fn info(&self) -> RedisConnectionInfo {
        let mut info = RedisConnectionInfo::default()
            .set_protocol(self.protocol)
            .set_db(self.db)
            // Không gửi `CLIENT SETINFO` (đỡ một lệnh, không lộ tên thư viện).
            .set_skip_set_lib_name();
        if let Some(user) = &self.username {
            info = info.set_username(user);
        }
        if let Some(password) = &self.password {
            info = info.set_password(password);
        }
        info
    }

    /// Nối với RESP3; server không hỗ trợ thì nối lại với RESP2 và ghi nhớ.
    async fn connect_negotiated(&mut self) -> Result<Live, Failure> {
        self.protocol = ProtocolVersion::RESP3;
        match self.connect().await {
            Err(f) if f.resp3_unsupported => {
                self.protocol = ProtocolVersion::RESP2;
                self.connect().await
            }
            other => other,
        }
    }

    /// Một lần nối đầy đủ theo cấu hình hiện tại: TCP, TLS (nếu có), khởi tạo của crate rồi `PING`.
    /// Không có timeout ở đây; bên gọi bọc `tokio::time::timeout`.
    async fn connect(&self) -> Result<Live, Failure> {
        let tcp = TcpStream::connect((self.host.as_str(), self.port))
            .await
            .map_err(|e| Failure::transport(format!("cannot connect: {}", e.kind())))?;
        // Lệnh Redis nhỏ, gửi ngay thay vì chờ gộp gói.
        let _ = tcp.set_nodelay(true);
        let info = self.info();
        let mut live = match &self.tls {
            None => handshake(&info, tcp).await?,
            Some(connector) => {
                let name = ServerName::try_from(self.host.clone())
                    .map_err(|_| Failure::transport("invalid server name"))?;
                let stream = connector
                    .connect(name, tcp)
                    .await
                    .map_err(|e| Failure::transport(format!("TLS handshake failed: {e}")))?;
                handshake(&info, stream).await?
            }
        };
        // `PING` bắt các lỗi mà bước khởi tạo chưa thấy (ví dụ server đang nạp dữ liệu).
        match live.conn.send_packed_command(&redis::cmd("PING")).await? {
            redis::Value::ServerError(e) => Err(Failure {
                message: value::server_error_text(&e),
                answered: true,
                resp3_unsupported: false,
            }),
            _ => Ok(live),
        }
    }
}

/// Giao stream (TCP thường hoặc đã bọc TLS) cho crate `redis` và chạy phần nền của nó thành một
/// task. Không đặt timeout trả lời của crate (mặc định 500 ms) vì `BLPOP`, `DEBUG SLEEP`... có
/// thể chạy lâu; ta tự huỷ bằng cách thả connection.
async fn handshake<C>(info: &RedisConnectionInfo, stream: C) -> Result<Live, Failure>
where
    C: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let config = AsyncConnectionConfig::new().set_response_timeout(None);
    let (conn, driver) = MultiplexedConnection::new_with_config(info, stream, config).await?;
    Ok(Live {
        conn,
        task: tokio::spawn(driver),
    })
}

/// Connection đang sống: handle gửi lệnh và task nền của crate (đọc/ghi socket). Thả `Live` là
/// dừng task nền, nên TCP đóng ngay và server bỏ lệnh đang chờ (ví dụ `BLPOP`).
pub struct Live {
    conn: MultiplexedConnection,
    task: JoinHandle<()>,
}

impl Drop for Live {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Huỷ do actor tự làm (`select!` rồi thả connection), nên registry không cần ngắt gì thêm.
struct NoInterrupt;

impl Interrupt for NoInterrupt {
    fn interrupt(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::Cmd;
    use crate::protocol::CANCELLED;
    use redis::ServerErrorKind;
    use serde_json::json;
    use std::net::TcpListener as StdListener;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;
    use tokio::sync::{oneshot, watch};

    const PASSWORD: &str = "super-secret-pw";

    // ---- server Redis giả (dùng chung với `actor::tests`) ----

    /// Cách server giả trả lời một lệnh.
    pub(super) enum Answer {
        /// Ghi nguyên các byte RESP này.
        Bytes(Vec<u8>),
        /// Không trả lời nhưng vẫn đọc tiếp tới khi client đóng (giống `BLPOP` đang chờ).
        Hang,
        /// Đóng connection ngay (giống mất mạng).
        Close,
    }

    impl Answer {
        pub(super) fn raw(text: &str) -> Self {
            Self::Bytes(text.as_bytes().to_vec())
        }
    }

    type Handler = dyn Fn(&[String]) -> Option<Answer> + Send + Sync;

    /// Nhật ký lệnh server giả đã nhận: (số kết nối, các đối số).
    pub(super) type Log = Arc<Mutex<Vec<(usize, Vec<String>)>>>;

    /// Các cổng test đang cần là "đóng"; `Fake::start` không dùng lại chúng.
    static CLOSED_PORTS: Mutex<Vec<u16>> = Mutex::new(Vec::new());

    /// Server RESP tối giản trên loopback: ghi lại mọi lệnh nhận được, trả lời theo `handler`
    /// (trả `None` thì dùng câu trả lời mặc định: `HELLO` = map RESP3, `SELECT`/`AUTH`/... = `OK`,
    /// `PING` = `PONG`). Không cần Docker nên chạy được ở mọi máy.
    pub(super) struct Fake {
        pub(super) port: u16,
        /// `(số thứ tự connection từ 0, lệnh)` theo thứ tự nhận.
        pub(super) log: Log,
        /// Số connection đã nhận.
        pub(super) accepted: Arc<AtomicUsize>,
        closed: watch::Sender<usize>,
        logged: watch::Sender<usize>,
        accept: JoinHandle<()>,
    }

    impl Drop for Fake {
        fn drop(&mut self) {
            self.accept.abort();
        }
    }

    async fn read_command<R: AsyncBufRead + Unpin>(r: &mut R) -> Option<Vec<String>> {
        let mut line = String::new();
        if r.read_line(&mut line).await.ok()? == 0 {
            return None;
        }
        let n: usize = line.trim_end().strip_prefix('*')?.parse().ok()?;
        let mut args = Vec::with_capacity(n);
        for _ in 0..n {
            line.clear();
            r.read_line(&mut line).await.ok()?;
            let len: usize = line.trim_end().strip_prefix('$')?.parse().ok()?;
            let mut buf = vec![0u8; len + 2];
            r.read_exact(&mut buf).await.ok()?;
            buf.truncate(len);
            args.push(String::from_utf8_lossy(&buf).into_owned());
        }
        Some(args)
    }

    fn default_answer(cmd: &[String]) -> Answer {
        match cmd.first().map(|c| c.to_ascii_uppercase()).as_deref() {
            Some("HELLO") => Answer::raw("%1\r\n+proto\r\n:3\r\n"),
            Some("PING") => Answer::raw("+PONG\r\n"),
            _ => Answer::raw("+OK\r\n"),
        }
    }

    impl Fake {
        pub(super) async fn start(
            handler: impl Fn(&[String]) -> Option<Answer> + Send + Sync + 'static,
        ) -> Self {
            // Tránh cổng mà test khác đang coi là "đóng" (hệ điều hành có thể cấp lại cổng vừa nhả).
            let listener = loop {
                let l = TcpListener::bind("127.0.0.1:0").await.expect("bind");
                let port = l.local_addr().expect("addr").port();
                if !CLOSED_PORTS.lock().unwrap().contains(&port) {
                    break l;
                }
            };
            let port = listener.local_addr().expect("addr").port();
            let log = Arc::new(Mutex::new(Vec::new()));
            let accepted = Arc::new(AtomicUsize::new(0));
            let (closed, _) = watch::channel(0);
            let (logged, _) = watch::channel(0);
            let handler: Arc<Handler> = Arc::new(handler);
            let accept = {
                let (log, accepted) = (log.clone(), accepted.clone());
                let (closed, logged) = (closed.clone(), logged.clone());
                tokio::spawn(async move {
                    while let Ok((stream, _)) = listener.accept().await {
                        let index = accepted.fetch_add(1, Ordering::SeqCst);
                        tokio::spawn(serve(
                            index,
                            stream,
                            handler.clone(),
                            log.clone(),
                            logged.clone(),
                            closed.clone(),
                        ));
                    }
                })
            };
            Self {
                port,
                log,
                accepted,
                closed,
                logged,
                accept,
            }
        }

        /// Server trả lời mặc định mọi lệnh.
        pub(super) async fn plain() -> Self {
            Self::start(|_| None).await
        }

        /// Ngừng nhận connection mới (cổng bị đóng); connection đang có vẫn sống.
        pub(super) async fn stop_listening(&mut self) {
            CLOSED_PORTS.lock().unwrap().push(self.port);
            self.accept.abort();
            let _ = (&mut self.accept).await;
        }

        pub(super) fn accepted(&self) -> usize {
            self.accepted.load(Ordering::SeqCst)
        }

        /// Các lệnh (viết hoa tên) nhận trên connection `index`.
        pub(super) fn commands_of(&self, index: usize) -> Vec<Vec<String>> {
            let log = self.log.lock().unwrap();
            log.iter()
                .filter(|(i, _)| *i == index)
                .map(|(_, c)| c.clone())
                .collect()
        }

        /// Tên (viết hoa) mọi lệnh đã nhận, mọi connection, theo thứ tự.
        pub(super) fn names(&self) -> Vec<String> {
            let log = self.log.lock().unwrap();
            log.iter().map(|(_, c)| c[0].to_ascii_uppercase()).collect()
        }

        pub(super) fn count(&self, name: &str) -> usize {
            self.names().iter().filter(|n| *n == name).count()
        }

        /// Chờ tới khi server đã nhận lệnh `name` lần thứ `nth` (từ 1).
        pub(super) async fn wait_for(&self, name: &str, nth: usize) {
            let mut rx = self.logged.subscribe();
            let wait = rx.wait_for(|_| self.count(name) >= nth);
            tokio::time::timeout(Duration::from_secs(20), wait)
                .await
                .expect("server không nhận được lệnh")
                .expect("kênh log còn sống");
        }

        /// Chờ tới khi `n` connection đã bị client đóng.
        pub(super) async fn wait_closed(&self, n: usize) {
            let mut rx = self.closed.subscribe();
            tokio::time::timeout(Duration::from_secs(20), rx.wait_for(|c| *c >= n))
                .await
                .expect("client chưa đóng connection")
                .expect("kênh closed còn sống");
        }

        pub(super) fn closed_count(&self) -> usize {
            *self.closed.borrow()
        }
    }

    async fn serve(
        index: usize,
        stream: tokio::net::TcpStream,
        handler: Arc<Handler>,
        log: Log,
        logged: watch::Sender<usize>,
        closed: watch::Sender<usize>,
    ) {
        let (read, mut write) = stream.into_split();
        let mut read = BufReader::new(read);
        while let Some(cmd) = read_command(&mut read).await {
            let total = {
                let mut log = log.lock().unwrap();
                log.push((index, cmd.clone()));
                log.len()
            };
            logged.send_replace(total);
            match handler(&cmd).unwrap_or_else(|| default_answer(&cmd)) {
                Answer::Bytes(bytes) => {
                    if write.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Answer::Hang => {
                    while read_command(&mut read).await.is_some() {}
                    break;
                }
                Answer::Close => break,
            }
        }
        closed.send_modify(|n| *n += 1);
    }

    /// `Target` trỏ tới server giả, không TLS, RESP3.
    pub(super) fn target_for(port: u16, db: i64) -> Target {
        Target {
            host: "127.0.0.1".to_owned(),
            port,
            username: None,
            password: None,
            db,
            tls: None,
            protocol: ProtocolVersion::RESP3,
        }
    }

    /// Phiên đã nối tới server giả (đường `connect` thật, gồm `HELLO` và `PING`).
    pub(super) async fn session_for(fake: &Fake, db: i64) -> actor::Session {
        let target = target_for(fake.port, db);
        let Ok(live) = target.connect().await else {
            panic!("nối tới server giả phải thành công");
        };
        actor::Session::new(live, target)
    }

    // ---- hàm phụ ----

    fn params(v: serde_json::Value) -> OpenParams {
        serde_json::from_value(v).expect("params hợp lệ")
    }

    fn base(port: u16, mode: &str) -> OpenParams {
        params(json!({
            "driver": "redis", "host": "127.0.0.1", "port": port,
            "username": "me", "password": PASSWORD, "tls": {"mode": mode}
        }))
    }

    fn fx(name: &str) -> String {
        format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    /// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
    pub(super) fn closed_port() -> u16 {
        let port = StdListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        CLOSED_PORTS.lock().unwrap().push(port);
        port
    }

    /// Dạng gọn của kế hoạch TLS: `false` = không TLS, `true` = TLS.
    fn plan(p: &OpenParams) -> Vec<bool> {
        attempts(p)
            .unwrap_or_else(|e| panic!("attempts lỗi: {}", e.message))
            .iter()
            .map(Option::is_some)
            .collect()
    }

    fn server_error(line: &str) -> RedisError {
        let Ok(redis::Value::Array(mut items)) =
            redis::parse_redis_value(format!("*1\r\n-{line}\r\n").as_bytes())
        else {
            panic!("RESP không hợp lệ");
        };
        let Some(redis::Value::ServerError(e)) = items.pop() else {
            panic!("không phải lỗi server");
        };
        RedisError::from(e)
    }

    // ---- hằng ----

    #[test]
    fn driver_name_and_defaults() {
        assert_eq!(DRIVER, "redis");
        assert_eq!(DEFAULT_PORT, 6379);
        assert_eq!(CONNECT_TIMEOUT, Duration::from_secs(10));
    }

    // ---- budget ----

    #[test]
    fn budget_splits_the_connect_timeout_evenly() {
        assert_eq!(budget(1), CONNECT_TIMEOUT);
        assert_eq!(budget(2), CONNECT_TIMEOUT / 2);
        assert_eq!(budget(4), CONNECT_TIMEOUT / 4);
    }

    #[test]
    fn budget_of_zero_or_absurd_tries_does_not_panic() {
        assert_eq!(budget(0), CONNECT_TIMEOUT);
        assert_eq!(budget(usize::MAX), CONNECT_TIMEOUT);
    }

    // ---- database_number ----

    #[test]
    fn database_number_defaults_to_zero_when_blank() {
        for blank in [None, Some(""), Some(" "), Some("\t \n")] {
            assert_eq!(database_number(blank).unwrap(), 0, "{blank:?}");
        }
    }

    #[test]
    fn database_number_accepts_non_negative_integers_and_trims() {
        assert_eq!(database_number(Some("0")).unwrap(), 0);
        assert_eq!(database_number(Some("5")).unwrap(), 5);
        assert_eq!(database_number(Some(" 15 ")).unwrap(), 15);
        assert_eq!(database_number(Some("007")).unwrap(), 7);
        assert_eq!(database_number(Some("+3")).unwrap(), 3);
        // Số lớn tới đâu cũng chỉ là số; server mới quyết định có DB đó không.
        assert_eq!(
            database_number(Some("9223372036854775807")).unwrap(),
            i64::MAX
        );
    }

    #[test]
    fn database_number_rejects_everything_else() {
        for bad in [
            "-1",
            "-0x",
            "abc",
            "1.5",
            "1e3",
            "1 2",
            "0x10",
            "9223372036854775808",
            "99999999999999999999",
            "٣",
            "db0",
        ] {
            let e = database_number(Some(bad)).expect_err(bad);
            assert_eq!(e.code, INVALID_REQUEST, "{bad}");
            assert_eq!(e.message, "database must be a non-negative number", "{bad}");
        }
    }

    // ---- attempts ----

    #[test]
    fn tls_plan_per_mode_follows_libpq_order() {
        let cases: [(&str, Vec<bool>); 6] = [
            ("disable", vec![false]),
            ("allow", vec![false, true]),
            ("prefer", vec![true, false]),
            ("require", vec![true]),
            ("verify-ca", vec![true]),
            ("verify-full", vec![true]),
        ];
        for (mode, expected) in cases {
            let mut p = base(1, mode);
            p.tls.ca_file = Some(fx("ca.pem"));
            assert_eq!(plan(&p), expected, "mode {mode}");
        }
    }

    #[test]
    fn default_mode_is_disable() {
        let p = params(json!({"driver": "redis", "host": "h"}));
        assert_eq!(plan(&p), vec![false]);
    }

    #[test]
    fn verify_modes_without_a_ca_file_use_the_system_roots() {
        for ca in [None, Some(String::new())] {
            for mode in ["verify-ca", "verify-full"] {
                let mut p = base(1, mode);
                p.tls.ca_file = ca.clone();
                assert_eq!(plan(&p), vec![true], "{mode} {ca:?}");
            }
        }
    }

    #[test]
    fn verify_modes_with_an_unreadable_ca_file_fail_without_leaking_the_path() {
        for mode in ["verify-ca", "verify-full"] {
            let mut p = base(1, mode);
            p.tls.ca_file = Some("Z:/khong/ton/tai/ca-secret-name.pem".to_owned());
            let Err(e) = attempts(&p) else {
                panic!("{mode}: caFile không đọc được phải lỗi");
            };
            assert_eq!(e.code, OPEN_FAILED, "{mode}");
            assert!(e.message.contains("caFile"), "{mode}: {}", e.message);
            assert!(
                !e.message.contains("ca-secret-name"),
                "{mode}: {}",
                e.message
            );
            assert!(!e.message.contains(PASSWORD), "{mode}");
        }
    }

    #[test]
    fn verify_modes_reject_a_ca_file_with_no_certificate() {
        let mut p = base(1, "verify-full");
        p.tls.ca_file = Some(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")));
        let Err(e) = attempts(&p) else {
            panic!("file không có chứng chỉ phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.contains("caFile"), "{}", e.message);
    }

    #[test]
    fn non_verify_modes_ignore_an_unreadable_ca_file() {
        for mode in ["disable", "allow", "prefer", "require"] {
            let mut p = base(1, mode);
            p.tls.ca_file = Some("Z:/khong/ton/tai/ca.pem".to_owned());
            assert!(attempts(&p).is_ok(), "{mode}");
        }
    }

    // ---- Target::info ----

    #[test]
    fn info_carries_account_database_and_protocol() {
        let mut t = target_for(1, 7);
        t.username = Some("me".to_owned());
        t.password = Some(PASSWORD.to_owned());
        let info = t.info();
        assert_eq!(info.username(), Some("me"));
        assert_eq!(info.password(), Some(PASSWORD));
        assert_eq!(info.db(), 7);
        assert_eq!(info.protocol(), ProtocolVersion::RESP3);
        assert!(info.skip_set_lib_name(), "không gửi CLIENT SETINFO");
        t.protocol = ProtocolVersion::RESP2;
        assert_eq!(t.info().protocol(), ProtocolVersion::RESP2);
    }

    #[test]
    fn info_without_an_account_has_no_credentials() {
        let info = target_for(1, 0).info();
        assert_eq!(info.username(), None);
        assert_eq!(info.password(), None);
        assert_eq!(info.db(), 0);
    }

    #[test]
    fn info_accepts_a_password_without_a_username() {
        let mut t = target_for(1, 0);
        t.password = Some(PASSWORD.to_owned());
        let info = t.info();
        assert_eq!(info.username(), None);
        assert_eq!(info.password(), Some(PASSWORD));
    }

    // ---- Failure / error_text ----

    #[test]
    fn server_errors_read_code_and_detail() {
        let e = server_error("WRONGPASS invalid username-password pair or user is disabled.");
        assert_eq!(
            error_text(&e),
            "WRONGPASS invalid username-password pair or user is disabled."
        );
        assert_eq!(error_text(&server_error("NOAUTH")), "NOAUTH");
    }

    #[test]
    fn other_errors_use_the_crate_description() {
        let io = RedisError::from(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "boom",
        ));
        assert_eq!(error_text(&io), io.to_string());
        let auth = RedisError::from((
            ErrorKind::AuthenticationFailed,
            "Password authentication failed",
        ));
        assert!(error_text(&auth).contains("Password authentication failed"));
    }

    #[test]
    fn failure_from_error_classifies_answered_and_resp3() {
        let f = Failure::from(server_error("ERR bad"));
        assert!(f.answered && !f.resp3_unsupported);
        let f = Failure::from(RedisError::from((ErrorKind::AuthenticationFailed, "x")));
        assert!(f.answered && !f.resp3_unsupported);
        let f = Failure::from(RedisError::from((
            ErrorKind::Server(ServerErrorKind::ResponseError),
            "x",
        )));
        assert!(f.answered);
        let f = Failure::from(RedisError::from((ErrorKind::RESP3NotSupported, "x")));
        assert!(f.resp3_unsupported && !f.answered);
        let f = Failure::from(RedisError::from(std::io::Error::other("net")));
        assert!(!f.answered && !f.resp3_unsupported);
    }

    #[test]
    fn failure_from_a_refused_login_counts_as_answered() {
        for line in [
            "WRONGPASS invalid username-password pair or user is disabled.",
            "NOAUTH Authentication required.",
            "NOPERM this user has no permissions to run the 'x' command",
        ] {
            let f = Failure::from(server_error(line));
            assert!(f.answered, "{line}");
        }
    }

    #[test]
    fn transport_failures_are_not_answered() {
        let f = Failure::transport("cannot connect: x");
        assert_eq!(f.message, "cannot connect: x");
        assert!(!f.answered && !f.resp3_unsupported);
    }

    // ---- open: kiểm đầu vào (không cần server) ----

    #[tokio::test]
    async fn open_requires_a_host() {
        for host in [json!(null), json!("")] {
            let p = params(json!({"driver": "redis", "host": host}));
            let Err(e) = open(p).await else {
                panic!("thiếu host phải lỗi");
            };
            assert_eq!(e.code, INVALID_REQUEST, "{host}");
            assert_eq!(e.message, "missing host");
        }
        let p = params(json!({"driver": "redis"}));
        assert_eq!(open(p).await.err().expect("lỗi").message, "missing host");
    }

    #[tokio::test]
    async fn open_rejects_a_bad_database_before_connecting() {
        // Cổng đóng nhưng lỗi vẫn là về `database` và trả ngay.
        for bad in ["-1", "x", "1.5", "99999999999999999999", "1 1"] {
            let mut p = base(closed_port(), "disable");
            p.database = Some(bad.to_owned());
            let started = std::time::Instant::now();
            let Err(e) = open(p).await else {
                panic!("{bad}: phải lỗi");
            };
            assert_eq!(e.code, INVALID_REQUEST, "{bad}");
            assert_eq!(e.message, "database must be a non-negative number", "{bad}");
            assert!(started.elapsed() < Duration::from_secs(2), "{bad}");
        }
    }

    #[tokio::test]
    async fn open_checks_the_host_before_the_database() {
        let p = params(json!({"driver": "redis", "database": "-1"}));
        assert_eq!(open(p).await.err().expect("lỗi").message, "missing host");
    }

    #[tokio::test]
    async fn open_with_an_unreadable_ca_file_fails_before_connecting() {
        let mut p = base(closed_port(), "verify-full");
        p.tls.ca_file = Some("Z:/khong/ton/tai/ca.pem".to_owned());
        let started = std::time::Instant::now();
        let Err(e) = open(p).await else {
            panic!("phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.contains("caFile"), "{}", e.message);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn open_to_a_closed_port_fails_without_the_password() {
        let started = std::time::Instant::now();
        let Err(e) = open(base(closed_port(), "disable")).await else {
            panic!("cổng đóng phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.starts_with("cannot connect"), "{}", e.message);
        assert!(!e.message.contains(PASSWORD), "{}", e.message);
        assert!(started.elapsed() < Duration::from_secs(8));
    }

    // ---- open: với server giả ----

    #[tokio::test]
    async fn open_sends_hello_with_the_account_selects_the_database_and_pings() {
        let fake = Fake::plain().await;
        let mut p = base(fake.port, "disable");
        p.database = Some(" 3 ".to_owned());
        let id = open(p).await.expect("mở được").conn_id;
        let first = fake.commands_of(0);
        let names: Vec<_> = first.iter().map(|c| c[0].to_ascii_uppercase()).collect();
        assert_eq!(names, ["HELLO", "SELECT", "PING"]);
        assert_eq!(first[0], ["HELLO", "3", "AUTH", "me", PASSWORD]);
        assert_eq!(first[1], ["SELECT", "3"]);
        assert_eq!(fake.accepted(), 1);
        close(id).await;
    }

    #[tokio::test]
    async fn open_treats_empty_account_fields_as_missing() {
        let fake = Fake::plain().await;
        let p = params(json!({
            "driver": "redis", "host": "127.0.0.1", "port": fake.port,
            "username": "", "password": ""
        }));
        let id = open(p).await.expect("mở được").conn_id;
        let first = fake.commands_of(0);
        assert_eq!(first[0], ["HELLO", "3"], "không có AUTH");
        assert!(
            first.iter().all(|c| !c[0].eq_ignore_ascii_case("SELECT")),
            "DB 0 không cần SELECT"
        );
        close(id).await;
    }

    #[tokio::test]
    async fn open_registers_the_connection_and_close_removes_it() {
        let fake = Fake::plain().await;
        let id = open(base(fake.port, "disable"))
            .await
            .expect("mở được")
            .conn_id;
        let reg = registry::global();
        assert_eq!(reg.conn_driver(id), Some(DRIVER));
        assert!(reg.conn_tx(id).is_some());
        close(id).await;
        assert!(reg.conn_tx(id).is_none());
        fake.wait_closed(1).await;
    }

    #[tokio::test]
    async fn two_opens_get_different_connection_ids_and_separate_sockets() {
        let fake = Fake::plain().await;
        let a = open(base(fake.port, "disable")).await.expect("a").conn_id;
        let b = open(base(fake.port, "disable")).await.expect("b").conn_id;
        assert_ne!(a, b);
        assert_eq!(fake.accepted(), 2);
        close(a).await;
        close(b).await;
    }

    async fn close(id: u64) {
        let tx = registry::global().conn_tx(id).expect("connection còn");
        let (done, wait) = oneshot::channel();
        tx.send(Cmd::Close(done)).await.expect("gửi Close");
        wait.await.expect("actor báo xong");
    }

    // ---- connect_any ----

    #[tokio::test]
    async fn connect_any_without_a_plan_reports_a_generic_failure() {
        let mut t = target_for(1, 0);
        let Err(e) = connect_any(&mut t, Vec::new()).await else {
            panic!("không có lần thử nào phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert_eq!(e.message, "connection failed");
    }

    #[tokio::test]
    async fn connect_any_to_a_closed_port_reports_the_last_error() {
        let mut t = target_for(closed_port(), 0);
        t.password = Some(PASSWORD.to_owned());
        let Err(e) = connect_any(&mut t, vec![None, None]).await else {
            panic!("cổng đóng phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.starts_with("cannot connect: "), "{}", e.message);
        assert!(!e.message.contains(PASSWORD));
    }

    #[tokio::test]
    async fn connect_any_stops_at_the_first_answer_that_refuses() {
        let fake = Fake::start(|cmd| {
            cmd[0].eq_ignore_ascii_case("HELLO").then(|| {
                Answer::raw("-WRONGPASS invalid username-password pair or user is disabled.\r\n")
            })
        })
        .await;
        let mut t = target_for(fake.port, 0);
        t.password = Some(PASSWORD.to_owned());
        let Err(e) = connect_any(&mut t, vec![None, None]).await else {
            panic!("sai mật khẩu phải lỗi");
        };

        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.starts_with("WRONGPASS"), "{}", e.message);
        assert!(!e.message.contains(PASSWORD), "{}", e.message);
        assert_eq!(fake.accepted(), 1, "đã trả lời thì không thử mode khác");
    }

    #[tokio::test]
    async fn a_wrong_database_is_reported_by_the_server_text() {
        let fake = Fake::start(|cmd| {
            cmd[0]
                .eq_ignore_ascii_case("SELECT")
                .then(|| Answer::raw("-ERR DB index is out of range\r\n"))
        })
        .await;
        let mut t = target_for(fake.port, 99);
        let Err(e) = connect_any(&mut t, vec![None, None]).await else {
            panic!("DB sai phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(
            e.message.contains("DB index is out of range"),
            "{}",
            e.message
        );
        assert_eq!(fake.accepted(), 1);
    }

    #[tokio::test]
    async fn connect_any_falls_back_to_resp2_when_hello_is_unknown() {
        let fake = Fake::start(|cmd| {
            cmd[0].eq_ignore_ascii_case("HELLO").then(|| {
                Answer::raw("-ERR unknown command `HELLO`, with args beginning with: `3`, \r\n")
            })
        })
        .await;
        let mut t = target_for(fake.port, 0);
        t.password = Some(PASSWORD.to_owned());
        let Ok(live) = connect_any(&mut t, vec![None]).await else {
            panic!("RESP2 phải nối được");
        };
        assert_eq!(t.protocol, ProtocolVersion::RESP2);
        assert_eq!(fake.accepted(), 2, "lần đầu RESP3, lần hai RESP2");
        let second = fake.commands_of(1);
        assert_eq!(second[0], ["AUTH", PASSWORD], "RESP2 đăng nhập bằng AUTH");
        assert!(second.iter().all(|c| !c[0].eq_ignore_ascii_case("HELLO")));
        drop(live);
    }

    #[tokio::test]
    async fn a_server_that_answers_ping_with_an_error_fails_the_open() {
        let fake = Fake::start(|cmd| {
            cmd[0]
                .eq_ignore_ascii_case("PING")
                .then(|| Answer::raw("-LOADING Redis is loading the dataset in memory\r\n"))
        })
        .await;
        let mut t = target_for(fake.port, 0);
        let Err(e) = connect_any(&mut t, vec![None, None]).await else {
            panic!("PING lỗi phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(e.message.starts_with("LOADING"), "{}", e.message);
        assert_eq!(fake.accepted(), 1);
    }

    #[tokio::test]
    async fn connect_any_remembers_the_plan_that_worked() {
        let fake = Fake::plain().await;
        let mut t = target_for(fake.port, 0);
        assert!(connect_any(&mut t, vec![None]).await.is_ok());
        assert!(t.tls.is_none());
        assert_eq!(t.protocol, ProtocolVersion::RESP3);
    }

    #[tokio::test]
    async fn tls_against_a_plain_server_fails_at_the_handshake() {
        let fake = Fake::plain().await;
        let secure = attempts(&base(fake.port, "require")).expect("plan");
        let mut t = target_for(fake.port, 0);
        let Err(e) = connect_any(&mut t, secure).await else {
            panic!("server thường không nói TLS");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(
            e.message.starts_with("TLS handshake failed"),
            "{}",
            e.message
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_server_that_never_answers_times_out() {
        let fake = Fake::start(|_| Some(Answer::Hang)).await;
        let mut t = target_for(fake.port, 0);
        let started = tokio::time::Instant::now();
        let Err(e) = connect_any(&mut t, vec![None]).await else {
            panic!("không trả lời phải hết giờ");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert_eq!(e.message, "connection timed out");
        assert_eq!(started.elapsed(), CONNECT_TIMEOUT);
    }

    #[tokio::test(start_paused = true)]
    async fn each_attempt_gets_an_equal_share_of_the_timeout() {
        let fake = Fake::start(|_| Some(Answer::Hang)).await;
        let mut t = target_for(fake.port, 0);
        let started = tokio::time::Instant::now();
        let Err(e) = connect_any(&mut t, vec![None, None]).await else {
            panic!("không trả lời phải hết giờ");
        };
        assert_eq!(e.message, "connection timed out");
        // Hai lần thử, mỗi lần một nửa: tổng vẫn là `CONNECT_TIMEOUT`.
        assert_eq!(started.elapsed(), CONNECT_TIMEOUT);
    }

    // ---- Live / NoInterrupt ----

    #[tokio::test]
    async fn dropping_live_closes_the_socket() {
        let fake = Fake::plain().await;
        let t = target_for(fake.port, 0);
        let Ok(live) = t.connect().await else {
            panic!("nối được");
        };
        assert_eq!(fake.closed_count(), 0);
        drop(live);
        fake.wait_closed(1).await;
    }

    #[test]
    fn no_interrupt_is_a_no_op() {
        NoInterrupt.interrupt();
    }

    #[test]
    fn cancelled_code_is_the_stable_one() {
        // Go map mã này sang "huỷ im lặng"; đổi chuỗi là hỏng hợp đồng.
        assert_eq!(CANCELLED, "cancelled");
    }
}
