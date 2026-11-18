//! Kiểu JSON trao đổi với Go (field camelCase) và mã lỗi ổn định.
//!
//! Vị trí trong luồng: `dispatch` parse `params` của request thành các kiểu `*Params` ở đây,
//! driver trả các kiểu `*Result`, rồi `ok_response`/`error_response` đóng gói thành JSON.
//!
//! Khái niệm Rust: `#[derive(Deserialize)]`/`#[derive(Serialize)]` (thư viện serde) tự sinh code
//! đọc/ghi JSON cho struct, giống `json` tag của Go. `rename_all = "camelCase"` đổi tên field
//! `conn_id` (snake_case của Rust) thành `connId` trong JSON.

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

// Mã lỗi ổn định trả cho Go; Go map sang message `DBE<NNN>`.
pub const INVALID_REQUEST: &str = "invalidRequest";
pub const OPEN_FAILED: &str = "openFailed";
pub const NOT_A_DATABASE: &str = "notADatabase";
pub const CONN_NOT_FOUND: &str = "connNotFound";
pub const CURSOR_NOT_FOUND: &str = "cursorNotFound";
pub const SQL_ERROR: &str = "sqlError";
pub const TABLE_NOT_FOUND: &str = "tableNotFound";
pub const INTERNAL: &str = "internal";
pub const CANCELLED: &str = "cancelled";

/// Lỗi nghiệp vụ: `message` chỉ là chi tiết kỹ thuật, không chứa dữ liệu truy vấn.
/// `derive` tự thêm các khả năng: in debug, nhân bản (`Clone`), so sánh bằng (`PartialEq`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DbError {
    /// Một trong các hằng mã lỗi ở trên (`&'static str`: chuỗi cố định có sẵn trong chương trình).
    pub code: &'static str,
    /// Chi tiết kỹ thuật cho log/hiển thị.
    pub message: String,
}

impl DbError {
    /// Tạo lỗi từ mã và thông báo. `impl Into<String>` cho phép truyền cả `&str` lẫn `String`.
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Lỗi nội bộ (`internal`): bug hoặc trạng thái không mong đợi, không phải lỗi người dùng.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(INTERNAL, message)
    }
}

/// Kết quả của thao tác DB: `Ok(T)` hoặc `Err(DbError)`.
pub type DbResult<T> = Result<T, DbError>;

/// Request từ Go: `{"id":..,"method":"..","params":{..}}`.
/// `'a` là lifetime: `params` *mượn* một lát của buffer JSON gốc (không copy) nên `Request`
/// không được sống lâu hơn buffer đó; compiler kiểm điều này lúc build.
#[derive(Deserialize)]
pub struct Request<'a> {
    /// Id request, dùng cho `s3b_cancel`.
    pub id: u64,
    /// Tên method để `dispatch` chọn handler.
    pub method: String,
    /// JSON thô của params, chỉ parse khi biết method cần kiểu nào. `Option` vì có thể vắng.
    #[serde(borrow)]
    pub params: Option<&'a RawValue>,
}

/// Tạo response `{"ok":true,"result":...}` ghi thẳng vào một buffer.
/// `T: Serialize` nhận mọi kiểu ghi được ra JSON; `&T` là mượn, không lấy quyền sở hữu.
pub fn ok_response<T: Serialize>(result: &T) -> Vec<u8> {
    let mut out = Vec::with_capacity(256);
    out.extend_from_slice(br#"{"ok":true,"result":"#);
    if serde_json::to_writer(&mut out, result).is_err() {
        return error_response(&DbError::internal("serialize response"));
    }
    out.push(b'}');
    out
}

/// Tạo response `{"ok":false,"error":{code,message}}`.
pub fn error_response(err: &DbError) -> Vec<u8> {
    /// Khung response lỗi; chỉ dùng trong hàm này nên khai báo ngay trong thân hàm.
    #[derive(Serialize)]
    struct Body<'a> {
        ok: bool,
        error: &'a DbError,
    }
    serde_json::to_vec(&Body {
        ok: false,
        error: err,
    })
    // Serialize hai chuỗi không thể lỗi; có chuỗi cố định để không phải unwrap.
    .unwrap_or_else(|_| {
        br#"{"ok":false,"error":{"code":"internal","message":"serialize error"}}"#.to_vec()
    })
}

