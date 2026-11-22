//! Driver SQLite: mỗi connection là một actor tokio sở hữu `SqliteConnection`.
//!
//! Vị trí trong luồng: `drivers::open` gọi `open` ở file này; `drivers::request` gửi `Cmd`
//! qua kênh tới `actor::run` của connection, actor chạy SQL (dùng `raw`, `schema`, `split`,
//! `value`) rồi trả kết quả ngược qua kênh. Kiểu lệnh `Cmd`/`Job` và các hàm `close`/`request`
//! dùng chung nằm ở `drivers`.
//!
//! Actor = một task chạy vòng lặp, là nơi *duy nhất* chạm vào connection; bên ngoài chỉ gửi
//! tin nhắn (xem `drivers`).

/// Vòng lặp actor và việc chạy câu SQL, cursor.
mod actor;
/// Gọi SQLite C API (toàn bộ `unsafe` ở đây).
pub(crate) mod raw;
/// Đọc cấu trúc database (cây đối tượng, thông tin table).
mod schema;
/// Nhận biết phần SQL còn lại chỉ là khoảng trắng/comment.
mod split;
/// Đổi giá trị ô sang chuỗi.
mod value;

use crate::protocol::{
    DbError, DbResult, INVALID_REQUEST, NOT_A_DATABASE, OPEN_FAILED, OpenParams, OpenResult,
};
use crate::registry;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

/// Tên driver trong `open.driver`.
pub const DRIVER: &str = "sqlite";

/// Chờ tối đa bao lâu khi file đang bị tiến trình khác khoá, trước khi báo lỗi.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Mã lỗi SQLite `SQLITE_NOTADB`: file không phải database SQLite.
const NOTADB_CODE: &str = "26";

/// `true` nếu lỗi sqlx là "file không phải SQLite" (theo mã lỗi hoặc nội dung thông báo).
pub fn is_not_a_database(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(d) => {
            d.code().as_deref() == Some(NOTADB_CODE) || d.message().contains("not a database")
        }
        _ => false,
    }
}

/// Đổi lỗi sqlx khi mở file thành `notADatabase` hoặc `openFailed`. `&sqlx::Error` là mượn lỗi.
fn open_error(e: &sqlx::Error) -> DbError {
    if is_not_a_database(e) {
        DbError::new(NOT_A_DATABASE, e.to_string())
    } else {
        DbError::new(OPEN_FAILED, e.to_string())
    }
}

/// Mở connection (không tạo file mới), kiểm đúng là SQLite rồi chạy actor.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    // `path` là `Option<String>` (có thể vắng trong JSON): thiếu thì là yêu cầu sai.
    let Some(path) = p.path.as_deref() else {
        return Err(DbError::new(INVALID_REQUEST, "missing path"));
    };
    // Giữ mặc định của SQLite (không ép foreign_keys, journal_mode) để không đổi hành vi file người dùng.
    // Chuỗi builder: mỗi hàm trả lại options đã chỉnh; `.await?` chờ kết nối, lỗi thì thoát hàm.
    let mut conn = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(p.read_only)
        .busy_timeout(BUSY_TIMEOUT)
        .foreign_keys(false)
        .connect()
        .await
        .map_err(|e| open_error(&e))?;

    // File không phải SQLite chỉ lộ ra ở lần đọc đầu tiên.
    if let Err(e) = sqlx::query("PRAGMA schema_version")
        .persistent(false)
        .fetch_one(&mut conn)
        .await
    {
        let _ = conn.close().await;
        return Err(open_error(&e));
    }

    // Lấy handle `sqlite3*` thô để `s3b_cancel` có thể ngắt câu đang chạy từ thread khác.
    let interrupt = match conn.lock_handle().await {
        // SAFETY: handle chỉ được dùng qua registry; actor gỡ nó khỏi registry (`RegistryGuard`,
        // `Close`) trước khi connection bị đóng/drop, và `close` cũng gỡ trước khi gửi `Close`.
        Ok(mut h) => unsafe { raw::InterruptHandle::of(&mut h) },
        Err(e) => return Err(DbError::internal(e.to_string())),
    };
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, DRIVER, tx, Arc::new(interrupt));
    // `conn` được chuyển (move) vào actor; sau dòng này hàm `open` không còn dùng được nó.
    tokio::spawn(actor::run(id, conn, rx));
    Ok(OpenResult { conn_id: id })
}
