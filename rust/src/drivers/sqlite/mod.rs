//! Driver SQLite: mỗi connection là một actor tokio sở hữu `SqliteConnection`.
//!
//! Vị trí trong luồng: `dispatch` gọi `open`/`close`/`request` ở file này; `request` gửi lệnh
//! qua kênh tới `actor::run` của connection, actor chạy SQL (dùng `raw`, `schema`, `split`,
//! `value`) rồi trả kết quả ngược qua kênh.
//!
//! Actor = một task chạy vòng lặp, là nơi *duy nhất* chạm vào connection; bên ngoài chỉ gửi
//! tin nhắn. Nhờ vậy không cần khoá quanh connection (giống mô hình goroutine + channel của Go).
//! `mpsc` là kênh nhiều-gửi-một-nhận (như `chan`); `oneshot` là kênh dùng đúng một lần để
//! trả kết quả cho người gửi lệnh.

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
    CONN_NOT_FOUND, DbError, DbResult, Empty, ExecuteParams, ExecuteResult, FetchParams,
    FetchResult, INVALID_REQUEST, NOT_A_DATABASE, OPEN_FAILED, OpenParams, OpenResult,
    SchemaTreeResult, StatementResult, TableInfoResult, TableParams, TableRowsParams,
};
use crate::registry;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

/// Đầu gửi của kênh `oneshot` để actor trả `DbResult<T>` cho người chờ.
pub type Reply<T> = oneshot::Sender<DbResult<T>>;

/// Một lệnh gửi tới actor: tham số, cờ huỷ của request và kênh trả kết quả.
/// `P` là kiểu params, `R` là kiểu kết quả (generic, tương tự type parameter của Go).
pub struct Job<P, R> {
    /// Id request (cùng id với `s3b_cancel`).
    pub id: u64,
    pub params: P,
    /// Cờ huỷ dùng chung với registry; actor kiểm trong lúc chạy.
    pub cancel: Arc<AtomicBool>,
    pub reply: Reply<R>,
}

/// Các lệnh actor hiểu. `enum` của Rust mang theo dữ liệu riêng cho từng biến thể.
/// Mỗi biến thể ứng với một `method` của `dispatch`, trừ `Close` do `close` gửi.
pub enum Cmd {
    Execute(Job<ExecuteParams, ExecuteResult>),
    Fetch(Job<FetchParams, FetchResult>),
    TableRows(Job<TableRowsParams, StatementResult>),
    SchemaTree(Job<(), SchemaTreeResult>),
    TableInfo(Job<TableParams, TableInfoResult>),
    /// Đóng connection; actor báo xong qua kênh này.
    Close(oneshot::Sender<()>),
}

impl Cmd {
    /// Id request và cờ huỷ của lệnh (`Close` không có).
    pub fn request(&self) -> Option<(u64, &AtomicBool)> {
        match self {
            Cmd::Execute(j) => Some((j.id, &j.cancel)),
            Cmd::Fetch(j) => Some((j.id, &j.cancel)),
            Cmd::TableRows(j) => Some((j.id, &j.cancel)),
            Cmd::SchemaTree(j) => Some((j.id, &j.cancel)),
            Cmd::TableInfo(j) => Some((j.id, &j.cancel)),
            Cmd::Close(_) => None,
        }
    }

    /// Trả `cancelled` cho request chưa kịp chạy.
    pub fn reject_cancelled(self) {
        // Gán hàm vào biến để gọi lại `err()` ở từng nhánh (mỗi nhánh cần một `DbError` mới).
        let err = actor::cancelled;
        match self {
            Cmd::Execute(j) => drop(j.reply.send(Err(err()))),
            Cmd::Fetch(j) => drop(j.reply.send(Err(err()))),
            Cmd::TableRows(j) => drop(j.reply.send(Err(err()))),
            Cmd::SchemaTree(j) => drop(j.reply.send(Err(err()))),
            Cmd::TableInfo(j) => drop(j.reply.send(Err(err()))),
            Cmd::Close(done) => drop(done.send(())),
        }
    }
}

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
    if p.driver != "sqlite" {
        return Err(DbError::new(INVALID_REQUEST, "unsupported driver"));
    }
    // Giữ mặc định của SQLite (không ép foreign_keys, journal_mode) để không đổi hành vi file người dùng.
    // Chuỗi builder: mỗi hàm trả lại options đã chỉnh; `.await?` chờ kết nối, lỗi thì thoát hàm.
    let mut conn = SqliteConnectOptions::new()
        .filename(&p.path)
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
    reg.add_conn(id, tx, interrupt);
    // `conn` được chuyển (move) vào actor; sau dòng này hàm `open` không còn dùng được nó.
    tokio::spawn(actor::run(id, conn, rx));
    Ok(OpenResult { conn_id: id })
}

/// Đóng connection (và cursor đang mở). Id không còn thì coi như đã đóng.
pub async fn close(conn_id: u64) -> DbResult<Empty> {
    // Ngắt câu đang chạy để lệnh đóng không phải chờ; gỡ khỏi registry trước khi actor đóng connection.
    if let Some(tx) = registry::global().remove_conn(conn_id, true) {
        let (reply, done) = oneshot::channel();
        if tx.send(Cmd::Close(reply)).await.is_ok() {
            let _ = done.await;
        }
    }
    Ok(Empty {})
}

/// Gửi một lệnh tới actor của `conn_id` rồi chờ kết quả; request được đăng ký để `s3b_cancel` huỷ được.
/// `wrap` bọc `Job` thành đúng biến thể `Cmd` (ví dụ `Cmd::Execute`); `impl FnOnce` là một hàm/closure
/// chỉ gọi được một lần. `guard` sống tới hết hàm nên request tự gỡ khỏi registry khi xong.
pub async fn request<P, R>(
    id: u64,
    conn_id: u64,
    params: P,
    wrap: impl FnOnce(Job<P, R>) -> Cmd,
) -> DbResult<R> {
    let reg = registry::global();
    let tx = reg
        .conn_tx(conn_id)
        .ok_or_else(|| DbError::new(CONN_NOT_FOUND, "connection is closed"))?;
    let guard = reg.begin_request(id, conn_id);
    let (reply, rx) = oneshot::channel();
    let cmd = wrap(Job {
        id,
        params,
        cancel: guard.flag.clone(),
        reply,
    });
    tx.send(cmd)
        .await
        .map_err(|_| DbError::internal("connection actor stopped"))?;
    rx.await
        .map_err(|_| DbError::internal("connection actor stopped"))?
}
