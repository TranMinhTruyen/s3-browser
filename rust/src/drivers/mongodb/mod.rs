//! Driver MongoDB: mỗi connection là một actor tokio sở hữu một `mongodb::Client`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd` qua
//! kênh tới `actor::run` của connection, actor chạy lệnh rồi trả kết quả ngược qua kênh (xem
//! `drivers` về mô hình actor). Văn bản lệnh do `command` đọc, document kết quả do `ejson` ghi
//! thành JSON.
//!
//! `open` dựng `ClientOptions` bằng code (không qua chuỗi URI, nên mật khẩu không bao giờ nằm
//! trong một chuỗi có thể lọt vào thông báo lỗi), nối thẳng tới một server (`direct_connection`,
//! không dò các node khác của replica set), xác thực bằng tài khoản ở database `admin` rồi gửi
//! thử `ping` để chắc connection dùng được. `host`/`port` là một server duy nhất; chưa hỗ trợ
//! `mongodb+srv://`.
//!
//! TLS: `mongodb` (rustls + `ring`) chỉ nhận đường dẫn file CA chứ không nhận chứng chỉ thô hay
//! verifier riêng, nên 6 mode ánh xạ như sau (xem `attempts` và `new_client`):
//! - `disable`: không TLS.
//! - `allow`/`prefer`/`require`: TLS với `allow_invalid_certificates` (mã hoá, không kiểm chứng
//!   chỉ).
//! - `verify-ca`/`verify-full`: TLS kiểm chuỗi CA **và hostname**. Crate không có cách bỏ riêng
//!   kiểm hostname (chỉ có khi build với OpenSSL, mà ta không dùng), nên `verify-ca` thực tế
//!   nghiêm ngặt như `verify-full`. Tin cậy: chỉ các CA trong `caFile` nếu có; không có `caFile`
//!   thì dùng kho chứng chỉ của Windows như các driver khác (`tls::root_certs_der`, đã cache),
//!   **không** dùng bộ CA `webpki-roots` đóng gói sẵn của crate. Vì crate chỉ đọc CA từ file,
//!   `new_client` ghi các CA công khai đó ra một file PEM tạm (`RootsFile`, tên ngẫu nhiên, tạo
//!   độc quyền bằng `create_new`), đưa đường dẫn cho crate rồi xoá file ngay khi
//!   `Client::with_options` trả về (crate đọc file đồng bộ trong hàm này), kể cả khi lỗi hay
//!   panic. File chỉ chứa chứng chỉ gốc công khai, không có khoá hay secret.
//!
//! Huỷ: actor tự chọn giữa "chờ crate" và "tín hiệu huỷ" (`select!`), nên `Interrupt` của
//! registry không phải làm gì.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Vec<Option<T>>`/`Option::map`: `Option` là "có hoặc không có giá trị" (thay cho `nil`);
//!   `map` chỉ chạy hàm khi có giá trị.
//! - `tokio::time::timeout`: bọc một future, quá hạn thì bỏ nó và trả `Err(Elapsed)`.
//! - `Drop`: hàm `drop` chạy tự động khi giá trị ra khỏi phạm vi (kể cả khi lỗi hay panic), như
//!   `defer` của Go nhưng gắn vào kiểu dữ liệu; `RootsFile` dùng nó để luôn xoá file tạm.

/// Vòng lặp actor, chạy lệnh, cursor.
mod actor;
/// Đọc văn bản người dùng thành các lệnh Extended JSON.
pub mod command;
/// Ghi document BSON thô thành Extended JSON gọn.
pub mod ejson;

use crate::drivers::tls;
use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, OPEN_FAILED, OpenParams, OpenResult, TlsMode,
};
use crate::registry::{self, Interrupt};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use mongodb::Client;
use mongodb::bson::doc;
use mongodb::error::{Error as MongoError, ErrorKind};
use mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};
use std::collections::hash_map::RandomState;
use std::fs::OpenOptions;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

/// Tên driver MongoDB trong `open.driver`.
pub const DRIVER: &str = "mongodb";

/// Tổng thời gian cho cả quá trình nối. Mode `allow`/`prefer` thử hai lần, mỗi lần được một nửa.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Chờ `Client::shutdown` khi đóng connection tối đa bao lâu (nó chờ các `killCursors` ngầm).
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
/// Cổng mặc định của MongoDB.
const DEFAULT_PORT: u16 = 27017;
/// Database chứa tài khoản người dùng (`authSource`) và là database mặc định của lệnh khi
/// profile không chỉ định `database`.
const ADMIN_DB: &str = "admin";

/// Mở connection: nối, đăng ký registry rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    let Some(host) = p.host.as_deref().filter(|h| !h.is_empty()) else {
        return Err(DbError::new(INVALID_REQUEST, "missing host"));
    };
    // `mongodb` dựng cấu hình TLS với provider `ring` của chính nó; cài provider mặc định của
    // process để các crate khác cùng process (và lần gọi `s3b_init`) nhất quán. Gọi nhiều lần vô hại.
    tls::install_provider();

    let tries = attempts(&p, host)?;
    let client = connect_any(tries).await?;

    let session = actor::Session {
        client,
        db: p
            .database
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| ADMIN_DB.to_owned()),
    };
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, DRIVER, tx, Arc::new(NoInterrupt));
    tokio::spawn(actor::run(id, session, rx));
    Ok(OpenResult { conn_id: id })
}

