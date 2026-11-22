//! Driver SQL Server: mỗi connection là một actor tokio sở hữu một `tiberius::Client`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd` qua
//! kênh tới `actor::run` của connection, actor chạy SQL rồi trả kết quả ngược qua kênh (xem
//! `drivers` về mô hình actor). Dòng kết quả do `tiberius` giải mã TDS rồi đổi trong `value`.
//!
//! `open` nối TCP (bật `TCP_NODELAY`), đăng nhập bằng tài khoản SQL (`sa`...), thương lượng
//! packet TDS lớn nhất (32767 byte) để trang lớn cần ít vòng đọc hơn, và mã hoá theo `tls.mode`.
//!
//! Huỷ: `tiberius` không có "cancel request" an toàn khi đang đọc dở, nên huỷ = bỏ connection
//! (đóng TCP, server tự dừng câu và rollback) rồi mở lại connection mới từ cùng `Config` (Q23=A).
//! Hệ quả: mọi trạng thái phiên mất (bảng `#temp`, `USE <db>`, `SET`, transaction đang mở).
//! Vì actor tự chọn giữa "chờ dòng" và "tín hiệu huỷ" (`select!`) nên `Interrupt` của registry
//! không phải làm gì.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Arc<T>`: con trỏ đếm tham chiếu, nhiều chỗ cùng giữ một giá trị (cờ `stale` do actor và
//!   cursor cùng dùng).
//! - `AtomicBool`: biến bool mà nhiều chỗ đọc/ghi được không cần khoá (giống `sync/atomic` Go).
//! - `tokio::time::timeout`: bọc một future, quá hạn thì bỏ nó và trả `Err(Elapsed)`.
//! - `Compat`: `tiberius` dùng trait I/O của crate `futures`, tokio dùng trait riêng; `compat_write`
//!   bọc `TcpStream` để hai bên nói chuyện được với nhau.

/// Vòng lặp actor, chạy câu SQL, cursor.
mod actor;
/// Đổi cột và ô sang tên kiểu/chuỗi hiển thị.
mod value;

use crate::drivers::tls;
use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, OPEN_FAILED, OpenParams, OpenResult, TlsMode,
};
use crate::registry::{self, Interrupt};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use tiberius::error::Error as TdsError;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

/// Tên driver SQL Server trong `open.driver`.
pub const DRIVER: &str = "sqlserver";

/// Tổng thời gian cho cả quá trình nối (gồm lần thử lại khi `allow`/`prefer`) và cho mỗi lần
/// nối lại sau khi huỷ.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Cổng mặc định của SQL Server.
const DEFAULT_PORT: u16 = 1433;
/// Kích thước packet TDS yêu cầu: lớn nhất mà giao thức cho (server có thể thương lượng nhỏ hơn).
const PACKET_SIZE: u32 = 32_767;

/// Connection của `tiberius` chạy trên TCP của tokio.
type Conn = Client<Compat<TcpStream>>;

/// Cờ "connection cũ không dùng tiếp được": một stream đã bị bỏ dở (huỷ, bỏ cursor) hoặc mạng
/// lỗi. Actor thấy cờ thì thả connection cũ và nối lại trước câu kế tiếp. Nằm sau `Arc` vì
/// cursor (giữ stream mượn connection) cũng cần bật cờ.
pub(super) type StaleFlag = Arc<AtomicBool>;

/// Mở connection: nối, đăng ký registry rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    let Some(host) = p.host.as_deref().filter(|h| !h.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing host"));
    };
    let Some(user) = p.username.as_deref().filter(|u| !u.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing username"));
    };
    // Gọi lại cho chắc (đã cài ở `s3b_init`): `tiberius` đọc provider mặc định của process, nếu
    // chưa có nó dùng `aws-lc-rs`; ta chỉ muốn `ring`. Gọi nhiều lần vô hại.
    tls::install_provider();

    let tries = attempts(&p, host, user)?;
    let (client, config) = tokio::time::timeout(CONNECT_TIMEOUT, connect_any(tries))
        .await
        .map_err(|_| DbError::new(OPEN_FAILED, "connection timed out"))??;

    let session = actor::Session::new(client, config);
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, DRIVER, tx, Arc::new(NoInterrupt));
    tokio::spawn(actor::run(id, session, rx));
    Ok(OpenResult { conn_id: id })
}

