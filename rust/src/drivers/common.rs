//! Phần dùng chung của mọi driver: giới hạn và trang kết quả, hàm dựng `StatementResult`,
//! cursor (`Cursor` + `hold`), lỗi thường gặp và `hex`.
//!
//! Vị trí trong luồng: actor của mọi driver gọi các
//! hàm ở đây để đọc một trang, dựng kết quả từng câu và giữ cursor giữa các lệnh `fetch`.
//! Tách riêng để mọi driver có cùng quy tắc trang (≥ 1 dòng, dừng ở `pageSize`/`maxPageBytes`)
//! và cùng cách xử lý `fetch`/huỷ.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `trait` giống `interface` của Go: `Cursor` là hợp đồng "một cursor đọc được từng trang".
//! - Generic `hold<C: Cursor>`: một hàm dùng cho mọi kiểu `C` thoả hợp đồng; compiler sinh sẵn
//!   bản riêng cho từng kiểu nên không tốn lời gọi gián tiếp (khác interface động của Go).
//! - `#[cfg(feature = "...")]`: đoạn code chỉ được biên dịch khi bật feature, bản phát hành
//!   không chứa nó.

use crate::drivers::Cmd;
use crate::protocol::{
    CANCELLED, CURSOR_NOT_FOUND, Column, DbError, DbResult, FetchResult, SQL_ERROR, StatementResult,
};
use crate::registry::{self, CancelSignal};
use std::future::Future;
use std::time::Instant;
use tokio::sync::mpsc;

/// Giới hạn một trang kết quả.
#[derive(Clone, Copy)]
pub struct Limits {
    /// Số dòng tối đa.
    pub page_size: usize,
    /// Ngưỡng tổng byte chuỗi; vượt thì dừng trang sớm.
    pub max_bytes: usize,
}

impl Limits {
    /// Chuẩn hoá giới hạn: ít nhất 1 dòng mỗi trang (tránh vòng lặp không tiến triển khi `pageSize = 0`).
    pub fn new(page_size: usize, max_bytes: usize) -> Self {
        Self {
            page_size: page_size.max(1),
            max_bytes,
        }
    }
}

/// Một trang dòng đã đọc; `done` là stream đã hết. Mỗi ô là chuỗi, `None` = NULL.
pub struct Page {
    pub rows: Vec<Vec<Option<String>>>,
    pub done: bool,
    /// Thời gian từng pha, chỉ có khi bật `bench-timing`.
    #[cfg(feature = "bench-timing")]
    pub phases: Phases,
}

/// Tổng thời gian đọc dòng và đổi/dựng trang của một trang (chỉ để đo, xem `PageBuilder`).
#[cfg(feature = "bench-timing")]
#[derive(Clone, Copy, Default)]
pub struct Phases {
    /// Tổng thời gian chờ driver trả dòng kế tiếp. Với SQLite gồm cả đổi ô sang chuỗi vì
    /// `step` và đọc ô nằm chung một hàm C.
    pub read: std::time::Duration,
    /// Tổng thời gian dựng trang (cộng byte, đẩy dòng).
    pub convert: std::time::Duration,
}

/// Gom dòng thành một `Page` theo giới hạn: dừng khi đủ `page_size` dòng hoặc tổng byte chuỗi
/// chạm `max_bytes`, nhưng luôn lấy ít nhất một dòng (dù dòng đó vượt `max_bytes`) để `fetch`
/// luôn tiến triển. NULL không tính byte.
pub struct PageBuilder {
    rows: Vec<Vec<Option<String>>>,
    bytes: usize,
    limits: Limits,
    #[cfg(feature = "bench-timing")]
    phases: Phases,
}

impl PageBuilder {
    /// Trang rỗng. Cấp sẵn chỗ nhưng tối đa 1024 để `pageSize` lớn không chiếm RAM trước khi có dữ liệu.
    pub fn new(limits: Limits) -> Self {
        Self {
            rows: Vec::with_capacity(limits.page_size.min(1024)),
            bytes: 0,
            limits,
            #[cfg(feature = "bench-timing")]
            phases: Phases::default(),
        }
    }