/// Các `ClientOptions` để thử lần lượt, theo thứ tự của libpq (giống driver PostgreSQL, MySQL và
/// SQL Server): `disable` chỉ thường, `allow` thường rồi TLS, `prefer` TLS rồi thường, các mode
/// còn lại chỉ TLS. Ánh xạ TLS: xem đầu file.
fn attempts(p: &OpenParams, host: &str) -> DbResult<Vec<ClientOptions>> {
    let address = ServerAddress::Tcp {
        host: host.to_owned(),
        port: Some(p.port.unwrap_or(DEFAULT_PORT)),
    };
    // Không đặt `source` (mặc định `admin`) cũng được, nhưng ghi rõ cho người đọc.
    let credential = p.username.as_deref().filter(|u| !u.is_empty()).map(|user| {
        Credential::builder()
            .username(user.to_owned())
            .password(p.password.clone())
            .source(ADMIN_DB.to_owned())
            .build()
    });

    // `tls` của từng lần thử; `None` = không TLS.
    let unverified = || {
        let mut t = TlsOptions::default();
        t.allow_invalid_certificates = Some(true);
        Some(Tls::Enabled(t))
    };
    let tls_plan: Vec<Option<Tls>> = match p.tls.mode {
        TlsMode::Disable => vec![None],
        TlsMode::Allow => vec![None, unverified()],
        TlsMode::Prefer => vec![unverified(), None],
        TlsMode::Require => vec![unverified()],
        TlsMode::VerifyCa | TlsMode::VerifyFull => {
            let mut t = TlsOptions::default();
            if let Some(path) = p.tls.ca_file.as_deref().filter(|f| !f.is_empty()) {
                // Đọc và kiểm file ở đây để lỗi `caFile` rõ ràng, có trước khi nối và không lặp
                // lại đường dẫn (crate tự đọc lại file theo đường dẫn khi dựng TLS).
                tls::root_certs_der(Some(path))?;
                t.ca_file_path = Some(PathBuf::from(path));
            }
            // Không có `caFile`: để trống `ca_file_path`; `new_client` sẽ thay bằng file PEM tạm
            // chứa kho chứng chỉ Windows (xem `needs_system_roots`).
            vec![Some(Tls::Enabled(t))]
        }
    };

    let per_try = budget(tls_plan.len());
    Ok(tls_plan
        .into_iter()
        .map(|tls| {
            ClientOptions::builder()
                .hosts(vec![address.clone()])
                // Nối đúng server đã cho, không dò các node khác (profile là một địa chỉ).
                .direct_connection(true)
                .server_selection_timeout(per_try)
                .connect_timeout(per_try)
                .app_name("S3Browser".to_owned())
                .credential(credential.clone())
                .tls(tls)
                .build()
        })
        .collect())
}

/// Thời gian cho mỗi lần thử khi có `tries` lần: chia đều `CONNECT_TIMEOUT`.
fn budget(tries: usize) -> Duration {
    CONNECT_TIMEOUT / u32::try_from(tries.max(1)).unwrap_or(1)
}

/// Thử nối bằng từng `ClientOptions` cho tới khi có cái thành công; mỗi lần tối đa `budget`.
/// Server đã trả lời mà từ chối (sai mật khẩu, không đủ quyền) thì dừng ngay, không thử mode
/// khác. Lỗi: của lần thử cuối.
async fn connect_any(tries: Vec<ClientOptions>) -> DbResult<Client> {
    let budget = budget(tries.len());
    let mut last = DbError::new(OPEN_FAILED, "connection failed");
    for options in tries {
        // Dựng client là việc đồng bộ và nhanh (đọc CA, không chạm mạng) nên nằm ngoài `timeout`.
        let client = match new_client(options) {
            Ok(client) => client,
            Err(e) => {
                last = e;
                continue;
            }
        };
        match tokio::time::timeout(budget, ping(&client)).await {
            Ok(Ok(())) => return Ok(client),
            Ok(Err(e)) => {
                let answered = matches!(
                    e.kind.as_ref(),
                    ErrorKind::Authentication { .. } | ErrorKind::Command(_)
                );
                last = DbError::new(OPEN_FAILED, error_text(&e));
                if answered {
                    break;
                }
            }
            Err(_) => last = DbError::new(OPEN_FAILED, "connection timed out"),
        }
    }
    Err(last)
}

/// `options` có cần tin cậy kho chứng chỉ hệ thống không: TLS có kiểm chứng chỉ mà không chỉ
/// định file CA (để nguyên thì crate rơi về bộ `webpki-roots` đóng gói sẵn).
fn needs_system_roots(options: &ClientOptions) -> bool {
    matches!(
        &options.tls,
        Some(Tls::Enabled(t))
            if t.ca_file_path.is_none() && t.allow_invalid_certificates != Some(true)
    )
}

