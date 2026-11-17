//! Kiểu JSON trao đổi với Go (field camelCase) và mã lỗi ổn định.

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

// Mã lỗi: Go map sang DBE<NNN> (xem plan sprint-19).
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
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DbError {
    pub code: &'static str,
    pub message: String,
}

impl DbError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(INTERNAL, message)
    }
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Deserialize)]
pub struct Request<'a> {
    pub id: u64,
    pub method: String,
    #[serde(borrow)]
    pub params: Option<&'a RawValue>,
}

/// Tạo response `{"ok":true,"result":...}` ghi thẳng vào một buffer.
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenParams {
    pub driver: String,
    pub path: String,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnParams {
    pub conn_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteParams {
    pub conn_id: u64,
    pub sql: String,
    pub page_size: usize,
    pub max_page_bytes: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchParams {
    pub conn_id: u64,
    pub cursor_id: u64,
    pub page_size: usize,
    pub max_page_bytes: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableParams {
    pub conn_id: u64,
    pub schema: String,
    pub table: String,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub conn_id: u64,
}

#[derive(Serialize)]
pub struct Empty {}

#[derive(Serialize)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    pub index: usize,
    pub sql: String,
    /// `rows` hoặc `affected`.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<Column>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<Option<String>>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DbError>,
}

#[derive(Serialize)]
pub struct ExecuteResult {
    pub statements: Vec<StatementResult>,
}

#[derive(Serialize)]
pub struct FetchResult {
    pub rows: Vec<Vec<Option<String>>>,
    pub done: bool,
}

#[derive(Serialize)]
pub struct NamedOn {
    pub name: String,
    pub table: String,
}

#[derive(Serialize)]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<String>,
    pub views: Vec<String>,
    pub indexes: Vec<NamedOn>,
    pub triggers: Vec<NamedOn>,
}

#[derive(Serialize)]
pub struct SchemaTreeResult {
    pub schemas: Vec<SchemaNode>,
}

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

#[derive(Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<String>,
}

#[derive(Serialize)]
pub struct ConstraintInfo {
    pub kind: &'static str,
    pub name: Option<String>,
    pub columns: Vec<String>,
    pub expression: Option<String>,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfoResult {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub ddl: Option<String>,
}