    /// Đã đủ dòng hoặc đủ byte chưa (luôn `false` khi chưa có dòng nào).
    #[inline]
    pub fn is_full(&self) -> bool {
        self.rows.len() >= self.limits.page_size
            || (!self.rows.is_empty() && self.bytes >= self.limits.max_bytes)
    }

    /// Thêm một dòng và cộng byte của các ô khác NULL.
    #[inline]
    pub fn push(&mut self, row: Vec<Option<String>>) {
        #[cfg(feature = "bench-timing")]
        let start = Instant::now();
        self.bytes += row.iter().flatten().map(String::len).sum::<usize>();
        self.rows.push(row);
        #[cfg(feature = "bench-timing")]
        {
            self.phases.convert += start.elapsed();
        }
    }

    /// Chạy `f` (lấy một dòng từ driver). Khi bật `bench-timing` thì cộng thời gian vào pha
    /// đọc; bản phát hành chỉ gọi `f`, không có thêm `Instant::now()`.
    #[inline]
    pub fn read<T>(&mut self, f: impl FnOnce() -> T) -> T {
        #[cfg(feature = "bench-timing")]
        {
            let start = Instant::now();
            let out = f();
            self.phases.read += start.elapsed();
            out
        }
        #[cfg(not(feature = "bench-timing"))]
        f()
    }

    /// Cộng thời gian chờ driver mạng trả dòng (đã `await` nên không bọc được bằng `read`).
    #[cfg(feature = "bench-timing")]
    pub fn add_read(&mut self, elapsed: std::time::Duration) {
        self.phases.read += elapsed;
    }

    /// Cộng thời gian giải mã dòng sang chuỗi của driver mạng.
    #[cfg(feature = "bench-timing")]
    pub fn add_convert(&mut self, elapsed: std::time::Duration) {
        self.phases.convert += elapsed;
    }

    /// Chốt trang; `done` là driver đã hết dòng.
    pub fn finish(self, done: bool) -> Page {
        Page {
            rows: self.rows,
            done,
            #[cfg(feature = "bench-timing")]
            phases: self.phases,
        }
    }
}

/// Gỡ connection khỏi registry khi actor kết thúc (kể cả panic), trước khi connection bị drop,
/// để `s3b_cancel` không bao giờ ngắt connection đã đóng.
pub struct RegistryGuard(pub u64);

/// `Drop` chạy tự động khi giá trị bị huỷ, giống `defer` của Go.
impl Drop for RegistryGuard {
    fn drop(&mut self) {
        registry::global().remove_conn(self.0, false);
    }
}