/// Tạo `Client` (chưa nối, crate nối lười). Cần kho chứng chỉ hệ thống thì ghi nó ra file PEM
/// tạm cho crate đọc; `Client::with_options` đọc file đồng bộ nên xoá được ngay sau đó.
fn new_client(mut options: ClientOptions) -> DbResult<Client> {
    let roots = if needs_system_roots(&options) {
        let file = RootsFile::create()?;
        if let Some(Tls::Enabled(t)) = &mut options.tls {
            t.ca_file_path = Some(file.0.clone());
        }
        Some(file)
    } else {
        None
    };
    let client = Client::with_options(options);
    // Crate đã đọc xong file: xoá ngay. Nếu `with_options` panic thì `roots` vẫn bị drop khi
    // unwind nên file cũng được xoá.
    drop(roots);
    client.map_err(|e| DbError::new(OPEN_FAILED, error_text(&e)))
}

/// `ping` để thật sự nối và xác thực.
async fn ping(client: &Client) -> Result<(), MongoError> {
    client
        .database(ADMIN_DB)
        .run_command(doc! { "ping": 1 })
        .await?;
    Ok(())
}

/// File PEM tạm chứa các root CA của Windows, để đưa cho `TlsOptions::ca_file_path` (crate không
/// nhận chứng chỉ trong bộ nhớ). Chỉ có chứng chỉ gốc công khai, không có khoá hay secret. Tên
/// ngẫu nhiên và tạo bằng `create_new` (lỗi nếu đã tồn tại, không ghi đè hay đi theo symlink).
/// Xoá file khi `drop`.
struct RootsFile(PathBuf);

impl RootsFile {
    /// Ghi kho chứng chỉ Windows (`tls::root_certs_der(None)`, đã cache) ra file tạm.
    /// Lỗi (`openFailed`): kho rỗng hoặc không tạo/ghi được file; thông báo không chứa đường dẫn.
    fn create() -> DbResult<Self> {
        let certs = tls::root_certs_der(None)?;
        // PEM = base64 của DER chia dòng 64 ký tự, kèm dòng BEGIN/END.
        let mut pem = String::with_capacity(certs.iter().map(|c| c.len() * 4 / 3 + 100).sum());
        for der in &certs {
            pem.push_str("-----BEGIN CERTIFICATE-----\n");
            let b64 = STANDARD.encode(der.as_ref());
            // base64 chỉ có ký tự ASCII nên cắt ở byte nào cũng đúng ranh giới ký tự.
            let mut rest = b64.as_str();
            while !rest.is_empty() {
                let (line, tail) = rest.split_at(rest.len().min(64));
                pem.push_str(line);
                pem.push('\n');
                rest = tail;
            }
            pem.push_str("-----END CERTIFICATE-----\n");
        }

        // `RandomState` được seed ngẫu nhiên từ hệ điều hành cho mỗi lần tạo.
        let random = RandomState::new().build_hasher().finish();
        let path =
            std::env::temp_dir().join(format!("s3b-ca-{}-{random:016x}.pem", std::process::id()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| {
                DbError::new(
                    OPEN_FAILED,
                    format!("cannot create temporary CA file: {}", e.kind()),
                )
            })?;
        // Guard tạo sau `file` nên khi ghi lỗi nó bị drop trước (xoá file vừa tạo; Windows vẫn
        // xoá được vì Rust mở file với `FILE_SHARE_DELETE`).
        let guard = Self(path);
        file.write_all(pem.as_bytes()).map_err(|e| {
            DbError::new(
                OPEN_FAILED,
                format!("cannot write temporary CA file: {}", e.kind()),
            )
        })?;
        Ok(guard)
    }
}

impl Drop for RootsFile {
    fn drop(&mut self) {
        // Không xoá được thì không còn gì làm thêm (file chỉ có CA công khai).
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Đóng `Client` gọn gàng (chờ các `killCursors` ngầm), có giới hạn thời gian.
async fn shutdown(client: Client) {
    let _ = tokio::time::timeout(SHUTDOWN_TIMEOUT, client.shutdown()).await;
}

/// Lỗi của `mongodb` thành chuỗi. Lỗi lệnh có dạng `Unauthorized (13): command find requires
/// authentication`. Không chứa mật khẩu: `ClientOptions` không đi qua chuỗi URI, và thông báo
/// của crate chỉ nêu địa chỉ server, tên tài khoản hoặc mô tả lỗi của server.
fn error_text(e: &MongoError) -> String {
    match e.kind.as_ref() {
        ErrorKind::Command(c) => format!("{} ({}): {}", c.code_name, c.code, c.message),
        other => other.to_string(),
    }
}

/// Huỷ do actor tự làm (`select!` trên tín hiệu huỷ), nên registry không cần ngắt gì thêm.
struct NoInterrupt;

impl Interrupt for NoInterrupt {
    fn interrupt(&self) {}
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mongodb/mod.rs"]
mod tests;
