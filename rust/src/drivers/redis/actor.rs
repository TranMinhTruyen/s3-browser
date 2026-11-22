//! Actor của một connection Redis: nhận lệnh tuần tự, chạy từng lệnh Redis, giữ cursor (phần
//! reply còn dòng) giữa các lệnh `fetch`.
//!
//! Vị trí trong luồng: `redis::open` spawn `run` cho mỗi connection; `drivers::request` gửi
//! `Cmd` qua kênh `mpsc`; `run` chạy lệnh rồi trả kết quả qua kênh `oneshot` trong `Job`. Chỉ
//! actor này dùng `Session` nên không cần khoá (giống `mongodb::actor`).
//!
//! Một request `execute` có thể chứa nhiều lệnh (mỗi dòng một lệnh, xem `command`), chạy lần lượt
//! và dừng ở lệnh lỗi đầu tiên. Mỗi lệnh thành một `StatementResult` loại `rows` (Redis không có
//! "số dòng bị ảnh hưởng"; `SET` cho một dòng `OK`, `DEL` cho một dòng số key đã xoá). Reply nằm
//! trọn trong RAM (Redis gửi nguyên reply một lần), nên cursor chỉ là vị trí đọc dở trong reply
//! (`value::Reply`); chỉ lệnh cuối giữ cursor để `fetch` tiếp.
//!
//! Huỷ: Redis không dừng được lệnh đang chạy. Khi request bị huỷ, actor thả cả connection (đóng
//! TCP rồi server bỏ lệnh đang chờ như `BLPOP`) và nối lại ở lệnh kế tiếp. Hệ quả: trạng thái
//! gắn với connection mất đi (`MULTI`/`WATCH` dở, `CLIENT SETNAME`, `CLIENT REPLY`...); DB đang
//! chọn được nhớ nên không về DB 0. Lệnh nặng tự chạy tới khi xong trên server (Redis đơn luồng,
//! ví dụ `DEBUG SLEEP 30` vẫn chiếm server 30 giây) nên nối lại ngay sau đó có thể phải chờ.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `tokio::select!`: chờ nhiều future cùng lúc, cái nào xong trước thì chạy nhánh của nó và các
//!   future còn lại bị thả (giống `select` của Go trên nhiều channel).
//! - `Option::take`: lấy giá trị ra khỏi `Option` và để lại `None` (dùng để thả connection).

use super::command::{self, Command};
use super::value::{self, Reply};
use super::{Live, Target};
use crate::drivers::Cmd;
use crate::drivers::common::{
    Cursor, Limits, Page, PageBuilder, RegistryGuard, cancelled, cursor_not_found, elapsed_ms,
    hold, rows_statement, statement_error,
};
use crate::protocol::{
    CANCELLED, DbError, DbResult, ExecuteResult, INVALID_REQUEST, OPEN_FAILED, SQL_ERROR,
    StatementResult,
};
use crate::registry::{self, CancelSignal};
use redis::ErrorKind;
use std::time::Instant;
use tokio::sync::mpsc;

/// Connection đang mở cùng thông tin để nối lại.
pub struct Session {
    /// `None` sau khi bị thả (huỷ hoặc mất kết nối) và chưa nối lại.
    live: Option<Live>,
    /// Cách nối (gồm DB hiện tại và mode TLS/giao thức đã chọn lúc mở).
    target: Target,
}

impl Session {
    pub fn new(live: Live, target: Target) -> Self {
        Self {
            live: Some(live),
            target,
        }
    }

    /// Bảo đảm có connection dùng được, nối lại nếu vừa bị thả. Việc nối lại cũng có thể bị huỷ.
    async fn ensure_connected(&mut self, cancel: &CancelSignal) -> DbResult<&mut Live> {
        if self.live.is_none() {
            let live = tokio::select! {
                biased;
                () = cancel.cancelled() => return Err(cancelled()),
                r = tokio::time::timeout(super::CONNECT_TIMEOUT, self.target.connect()) => match r {
                    Ok(Ok(live)) => live,
                    Ok(Err(f)) => {
                        return Err(DbError::new(
                            OPEN_FAILED,
                            format!("reconnect failed: {}", f.message),
                        ));
                    }
                    Err(_) => {
                        return Err(DbError::new(OPEN_FAILED, "reconnect failed: timed out"));
                    }
                },
            };
            self.live = Some(live);
        }
        // `live` vừa được đặt ở trên nên luôn có; `ok_or_else` chỉ để không dùng `unwrap`.
        self.live
            .as_mut()
            .ok_or_else(|| DbError::internal("connection missing"))
    }