// ---- Params ----

/// Chế độ TLS của `open` cho driver mạng (theo `sslmode` của libpq); SQLite bỏ qua.
/// `kebab-case` biến `VerifyCa` thành `"verify-ca"` trong JSON; giá trị lạ làm parse lỗi
/// (`invalidRequest`). `Default` cho `Disable` để vắng `tls` nghĩa là không mã hoá.
#[derive(Deserialize, Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    /// Không TLS.
    #[default]
    Disable,
    /// Thử không TLS trước, server bắt buộc TLS thì nối TLS (không kiểm cert).
    Allow,
    /// Thử TLS trước, không được thì nối thường (không kiểm cert).
    Prefer,
    /// Bắt buộc TLS, không kiểm cert.
    Require,
    /// Bắt buộc TLS, kiểm chuỗi CA nhưng không kiểm hostname.
    VerifyCa,
    /// Bắt buộc TLS, kiểm chuỗi CA và hostname.
    VerifyFull,
}

/// Cấu hình TLS trong `open`: `{"mode": "...", "caFile": "..."}`.
#[derive(Deserialize, Debug, Default, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TlsParams {
    /// Chế độ TLS; vắng thì `disable`.
    #[serde(default)]
    pub mode: TlsMode,
    /// File PEM chứa CA tin cậy; vắng thì dùng kho chứng chỉ của Windows.
    #[serde(default)]
    pub ca_file: Option<String>,
}

/// Params của `open`: mở một file database (SQLite) hoặc kết nối tới server (driver mạng).
/// Mọi field ngoài `driver` đều tuỳ chọn (`default`) vì mỗi driver dùng một tập khác nhau; không
/// derive `Debug` để mật khẩu không vô tình bị in ra log.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenParams {
    /// Loại database: `sqlite`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `mongodb`, `redis`.
    pub driver: String,
    /// Đường dẫn file database (chỉ SQLite).
    #[serde(default)]
    pub path: Option<String>,
    /// Mở chỉ đọc (chỉ SQLite); vắng trong JSON thì là `false`.
    #[serde(default)]
    pub read_only: bool,
    /// Địa chỉ server (driver mạng).
    #[serde(default)]
    pub host: Option<String>,
    /// Cổng server; vắng thì driver dùng cổng mặc định của nó.
    #[serde(default)]
    pub port: Option<u16>,
    /// Tên database mặc định (Redis: số DB).
    #[serde(default)]
    pub database: Option<String>,
    /// Tên đăng nhập.
    #[serde(default)]
    pub username: Option<String>,
    /// Mật khẩu; chỉ nằm trong RAM, không được ghi vào log hay message lỗi.
    #[serde(default)]
    pub password: Option<String>,
    /// Cấu hình TLS cho driver mạng.
    #[serde(default)]
    pub tls: TlsParams,
}

/// Params chỉ cần `connId` (`close`, `schemaTree`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnParams {
    pub conn_id: u64,
}

/// Params của `execute`: chạy một hoặc nhiều câu SQL.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteParams {
    pub conn_id: u64,
    pub sql: String,
    /// Số dòng tối đa mỗi trang.
    pub page_size: usize,
    /// Dừng đọc trang khi tổng byte chuỗi vượt mức này (luôn có ít nhất 1 dòng).
    pub max_page_bytes: usize,
}

/// Params của `fetch`: lấy trang tiếp theo của một cursor đang mở.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchParams {
    pub conn_id: u64,
    pub cursor_id: u64,
    pub page_size: usize,
    pub max_page_bytes: usize,
}

