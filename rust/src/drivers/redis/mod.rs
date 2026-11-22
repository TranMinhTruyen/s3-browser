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
#[path = "../../../tests/unit/drivers/redis/mod.rs"]
mod tests;