    /// Gửi một lệnh và chờ reply, tới khi xong hoặc request bị huỷ (thả connection, xem đầu file).
    /// Lỗi của server (reply `-ERR ...`) là `sqlError`; lỗi mạng cũng là `sqlError` và connection
    /// bị thả để lệnh sau nối lại.
    async fn send(&mut self, args: &[Vec<u8>], cancel: &CancelSignal) -> DbResult<redis::Value> {
        let live = self.ensure_connected(cancel).await?;
        let mut cmd = redis::Cmd::new();
        for arg in args {
            cmd.arg(arg.as_slice());
        }
        let sent = tokio::select! {
            // `biased`: kiểm huỷ trước, để request đã huỷ không bị coi là thành công.
            biased;
            () = cancel.cancelled() => None,
            r = live.conn.send_packed_command(&cmd) => Some(r),
        };
        match sent {
            None => {
                self.live = None;
                Err(cancelled())
            }
            Some(Ok(redis::Value::ServerError(e))) => {
                Err(DbError::new(SQL_ERROR, value::server_error_text(&e)))
            }
            Some(Ok(reply)) => Ok(reply),
            Some(Err(e)) => {
                // Lỗi của server (khi crate gộp lỗi vào `Err`) thì connection còn dùng được.
                if !matches!(e.kind(), ErrorKind::Server(_)) {
                    self.live = None;
                }
                Err(DbError::new(SQL_ERROR, super::error_text(&e)))
            }
        }
    }
}

/// Lỗi cho `method` chỉ SQLite hỗ trợ (cây đối tượng, thông tin table).
fn unsupported() -> DbError {
    DbError::new(INVALID_REQUEST, "method not supported by driver")
}

/// Cursor đang mở của lệnh cuối: phần reply chưa đưa vào trang nào.
struct Held {
    id: u64,
    reply: Reply,
}

impl Held {
    /// Lấy dòng từ reply cho tới khi trang đầy hoặc hết dòng.
    fn fill(&mut self, builder: &mut PageBuilder) {
        fill(&mut self.reply, builder);
    }
}

/// Chuyển dòng của `reply` vào `builder` cho tới khi trang đầy (đủ `pageSize` hoặc `maxPageBytes`)
/// hoặc hết dòng.
fn fill(reply: &mut Reply, builder: &mut PageBuilder) {
    while !builder.is_full() {
        #[cfg(feature = "bench-timing")]
        let started = Instant::now();
        let Some(row) = reply.next_row() else { break };
        #[cfg(feature = "bench-timing")]
        builder.add_convert(started.elapsed());
        builder.push(row);
    }
}

impl Cursor for Held {
    fn id(&self) -> u64 {
        self.id
    }

    /// Đọc trang kế từ reply đã có trong RAM; không chờ mạng nên không cần kiểm huỷ.
    async fn next_page(&mut self, limits: Limits, _cancel: &CancelSignal) -> DbResult<Page> {
        let mut builder = PageBuilder::new(limits);
        self.fill(&mut builder);
        Ok(builder.finish(self.reply.is_done()))
    }
}