/// Params của `tableInfo`: chỉ ra một table/view theo schema và tên.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableParams {
    pub conn_id: u64,
    pub schema: String,
    pub table: String,
}

/// Params của `tableRows`: đọc dòng của một table/view theo trang.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowsParams {
    pub conn_id: u64,
    pub schema: String,
    pub table: String,
    pub page_size: usize,
    pub max_page_bytes: usize,
}

// ---- Result ----

/// Kết quả `open`: id connection để dùng cho các request sau.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub conn_id: u64,
}

/// Kết quả rỗng `{}` (ví dụ `close`).
#[derive(Serialize)]
pub struct Empty {}

/// Một cột của kết quả.
#[derive(Serialize)]
pub struct Column {
    pub name: String,
    /// Kiểu khai báo của cột; đặt tên `ty` vì `type` là từ khoá Rust, JSON vẫn là `type`.
    #[serde(rename = "type")]
    pub ty: String,
}

/// Kết quả của một câu SQL trong `execute`. Field `Option` là `None` thì không xuất hiện
/// trong JSON (`skip_serializing_if`), nên chỉ có field hợp với `kind`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// Thứ tự câu trong request (từ 0).
    pub index: usize,
    /// Nội dung câu đã cắt khoảng trắng.
    pub sql: String,
    /// `rows` hoặc `affected`.
    pub kind: &'static str,
    /// Cột kết quả (chỉ khi `kind = rows`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<Column>>,
    /// Trang dòng đầu tiên; mỗi ô là chuỗi, `None` = NULL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<Option<String>>>>,
    /// Có khi còn dòng và actor đang giữ cursor để `fetch` tiếp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_id: Option<u64>,
    /// `true` khi đã hết dòng.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    /// `true` khi còn dòng nhưng bị bỏ vì không phải câu cuối (không giữ cursor).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    /// Số dòng bị thay đổi (chỉ khi `kind = affected`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
    /// Thời gian chạy câu, mili giây.
    pub elapsed_ms: u64,
    /// Từ lúc gửi câu tới khi có dòng đầu (server + mạng), mili giây; chỉ driver mạng điền.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_row_ms: Option<u64>,
    /// Chỉ khi bật feature `bench-timing`: tổng thời gian chờ driver trả dòng kế tiếp.
    #[cfg(feature = "bench-timing")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_ms: Option<u64>,
    /// Chỉ khi bật feature `bench-timing`: tổng thời gian đổi ô sang chuỗi và dựng trang.
    #[cfg(feature = "bench-timing")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convert_ms: Option<u64>,
    /// Lỗi của riêng câu này; các câu sau không chạy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DbError>,
}

/// Kết quả `execute`: một phần tử cho mỗi câu đã chạy.
#[derive(Serialize)]
pub struct ExecuteResult {
    pub statements: Vec<StatementResult>,
}

/// Kết quả `fetch`: trang dòng tiếp theo; `done` khi cursor hết dòng.
#[derive(Serialize)]
pub struct FetchResult {
    pub rows: Vec<Vec<Option<String>>>,
    pub done: bool,
}

/// Index hoặc trigger kèm tên table mà nó thuộc về.
#[derive(Serialize)]
pub struct NamedOn {
    pub name: String,
    pub table: String,
}

/// Một schema (SQLite chỉ có `main`) và các đối tượng bên trong, cho cây đối tượng.
#[derive(Serialize)]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<String>,
    pub views: Vec<String>,
    pub indexes: Vec<NamedOn>,
    pub triggers: Vec<NamedOn>,
}

/// Kết quả `schemaTree`.
#[derive(Serialize)]
pub struct SchemaTreeResult {
    pub schemas: Vec<SchemaNode>,
}

/// Thông tin chi tiết một cột của table (lấy từ `pragma_table_xinfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub cid: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    /// Vị trí trong khoá chính (1-based), 0 nếu không thuộc khoá chính.
    pub pk: i64,
}

