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

/// Params của `open`: mở một file database.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenParams {
    /// Loại database, hiện chỉ nhận `sqlite`.
    pub driver: String,
    /// Đường dẫn file database.
    pub path: String,
    /// Mở chỉ đọc; vắng trong JSON thì là `false` (`default`).
    #[serde(default)]
    pub read_only: bool,
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