/// Vòng lặp của actor: nhận từng `Cmd` rồi chạy tới khi gặp `Close` hoặc kênh đóng.
/// Nhận `session` và `rx` theo giá trị (move): actor là chủ sở hữu duy nhất của chúng.
pub async fn run(id: u64, mut session: Session, mut rx: mpsc::Receiver<Cmd>) {
    // Tên bắt đầu bằng `_` vẫn giữ giá trị sống tới hết hàm để `Drop` chạy (gỡ conn khỏi registry)
    // kể cả khi hàm kết thúc bất thường.
    let _guard = RegistryGuard(id);
    let mut next_cursor = 0u64;
    // Lệnh đã lấy khỏi kênh trong `hold` nhưng chưa xử lý; xử lý ở vòng lặp kế tiếp.
    let mut pending: Option<Cmd> = None;
    loop {
        let cmd = match pending.take() {
            Some(cmd) => cmd,
            None => match rx.recv().await {
                Some(cmd) => cmd,
                None => break,
            },
        };
        let reg = registry::global();
        let cmd = match cmd {
            Cmd::Close(done) => {
                reg.remove_conn(id, false);
                // Thả connection (đóng TCP) rồi mới báo xong.
                drop(session);
                let _ = done.send(());
                return;
            }
            other => other,
        };
        // Đánh dấu đang chạy rồi mới kiểm cờ huỷ (cùng lý do với `sqlite::actor`): hoặc ta thấy
        // cờ và không chạy, hoặc `cancel` thấy `running` và gọi interrupt đúng request này.
        if let Some((request_id, cancel)) = cmd.request() {
            reg.set_running(id, request_id);
            if cancel.is_cancelled() {
                reg.set_running(id, 0);
                cmd.reject_cancelled();
                continue;
            }
        }
        match cmd {
            Cmd::Close(_) => {}
            Cmd::Execute(job) => {
                next_cursor += 1;
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                let Executed { res, held } = execute(
                    &mut session,
                    &job.params.sql,
                    limits,
                    &job.cancel,
                    next_cursor,
                )
                .await;
                // Gỡ `running` TRƯỚC khi trả lời: từ đây `cancel` không còn tác dụng.
                reg.set_running(id, 0);
                // Cờ huỷ bật đúng lúc request vừa xong: bỏ cursor và báo `cancelled`.
                let (res, held) = if held.is_some() && job.cancel.is_cancelled() {
                    (Err(cancelled()), None)
                } else {
                    (res, held)
                };
                let _ = job
                    .reply
                    .send(res.map(|statements| ExecuteResult { statements }));
                if let Some(held) = held {
                    // `hold` giữ cursor tới khi hết dòng hoặc có lệnh khác tới (trả về qua
                    // `pending`).
                    pending = hold(id, held, &mut rx).await;
                }
            }
            Cmd::Fetch(job) => {
                // Cursor còn mở được xử lý trong `hold`; tới đây nghĩa là không có.
                let _ = job.reply.send(Err(cursor_not_found()));
                reg.set_running(id, 0);
            }
            Cmd::TableRows(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
            Cmd::SchemaTree(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
            Cmd::TableInfo(job) => {
                let _ = job.reply.send(Err(unsupported()));
                reg.set_running(id, 0);
            }
        }
    }
    // Kênh đóng mà không có lệnh Close (registry bị gỡ): `session` bị thả ở cuối hàm.
}

/// Kết quả của `execute`.
struct Executed {
    /// Kết quả từng lệnh. Lỗi cấp request (`Err`) chỉ dành cho huỷ.
    res: DbResult<Vec<StatementResult>>,
    /// Cursor của lệnh cuối còn dòng để actor giữ.
    held: Option<Held>,
}

/// Chạy lần lượt các lệnh trong `sql`, dừng ở lệnh lỗi đầu tiên (lỗi từng lệnh nằm trong
/// `StatementResult.error`, không làm hỏng cả request). Lỗi cú pháp ở dòng thứ k thì k-1 lệnh
/// trước vẫn chạy.
async fn execute(
    session: &mut Session,
    sql: &str,
    limits: Limits,
    cancel: &CancelSignal,
    cursor_id: u64,
) -> Executed {
    let parsed = command::parse(sql);
    let count = parsed.commands.len();
    let mut out: Vec<StatementResult> = Vec::with_capacity(count + 1);
    for (index, cmd) in parsed.commands.into_iter().enumerate() {
        // Chỉ lệnh cuối (không có lỗi cú pháp theo sau) được giữ cursor.
        let keep = index + 1 == count && parsed.error.is_none();
        let start = Instant::now();
        let cursor = keep.then_some(cursor_id);
        match statement(session, cmd, index, limits, cancel, cursor, start).await {
            Ok((result, reply)) => {
                out.push(result);
                if let Some(reply) = reply {
                    return Executed {
                        res: Ok(out),
                        held: Some(Held {
                            id: cursor_id,
                            reply,
                        }),
                    };
                }
            }
            Err((e, text)) => {
                if e.code == CANCELLED {
                    return Executed {
                        res: Err(e),
                        held: None,
                    };
                }
                out.push(statement_error(index, &text, start, e.message));
                return Executed {
                    res: Ok(out),
                    held: None,
                };
            }
        }
    }
    if let Some(e) = parsed.error {
        out.push(statement_error(count, &e.text, Instant::now(), e.message));
    }
    Executed {
        res: Ok(out),
        held: None,
    }
}

/// Chạy một lệnh. `cursor` là id cursor nếu lệnh được giữ cursor (lệnh cuối). `Ok` mang
/// `StatementResult` (trang đầu) và phần reply còn dòng (chỉ khi `cursor` là `Some` và reply chưa
/// hết); `Err` mang lỗi kèm nội dung lệnh để dựng câu lỗi.
async fn statement(
    session: &mut Session,
    cmd: Command,
    index: usize,
    limits: Limits,
    cancel: &CancelSignal,
    cursor: Option<u64>,
    start: Instant,
) -> Result<(StatementResult, Option<Reply>), (DbError, String)> {
    let selected = cmd.selected_db();
    let Command { text, args } = cmd;
    let mut builder = PageBuilder::new(limits);
    #[cfg(feature = "bench-timing")]
    let waited = Instant::now();
    let value = session
        .send(&args, cancel)
        .await
        .map_err(|e| (e, text.clone()))?;
    #[cfg(feature = "bench-timing")]
    builder.add_read(waited.elapsed());
    let first_row_ms = elapsed_ms(start);

    // `SELECT n` thành công: nhớ DB để nối lại đúng chỗ.
    if let (Some(db), redis::Value::Okay) = (selected, &value) {
        session.target.db = db;
    }

    let mut reply = Reply::new(value);
    fill(&mut reply, &mut builder);
    let done = reply.is_done();
    let columns = std::mem::take(&mut reply.columns);
    // Còn dòng và được giữ cursor thì `rows_statement` ghi `cursorId`; không giữ thì ghi `truncated`.
    let cursor = cursor.filter(|_| !done);
    let mut result = rows_statement(index, text, columns, builder.finish(done), cursor, start);
    result.first_row_ms = Some(first_row_ms);
    Ok((result, cursor.map(|_| reply)))
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/redis/actor.rs"]
mod tests;