/// Mili giây từ `start`; `try_from` đổi `u128` sang `u64`, tràn thì lấy giá trị lớn nhất thay vì panic.
pub fn elapsed_ms(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Mili giây từ `start` tới `at` (`at` trước `start` thì 0), tràn thì lấy giá trị lớn nhất.
pub fn millis_between(start: Instant, at: Instant) -> u64 {
    u64::try_from(at.saturating_duration_since(start).as_millis()).unwrap_or(u64::MAX)
}

/// Lỗi `cancelled`: request bị huỷ qua `s3b_cancel`.
pub fn cancelled() -> DbError {
    DbError::new(CANCELLED, "request cancelled")
}

/// Lỗi `cursorNotFound`: cursor đã hết, đã bị bỏ hoặc id sai.
pub fn cursor_not_found() -> DbError {
    DbError::new(CURSOR_NOT_FOUND, "cursor is closed")
}

/// Dựng `StatementResult` cho câu lỗi (kết quả của riêng câu, không làm hỏng cả request).
pub fn statement_error(
    index: usize,
    sql: &str,
    start: Instant,
    message: String,
) -> StatementResult {
    StatementResult {
        index,
        sql: sql.to_owned(),
        kind: "affected",
        columns: None,
        rows: None,
        cursor_id: None,
        done: None,
        truncated: None,
        rows_affected: None,
        elapsed_ms: elapsed_ms(start),
        first_row_ms: None,
        #[cfg(feature = "bench-timing")]
        read_ms: None,
        #[cfg(feature = "bench-timing")]
        convert_ms: None,
        error: Some(DbError::new(SQL_ERROR, message)),
    }
}

/// Dựng `StatementResult` loại `affected` cho câu không trả dòng (INSERT/UPDATE/DDL...).
pub fn affected_statement(
    index: usize,
    sql: String,
    rows_affected: i64,
    start: Instant,
) -> StatementResult {
    StatementResult {
        index,
        sql,
        kind: "affected",
        columns: None,
        rows: None,
        cursor_id: None,
        done: None,
        truncated: None,
        rows_affected: Some(rows_affected),
        elapsed_ms: elapsed_ms(start),
        first_row_ms: None,
        #[cfg(feature = "bench-timing")]
        read_ms: None,
        #[cfg(feature = "bench-timing")]
        convert_ms: None,
        error: None,
    }
}

/// Dựng `StatementResult` loại `rows` từ một trang. `cursor_id` có nghĩa là actor sẽ giữ cursor.
pub fn rows_statement(
    index: usize,
    sql: String,
    columns: Vec<Column>,
    page: Page,
    cursor_id: Option<u64>,
    start: Instant,
) -> StatementResult {
    StatementResult {
        index,
        sql,
        kind: "rows",
        columns: Some(columns),
        #[cfg(feature = "bench-timing")]
        read_ms: Some(u64::try_from(page.phases.read.as_millis()).unwrap_or(u64::MAX)),
        #[cfg(feature = "bench-timing")]
        convert_ms: Some(u64::try_from(page.phases.convert.as_millis()).unwrap_or(u64::MAX)),
        rows: Some(page.rows),
        cursor_id,
        done: Some(page.done),
        // Còn dòng nhưng không giữ cursor (câu không phải cuối): Result bị cắt.
        truncated: (!page.done && cursor_id.is_none()).then_some(true),
        rows_affected: None,
        elapsed_ms: elapsed_ms(start),
        first_row_ms: None,
        error: None,
    }
}

/// BLOB -> chuỗi hex, ví dụ `[0x0a, 0xff]` -> `0x0aff`.
/// Một lần cấp phát đúng cỡ: `0x` + 2 ký tự mỗi byte (tránh `format!` cho mỗi byte, BLOB có thể lớn).
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2 + 2);
    s.push_str("0x");
    for &b in bytes {
        s.push(DIGITS[usize::from(b >> 4)] as char);
        s.push(DIGITS[usize::from(b & 0x0f)] as char);
    }
    s
}

/// Cursor đang mở của một driver: đọc dần từng trang, không nạp cả kết quả vào RAM.
///
/// `Send` để actor (một task tokio có thể chạy trên thread khác sau mỗi `.await`) giữ được
/// cursor; `Sized` để `abandon` nhận `self` theo giá trị. Hai hàm trả `impl Future + Send`
/// (thay cho `async fn` trong trait) để chắc chắn future của chúng gửi được giữa các thread.
pub trait Cursor: Send + Sized {
    /// Id cursor (`cursorId` mà `fetch` gửi tới).
    fn id(&self) -> u64;

    /// Đọc trang kế tiếp. Trả `cancelled` khi `cancel` được phát; lỗi khác thì cursor không
    /// đọc tiếp được nữa.
    fn next_page(
        &mut self,
        limits: Limits,
        cancel: &CancelSignal,
    ) -> impl Future<Output = DbResult<Page>> + Send;

    /// Bỏ cursor còn dòng (có lệnh khác tới, lỗi, kênh đóng). Mặc định chỉ drop nó (SQLite:
    /// finalize câu); driver mạng ghi đè để huỷ phía server và đọc bỏ phần còn lại.
    fn abandon(self) -> impl Future<Output = ()> + Send {
        async move { drop(self) }
    }
}