/// Thông tin một index; `origin` là `c` (CREATE INDEX), `u` (UNIQUE) hoặc `pk`.
#[derive(Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<String>,
}

/// Một ràng buộc: PRIMARY KEY, UNIQUE hoặc CHECK.
#[derive(Serialize)]
pub struct ConstraintInfo {
    pub kind: &'static str,
    pub name: Option<String>,
    pub columns: Vec<String>,
    pub expression: Option<String>,
}

/// Một khoá ngoại; khoá nhiều cột gom vào cùng `id`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub id: i64,
    pub columns: Vec<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
    pub on_update: String,
    pub on_delete: String,
}

/// Kết quả `tableInfo`: cấu trúc đầy đủ của table/view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfoResult {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub ddl: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::fmt::Debug;
    use std::marker::PhantomData;

    /// Mẹo kiểm lúc biên dịch: `Probe::<T>::new().is_debug()` trả `true` chỉ khi `T: Debug`
    /// (phương thức riêng có ràng buộc thắng phương thức của trait khi ràng buộc thoả mãn).
    struct Probe<T>(PhantomData<T>);

    trait NotDebug {
        fn is_debug(&self) -> bool {
            false
        }
    }

    impl<T> NotDebug for Probe<T> {}

    impl<T: Debug> Probe<T> {
        fn is_debug(&self) -> bool {
            true
        }
    }

    fn open(v: Value) -> Result<OpenParams, serde_json::Error> {
        serde_json::from_value(v)
    }

    fn tls(v: Value) -> Result<TlsParams, serde_json::Error> {
        serde_json::from_value(v)
    }

    // ---- TlsMode ----

    #[test]
    fn all_six_tls_modes_parse() {
        for (text, mode) in [
            ("disable", TlsMode::Disable),
            ("allow", TlsMode::Allow),
            ("prefer", TlsMode::Prefer),
            ("require", TlsMode::Require),
            ("verify-ca", TlsMode::VerifyCa),
            ("verify-full", TlsMode::VerifyFull),
        ] {
            let got: TlsMode = serde_json::from_value(json!(text)).unwrap();
            assert_eq!(got, mode, "{text}");
        }
    }

    #[test]
    fn unknown_or_misspelled_tls_modes_are_rejected() {
        for text in [
            "",
            "on",
            "off",
            "ssl",
            "verify_ca",
            "verifyCa",
            "VerifyCa",
            "verify-full ",
            "Disable",
            "REQUIRE",
            "verify",
        ] {
            assert!(
                serde_json::from_value::<TlsMode>(json!(text)).is_err(),
                "{text:?} phải bị từ chối"
            );
        }
        for not_a_string in [json!(null), json!(1), json!(true), json!(["require"])] {
            assert!(serde_json::from_value::<TlsMode>(not_a_string).is_err());
        }
    }

    #[test]
    fn tls_mode_default_is_disable() {
        assert_eq!(TlsMode::default(), TlsMode::Disable);
    }

    // ---- TlsParams ----

    #[test]
    fn tls_params_defaults_when_fields_are_missing() {
        let p = tls(json!({})).unwrap();
        assert_eq!(p.mode, TlsMode::Disable);
        assert_eq!(p.ca_file, None);
        assert_eq!(p, TlsParams::default());
    }

    #[test]
    fn tls_params_reads_mode_and_camel_case_ca_file() {
        let p = tls(json!({"mode": "verify-full", "caFile": "C:\\certs\\ca.pem"})).unwrap();
        assert_eq!(p.mode, TlsMode::VerifyFull);
        assert_eq!(p.ca_file.as_deref(), Some("C:\\certs\\ca.pem"));
    }

    #[test]
    fn tls_params_ca_file_alone_keeps_mode_disable() {
        let p = tls(json!({"caFile": "x.pem"})).unwrap();
        assert_eq!(p.mode, TlsMode::Disable);
        assert_eq!(p.ca_file.as_deref(), Some("x.pem"));
    }

    #[test]
    fn tls_params_null_ca_file_is_none() {
        let p = tls(json!({"mode": "require", "caFile": null})).unwrap();
        assert_eq!(p.ca_file, None);
    }

    #[test]
    fn tls_params_bad_types_are_rejected() {
        assert!(tls(json!({"mode": "bogus"})).is_err());
        assert!(tls(json!({"mode": 3})).is_err());
        assert!(tls(json!({"caFile": 3})).is_err());
        assert!(tls(json!({"caFile": ["a"]})).is_err());
    }

    #[test]
    fn tls_params_snake_case_ca_file_is_not_read() {
        // Hợp đồng là camelCase; `ca_file` bị bỏ qua như field lạ, không thành đường dẫn CA.
        let p = tls(json!({"mode": "require", "ca_file": "x.pem"})).unwrap();
        assert_eq!(p.ca_file, None);
    }

    // ---- OpenParams ----

    #[test]
    fn old_sqlite_open_json_still_parses() {
        let p = open(json!({"driver": "sqlite", "path": "C:\\data\\a.db"})).unwrap();
        assert_eq!(p.driver, "sqlite");
        assert_eq!(p.path.as_deref(), Some("C:\\data\\a.db"));
        assert!(!p.read_only);
        assert_eq!(p.host, None);
        assert_eq!(p.port, None);
        assert_eq!(p.database, None);
        assert_eq!(p.username, None);
        assert_eq!(p.password, None);
        assert_eq!(p.tls, TlsParams::default());

        let p = open(json!({"driver": "sqlite", "path": "a.db", "readOnly": true})).unwrap();
        assert!(p.read_only);
    }

    #[test]
    fn only_driver_is_required() {
        let p = open(json!({"driver": "postgres"})).unwrap();
        assert_eq!(p.driver, "postgres");
        assert_eq!(p.path, None);
        assert!(open(json!({})).is_err());
        assert!(open(json!({"path": "a.db"})).is_err());
        assert!(open(json!({"driver": null})).is_err());
        assert!(open(json!({"driver": 1})).is_err());
    }

    #[test]
    fn network_fields_are_read_in_camel_case() {
        let p = open(json!({
            "driver": "postgres",
            "host": "db.test",
            "port": 5432,
            "database": "app",
            "username": "u",
            "password": "p",
            "tls": {"mode": "verify-ca", "caFile": "ca.pem"},
            "readOnly": true,
        }))
        .unwrap();
        assert_eq!(p.host.as_deref(), Some("db.test"));
        assert_eq!(p.port, Some(5432));
        assert_eq!(p.database.as_deref(), Some("app"));
        assert_eq!(p.username.as_deref(), Some("u"));
        assert_eq!(p.password.as_deref(), Some("p"));
        assert_eq!(p.tls.mode, TlsMode::VerifyCa);
        assert_eq!(p.tls.ca_file.as_deref(), Some("ca.pem"));
        assert!(p.read_only);
    }

    #[test]
    fn port_boundaries() {
        assert_eq!(
            open(json!({"driver": "x", "port": 0})).unwrap().port,
            Some(0)
        );
        assert_eq!(
            open(json!({"driver": "x", "port": 65535})).unwrap().port,
            Some(65535)
        );
        for bad in [
            json!(65536),
            json!(-1),
            json!("5432"),
            json!(1.5),
            json!(true),
        ] {
            assert!(open(json!({"driver": "x", "port": bad})).is_err());
        }
        assert_eq!(
            open(json!({"driver": "x", "port": null})).unwrap().port,
            None
        );
    }

    #[test]
    fn unknown_tls_mode_inside_open_is_an_error() {
        assert!(open(json!({"driver": "postgres", "host": "h", "tls": {"mode": "yes"}})).is_err());
    }

    #[test]
    fn open_params_without_tls_uses_disable() {
        let p = open(json!({"driver": "postgres", "host": "h"})).unwrap();
        assert_eq!(p.tls.mode, TlsMode::Disable);
    }

    #[test]
    fn unknown_extra_fields_are_ignored() {
        let p = open(json!({"driver": "sqlite", "path": "a.db", "futureField": 1})).unwrap();
        assert_eq!(p.driver, "sqlite");
    }

    #[test]
    fn open_params_has_no_debug_but_tls_types_do() {
        // `OpenParams` chứa mật khẩu: không được `Debug` để không in nhầm ra log.
        assert!(!Probe::<OpenParams>(PhantomData).is_debug());
        assert!(Probe::<TlsParams>(PhantomData).is_debug());
        assert!(Probe::<TlsMode>(PhantomData).is_debug());
        assert!(Probe::<DbError>(PhantomData).is_debug());
    }

    #[test]
    fn debug_probe_detects_debug_types() {
        // Chứng minh mẹo kiểm tra không luôn trả `false`.
        assert!(Probe::<String>(PhantomData).is_debug());
    }

    // ---- Response ----

    #[test]
    fn error_response_has_stable_shape() {
        let v: Value =
            serde_json::from_slice(&error_response(&DbError::new(OPEN_FAILED, "boom"))).unwrap();
        assert_eq!(
            v,
            json!({"ok": false, "error": {"code": "openFailed", "message": "boom"}})
        );
    }

    #[test]
    fn ok_response_wraps_result() {
        let v: Value = serde_json::from_slice(&ok_response(&OpenResult { conn_id: 7 })).unwrap();
        assert_eq!(v, json!({"ok": true, "result": {"connId": 7}}));
        let v: Value = serde_json::from_slice(&ok_response(&Empty {})).unwrap();
        assert_eq!(v, json!({"ok": true, "result": {}}));
    }

    #[test]
    fn error_codes_are_the_documented_strings() {
        assert_eq!(
            [
                INVALID_REQUEST,
                OPEN_FAILED,
                NOT_A_DATABASE,
                CONN_NOT_FOUND,
                CURSOR_NOT_FOUND,
                SQL_ERROR,
                TABLE_NOT_FOUND,
                INTERNAL,
                CANCELLED,
            ],
            [
                "invalidRequest",
                "openFailed",
                "notADatabase",
                "connNotFound",
                "cursorNotFound",
                "sqlError",
                "tableNotFound",
                "internal",
                "cancelled",
            ]
        );
        assert_eq!(DbError::internal("x").code, INTERNAL);
    }

    #[test]
    fn request_params_are_optional_and_borrowed() {
        let r: Request = serde_json::from_str(r#"{"id":3,"method":"open"}"#).unwrap();
        assert_eq!((r.id, r.method.as_str()), (3, "open"));
        assert!(r.params.is_none());
        let r: Request =
            serde_json::from_str(r#"{"id":3,"method":"open","params":{"a":1}}"#).unwrap();
        assert_eq!(r.params.unwrap().get(), r#"{"a":1}"#);
    }

    #[test]
    fn statement_result_omits_first_row_ms_when_none() {
        let s = StatementResult {
            index: 0,
            sql: "SELECT 1".into(),
            kind: "rows",
            columns: None,
            rows: None,
            cursor_id: None,
            done: Some(true),
            truncated: None,
            rows_affected: None,
            elapsed_ms: 1,
            first_row_ms: None,
            #[cfg(feature = "bench-timing")]
            read_ms: None,
            #[cfg(feature = "bench-timing")]
            convert_ms: None,
            error: None,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert!(v.get("firstRowMs").is_none());
        let s = StatementResult {
            first_row_ms: Some(0),
            ..s
        };
        // `Some(0)` vẫn xuất hiện (khác `None`).
        assert_eq!(serde_json::to_value(&s).unwrap()["firstRowMs"], json!(0));
    }
}