/// Các `Config` để thử lần lượt, theo thứ tự của libpq (giống driver PostgreSQL và MySQL):
/// `disable` chỉ thường, `allow` thường rồi TLS, `prefer` TLS rồi thường, các mode còn lại chỉ
/// TLS. Ánh xạ 6 mode sang `tiberius`:
/// - `disable`: `EncryptionLevel::Off` + `trust_cert()`: dữ liệu không mã hoá nhưng bước đăng
///   nhập (LOGIN7, có mật khẩu) vẫn đi qua TLS không kiểm chứng chỉ. Không dùng `NotSupported`
///   vì nó gửi mật khẩu gần như dạng rõ (chỉ xáo bit).
/// - `allow`/`prefer`/`require`: `Required` + `trust_cert()` (mã hoá, không kiểm chứng chỉ).
/// - `verify-ca`/`verify-full`: `Required` + kiểm chuỗi CA và hostname. `tiberius` không có
///   cách bỏ riêng kiểm hostname (chỉ `hostname_in_certificate` nhưng ta không biết tên trong
///   chứng chỉ trước khi nối) nên `verify-ca` thực tế nghiêm ngặt như `verify-full`.
///
/// Tin cậy của `verify-*`: kho chứng chỉ của Windows, cộng thêm các CA trong `caFile` nếu có
/// (`tiberius` luôn cộng dồn, không có chế độ "chỉ tin file này").
fn attempts(p: &OpenParams, host: &str, user: &str) -> DbResult<Vec<Config>> {
    let mut base = Config::new();
    base.host(host);
    base.port(p.port.unwrap_or(DEFAULT_PORT));
    if let Some(db) = p.database.as_deref().filter(|d| !d.is_empty()) {
        base.database(db);
    }
    base.authentication(AuthMethod::sql_server(
        user,
        p.password.as_deref().unwrap_or(""),
    ));
    base.packet_size(PACKET_SIZE);
    base.application_name("S3Browser");

    let plain = || {
        let mut c = base.clone();
        c.encryption(EncryptionLevel::Off);
        c.trust_cert();
        c
    };
    let encrypted_unverified = || {
        let mut c = base.clone();
        c.encryption(EncryptionLevel::Required);
        c.trust_cert();
        c
    };

    Ok(match p.tls.mode {
        TlsMode::Disable => vec![plain()],
        TlsMode::Allow => vec![plain(), encrypted_unverified()],
        TlsMode::Prefer => vec![encrypted_unverified(), plain()],
        TlsMode::Require => vec![encrypted_unverified()],
        TlsMode::VerifyCa | TlsMode::VerifyFull => {
            let mut c = base.clone();
            c.encryption(EncryptionLevel::Required);
            if let Some(path) = p.tls.ca_file.as_deref().filter(|f| !f.is_empty()) {
                // Đọc và kiểm file ở đây để lỗi `caFile` rõ ràng và có trước khi nối; mỗi chứng
                // chỉ thành một "bundle" DER (`tiberius` cộng dồn các lần gọi).
                for cert in tls::root_certs_der(Some(path))? {
                    c.trust_cert_ca_bundle(cert.as_ref().to_vec());
                }
            }
            vec![c]
        }
    })
}

/// Thử nối bằng từng `Config` cho tới khi có cái thành công. Trả connection và `Config` đã
/// thành công (để nối lại sau này đúng cách đó). Lỗi: của lần thử cuối.
async fn connect_any(tries: Vec<Config>) -> DbResult<(Conn, Config)> {
    let mut last = DbError::new(OPEN_FAILED, "connection failed");
    for config in tries {
        match connect(&config).await {
            Ok(client) => return Ok((client, config)),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Nối một connection mới bằng `config`: TCP (tắt Nagle) rồi đăng nhập TDS.
async fn connect(config: &Config) -> DbResult<Conn> {
    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|e| DbError::new(OPEN_FAILED, e.to_string()))?;
    // `TCP_NODELAY`: gửi ngay các gói nhỏ (request/ack) thay vì chờ gộp của thuật toán Nagle.
    tcp.set_nodelay(true)
        .map_err(|e| DbError::new(OPEN_FAILED, e.to_string()))?;
    Client::connect(config.clone(), tcp.compat_write())
        .await
        .map_err(|e| DbError::new(OPEN_FAILED, error_text(&e)))
}

/// Nối lại sau khi huỷ hoặc mất kết nối, có giới hạn thời gian như `open`.
pub(super) async fn reconnect(config: &Config) -> DbResult<Conn> {
    tokio::time::timeout(CONNECT_TIMEOUT, connect(config))
        .await
        .map_err(|_| DbError::new(OPEN_FAILED, "connection timed out"))?
}

/// Lỗi của `tiberius` thành chuỗi. Lỗi từ server có dạng như `sqlcmd`:
/// `Msg 208, Level 16, State 1, Line 1: Invalid object name 'x'.`. Không chứa mật khẩu (lỗi
/// đăng nhập của server chỉ nêu tên tài khoản).
pub(super) fn error_text(e: &TdsError) -> String {
    match e {
        TdsError::Server(s) => format!(
            "Msg {}, Level {}, State {}, Line {}: {}",
            s.code(),
            s.class(),
            s.state(),
            s.line(),
            s.message()
        ),
        other => other.to_string(),
    }
}

/// Huỷ do actor tự làm (`select!` trên tín hiệu huỷ), nên registry không cần ngắt gì thêm.
struct NoInterrupt;

impl Interrupt for NoInterrupt {
    fn interrupt(&self) {}
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/sqlserver/mod.rs"]
mod tests;