/// Giữ cursor và phục vụ `fetch` cho tới khi hết dòng; lệnh khác tới thì bỏ cursor và trả lệnh đó.
/// `None` nghĩa là không còn lệnh nào chờ xử lý (cursor đã xong, bị lỗi/huỷ hoặc kênh đóng).
pub async fn hold<C: Cursor>(
    conn_id: u64,
    mut cursor: C,
    rx: &mut mpsc::Receiver<Cmd>,
) -> Option<Cmd> {
    let reg = registry::global();
    loop {
        // Kênh đóng (`None`): bỏ cursor rồi thoát.
        let Some(cmd) = rx.recv().await else {
            cursor.abandon().await;
            return None;
        };
        match cmd {
            // `if` sau mẫu là match guard: chỉ khớp khi `cursorId` đúng cursor đang giữ.
            Cmd::Fetch(job) if job.params.cursor_id == cursor.id() => {
                let limits = Limits::new(job.params.page_size, job.params.max_page_bytes);
                reg.set_running(conn_id, job.id);
                let page = cursor.next_page(limits, &job.cancel).await;
                reg.set_running(conn_id, 0);
                match page {
                    Ok(page) => {
                        let done = page.done;
                        // `running` đã về 0: tín hiệu huỷ bật lúc này nghĩa là cursor còn lại có
                        // thể mang cờ interrupt treo, nên bỏ cursor và trả `cancelled`.
                        if !done && job.cancel.is_cancelled() {
                            let _ = job.reply.send(Err(cancelled()));
                            cursor.abandon().await;
                            return None;
                        }
                        let _ = job.reply.send(Ok(FetchResult {
                            rows: page.rows,
                            done,
                        }));
                        if done {
                            cursor.abandon().await;
                            return None;
                        }
                    }
                    Err(e) => {
                        // Câu lỗi hoặc bị huỷ thì không đọc tiếp được.
                        let _ = job.reply.send(Err(e));
                        cursor.abandon().await;
                        return None;
                    }
                }
            }
            Cmd::Fetch(job) => {
                let _ = job.reply.send(Err(cursor_not_found()));
            }
            // Đóng connection: thả cursor luôn, không `abandon` (có thể phải đọc bỏ/huỷ phía server
            // mà cursor không huỷ được, làm lệnh đóng treo). Connection sắp bị đóng nên không cần dọn.
            close @ Cmd::Close(_) => {
                drop(cursor);
                return Some(close);
            }
            other => {
                cursor.abandon().await;
                return Some(other);
            }
        }
    }
}

/// Từ đầu tiên của câu (chữ cái, không phân biệt hoa thường) và từ thứ hai.
pub fn first_words(sql: &str) -> (&str, &str) {
    let mut words = sql
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|w| !w.is_empty());
    (words.next().unwrap_or(""), words.next().unwrap_or(""))
}

/// Huỷ phía server một câu còn dòng có an toàn không: chỉ câu đọc thuần (`SELECT`, `VALUES`,
/// `TABLE`, `SHOW`, và `WITH` không chứa `INSERT`/`UPDATE`/`DELETE`/`MERGE`). Câu ghi dữ liệu
/// (`INSERT ... RETURNING`) mà bị huỷ giữa chừng sẽ rollback cả câu, nên chỉ đọc bỏ.
/// Câu bắt đầu bằng dấu `(` hoặc từ khác thì coi là không an toàn.
/// Giới hạn đã biết: `SELECT` gọi hàm có tác dụng phụ vẫn bị huỷ.
pub fn is_cancel_safe(sql: &str) -> bool {
    if !sql.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return false;
    }
    let (first, _) = first_words(sql);
    let is = |kw: &str| first.eq_ignore_ascii_case(kw);
    if is("select") || is("values") || is("table") || is("show") {
        return true;
    }
    is("with") && !contains_word(sql, &["insert", "update", "delete", "merge"])
}

