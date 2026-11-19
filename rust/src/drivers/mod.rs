//! Lớp dùng chung của mọi driver: kiểu lệnh (`Cmd`/`Job`), chọn driver theo `open`, gửi lệnh
//! tới actor của connection và đóng connection.
//!
//! Vị trí trong luồng: `dispatch` chỉ gọi `open`/`close`/`request` ở file này; các hàm đó chọn
//! driver (`sqlite`...) rồi gửi `Cmd` qua kênh tới actor của connection. Phần code dùng chung
//! cho nhiều driver (trang kết quả, `hold`, dựng `StatementResult`) nằm ở `common`.
//!
//! Actor = một task chạy vòng lặp, là nơi *duy nhất* chạm vào connection; bên ngoài chỉ gửi
//! tin nhắn. Nhờ vậy không cần khoá quanh connection (giống mô hình goroutine + channel của Go).
//! `mpsc` là kênh nhiều-gửi-một-nhận (như `chan`); `oneshot` là kênh dùng đúng một lần để
//! trả kết quả cho người gửi lệnh.

/// Phần dùng chung: giới hạn trang, dựng kết quả, giữ cursor, hex.
pub mod common;
/// Đổi số ngày/micro giây/ticks sang chuỗi ngày giờ ISO.
pub mod datetime;
/// Driver PostgreSQL.
pub mod postgres;
/// Tách một đoạn SQL thành từng câu (PostgreSQL, MySQL/MariaDB, SQL Server).
pub mod split_sql;
/// Driver SQLite.
pub mod sqlite;
/// Cấu hình TLS (rustls) cho các driver mạng.
pub mod tls;

use crate::protocol::{
    CONN_NOT_FOUND, DbError, DbResult, Empty, ExecuteParams, ExecuteResult, FetchParams,
    FetchResult, INVALID_REQUEST, OpenParams, OpenResult, SchemaTreeResult, StatementResult,
    TableInfoResult, TableParams, TableRowsParams,
};
use crate::registry::{self, CancelSignal};
use std::sync::Arc;
use tokio::sync::oneshot;

/// Đầu gửi của kênh `oneshot` để actor trả `DbResult<T>` cho người chờ.
pub type Reply<T> = oneshot::Sender<DbResult<T>>;

/// Một lệnh gửi tới actor: tham số, tín hiệu huỷ của request và kênh trả kết quả.
/// `P` là kiểu params, `R` là kiểu kết quả (generic, tương tự type parameter của Go).
pub struct Job<P, R> {
    /// Id request (cùng id với `s3b_cancel`).
    pub id: u64,
    pub params: P,
    /// Tín hiệu huỷ dùng chung với registry; actor kiểm trong lúc chạy.
    pub cancel: Arc<CancelSignal>,
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
    /// Id request và tín hiệu huỷ của lệnh (`Close` không có).
    pub fn request(&self) -> Option<(u64, &CancelSignal)> {
        match self {
            Cmd::Execute(j) => Some((j.id, j.cancel.as_ref())),
            Cmd::Fetch(j) => Some((j.id, j.cancel.as_ref())),
            Cmd::TableRows(j) => Some((j.id, j.cancel.as_ref())),
            Cmd::SchemaTree(j) => Some((j.id, j.cancel.as_ref())),
            Cmd::TableInfo(j) => Some((j.id, j.cancel.as_ref())),
            Cmd::Close(_) => None,
        }
    }

    /// Lệnh đọc cấu trúc/table theo tên; chỉ driver SQLite hỗ trợ.
    fn needs_schema(&self) -> bool {
        matches!(
            self,
            Cmd::TableRows(_) | Cmd::SchemaTree(_) | Cmd::TableInfo(_)
        )
    }

    /// Trả `cancelled` cho request chưa kịp chạy.
    pub fn reject_cancelled(self) {
        // Gán hàm vào biến để gọi lại `err()` ở từng nhánh (mỗi nhánh cần một `DbError` mới).
        let err = common::cancelled;
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

/// Mở connection theo `p.driver`. Driver mạng chưa có (thêm ở các task sau) và driver lạ đều
/// là `invalidRequest`; driver mạng thiếu `host` cũng vậy.
pub async fn open(p: OpenParams) -> DbResult<OpenResult> {
    match p.driver.as_str() {
        sqlite::DRIVER => sqlite::open(p).await,
        postgres::DRIVER => postgres::open(p).await,
        "mysql" | "mariadb" | "sqlserver" | "mongodb" | "redis" => {
            if p.host.as_deref().is_none_or(str::is_empty) {
                return Err(DbError::new(INVALID_REQUEST, "missing host"));
            }
            Err(DbError::new(INVALID_REQUEST, "driver not implemented yet"))
        }
        _ => Err(DbError::new(INVALID_REQUEST, "unknown driver")),
    }
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
    // Chỉ SQLite có cây đối tượng/thông tin table; driver khác từ chối ngay, không gửi tới actor.
    if cmd.needs_schema() && reg.conn_driver(conn_id) != Some(sqlite::DRIVER) {
        return Err(DbError::new(
            INVALID_REQUEST,
            "method not supported by driver",
        ));
    }
    tx.send(cmd)
        .await
        .map_err(|_| DbError::internal("connection actor stopped"))?;
    rx.await
        .map_err(|_| DbError::internal("connection actor stopped"))?
}
