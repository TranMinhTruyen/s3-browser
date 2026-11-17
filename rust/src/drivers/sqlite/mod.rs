//! Driver SQLite: mỗi connection là một actor tokio sở hữu `SqliteConnection`.

mod actor;
pub mod raw;
mod schema;
mod split;
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

pub type Reply<T> = oneshot::Sender<DbResult<T>>;

/// Một lệnh gửi tới actor: tham số, cờ huỷ của request và kênh trả kết quả.
pub struct Job<P, R> {
    pub id: u64,
    pub params: P,
    pub cancel: Arc<AtomicBool>,
    pub reply: Reply<R>,
}

pub enum Cmd {
    Execute(Job<ExecuteParams, ExecuteResult>),
    Fetch(Job<FetchParams, FetchResult>),
    TableRows(Job<TableRowsParams, StatementResult>),
    SchemaTree(Job<(), SchemaTreeResult>),
    TableInfo(Job<TableParams, TableInfoResult>),
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

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// SQLITE_NOTADB
const NOTADB_CODE: &str = "26";

pub fn is_not_a_database(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(d) => {
            d.code().as_deref() == Some(NOTADB_CODE) || d.message().contains("not a database")
        }
        _ => false,
    }
}

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

    let interrupt = match conn.lock_handle().await {
        Ok(mut h) => raw::InterruptHandle::of(&mut h),
        Err(e) => return Err(DbError::internal(e.to_string())),
    };
    let reg = registry::global();
    let id = reg.next_conn_id();
    let (tx, rx) = mpsc::channel(8);
    reg.add_conn(id, tx, interrupt);
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