/// Có từ nào của `sql` (tách theo ký tự không phải chữ/số/`_`, không phân biệt hoa thường) nằm
/// trong `words` không. Quét thô, không bỏ qua chuỗi/comment: nhận nhầm chỉ làm kết luận thận
/// trọng hơn (coi là có ghi), không bao giờ bỏ sót.
fn contains_word(sql: &str, kws: &[&str]) -> bool {
    words(sql).any(|w| kws.iter().any(|kw| w.eq_ignore_ascii_case(kw)))
}

/// Tách batch thành các từ (chữ/số/`_`), bỏ từ rỗng. Quét thô, không bỏ qua chuỗi hay comment:
/// dùng chung cho các phép kiểm "có từ khoá X không" để chúng cùng một ngữ nghĩa.
pub(crate) fn words(sql: &str) -> impl Iterator<Item = &str> + Clone {
    sql.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty())
}

/// Batch có thể ghi dữ liệu/đổi schema không (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `EXEC`,
/// `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `SELECT ... INTO`, và các lệnh đổi quyền/trạng thái
/// server như `GRANT`, `BACKUP`, `RESTORE`, `DBCC`, `KILL`, `RECONFIGURE`, `CHECKPOINT`).
/// Batch SQL Server gồm nhiều câu
/// (`SELECT ...; UPDATE ...`) nên `is_cancel_safe` chỉ xét từ đầu là chưa đủ.
pub fn has_write_keyword(sql: &str) -> bool {
    contains_word(
        sql,
        &[
            "insert",
            "update",
            "delete",
            "merge",
            "exec",
            "execute",
            "create",
            "alter",
            "drop",
            "truncate",
            "into",
            "grant",
            "revoke",
            "deny",
            "backup",
            "restore",
            "dbcc",
            "kill",
            "enable",
            "disable",
            "receive",
            "send",
            "reconfigure",
            "checkpoint",
            "bulk",
            "writetext",
            "updatetext",
        ],
    )
}

/// Theo dõi người dùng có đang trong transaction tự mở không (xem `Session::in_tx`).
pub fn track_tx(in_tx: &mut bool, sql: &str) {
    let mut words = sql
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|w| !w.is_empty());
    let first = words.next().unwrap_or("");
    let is = |kw: &str| first.eq_ignore_ascii_case(kw);
    if is("begin") || is("start") {
        // `BEGIN TRY`/`BEGIN CATCH` (T-SQL) và `BEGIN NOT ATOMIC` (MariaDB) mở khối lệnh, không mở giao dịch.
        let second = words.next().unwrap_or("");
        let block = ["try", "catch", "not", "atomic"]
            .iter()
            .any(|kw| second.eq_ignore_ascii_case(kw));
        if !block {
            *in_tx = true;
        }
    } else if is("commit") || is("end") || is("rollback") || is("abort") {
        // `WORK`/`TRANSACTION` là từ thừa: `ROLLBACK WORK TO SAVEPOINT s` vẫn là rollback về savepoint.
        let mut rest = words.skip_while(|w| {
            w.eq_ignore_ascii_case("work") || w.eq_ignore_ascii_case("transaction")
        });
        let next = rest.next().unwrap_or("");
        let after = rest.next().unwrap_or("");
        // `... TO SAVEPOINT` và `COMMIT/ROLLBACK PREPARED` không kết thúc transaction hiện tại;
        // `... AND CHAIN` kết thúc rồi mở ngay transaction mới nên vẫn đang trong transaction
        // (`AND NO CHAIN` là mặc định, kết thúc bình thường).
        let keeps_tx = next.eq_ignore_ascii_case("to")
            || next.eq_ignore_ascii_case("prepared")
            || (next.eq_ignore_ascii_case("and") && after.eq_ignore_ascii_case("chain"));
        if !keeps_tx {
            *in_tx = false;
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/drivers/common.rs"]
mod tests;
