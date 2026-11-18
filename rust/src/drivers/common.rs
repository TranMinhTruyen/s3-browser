//! Phần dùng chung của mọi driver: giới hạn và trang kết quả, hàm dựng `StatementResult`,
//! cursor (`Cursor` + `hold`), lỗi thường gặp và `hex`.
//!
//! Vị trí trong luồng: actor của từng driver (`sqlite::actor`, sau này `postgres`...) gọi các
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
            other => {
                cursor.abandon().await;
                return Some(other);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::Job;
    use crate::protocol::FetchParams;
    use crate::registry::Interrupt;
    use serde_json::{Value, json};
    use std::collections::VecDeque;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    fn row(cells: &[Option<&str>]) -> Vec<Option<String>> {
        cells.iter().map(|c| c.map(str::to_owned)).collect()
    }

    // ---- Limits ----

    #[test]
    fn limits_clamp_page_size_to_at_least_one() {
        assert_eq!(Limits::new(0, 10).page_size, 1);
        assert_eq!(Limits::new(5, 10).page_size, 5);
        assert_eq!(Limits::new(5, 10).max_bytes, 10);
        assert_eq!(Limits::new(0, 0).max_bytes, 0);
    }

    // ---- PageBuilder ----

    #[test]
    fn page_builder_stops_at_page_size() {
        let mut b = PageBuilder::new(Limits::new(3, usize::MAX));
        let mut pushed = 0;
        while !b.is_full() {
            b.push(row(&[Some("a")]));
            pushed += 1;
        }
        assert_eq!(pushed, 3);
        let page = b.finish(false);
        assert_eq!(page.rows.len(), 3);
        assert!(!page.done);
    }

    #[test]
    fn page_builder_stops_at_max_bytes_after_crossing_it() {
        // Mỗi dòng 4 byte; ngưỡng 10 byte: dừng sau dòng thứ 3 (12 byte >= 10).
        let mut b = PageBuilder::new(Limits::new(100, 10));
        let mut pushed = 0;
        while !b.is_full() {
            b.push(row(&[Some("abcd")]));
            pushed += 1;
        }
        assert_eq!(pushed, 3);
        assert!(b.finish(true).done);
    }

    #[test]
    fn page_builder_stops_exactly_when_bytes_reach_the_limit() {
        let mut b = PageBuilder::new(Limits::new(100, 8));
        b.push(row(&[Some("abcd")]));
        assert!(!b.is_full());
        b.push(row(&[Some("abcd")]));
        assert!(b.is_full());
    }

    #[test]
    fn page_builder_always_takes_at_least_one_row() {
        // Chưa có dòng nào thì không bao giờ đầy, dù `max_bytes = 0`.
        let mut b = PageBuilder::new(Limits::new(10, 0));
        assert!(!b.is_full());
        // Dòng đầu vượt xa ngưỡng vẫn được nhận, rồi trang đầy.
        b.push(row(&[Some("a very long cell value")]));
        assert!(b.is_full());
        assert_eq!(b.finish(false).rows.len(), 1);
    }

    #[test]
    fn page_builder_page_size_zero_means_one() {
        let mut b = PageBuilder::new(Limits::new(0, usize::MAX));
        assert!(!b.is_full());
        b.push(row(&[None]));
        assert!(b.is_full());
    }

    #[test]
    fn page_builder_null_cells_do_not_count_bytes() {
        let mut b = PageBuilder::new(Limits::new(100, 1));
        // Dòng toàn NULL: 0 byte nên không bao giờ chạm ngưỡng 1 byte.
        for _ in 0..50 {
            b.push(row(&[None, None, None]));
            assert!(!b.is_full());
        }
        // Một ô 1 byte chạm ngưỡng ngay.
        b.push(row(&[None, Some("x")]));
        assert!(b.is_full());
    }

    #[test]
    fn page_builder_counts_utf8_bytes_not_chars() {
        // "é" là 2 byte: hai ô = 4 byte >= 4.
        let mut b = PageBuilder::new(Limits::new(100, 4));
        b.push(row(&[Some("é"), Some("é")]));
        assert!(b.is_full());
        let mut b = PageBuilder::new(Limits::new(100, 5));
        b.push(row(&[Some("é"), Some("é")]));
        assert!(!b.is_full());
    }

    #[test]
    fn page_builder_huge_page_size_does_not_preallocate_it() {
        let b = PageBuilder::new(Limits::new(usize::MAX, usize::MAX));
        assert!(b.rows.capacity() <= 1024);
        assert!(!b.is_full());
    }

    #[test]
    fn page_builder_keeps_row_order_and_empty_page_is_valid() {
        let mut b = PageBuilder::new(Limits::new(10, 100));
        b.push(row(&[Some("1")]));
        b.push(row(&[None]));
        b.push(row(&[Some("3")]));
        let page = b.finish(true);
        assert_eq!(
            page.rows,
            vec![row(&[Some("1")]), row(&[None]), row(&[Some("3")])]
        );
        let empty = PageBuilder::new(Limits::new(10, 100)).finish(true);
        assert!(empty.rows.is_empty() && empty.done);
    }

    #[test]
    fn page_builder_read_returns_closure_value() {
        let mut b = PageBuilder::new(Limits::new(1, 1));
        assert_eq!(b.read(|| 41 + 1), 42);
    }

    // ---- helper nhỏ ----

    #[test]
    fn hex_formats_bytes() {
        assert_eq!(hex(&[]), "0x");
        assert_eq!(hex(&[0x0a, 0xff]), "0x0aff");
        assert_eq!(hex(&[0x00, 0x01, 0xab, 0xcd]), "0x0001abcd");
        let all: Vec<u8> = (0..=255).collect();
        let h = hex(&all);
        assert_eq!(h.len(), 2 + 512);
        assert!(h.starts_with("0x000102"));
        assert!(h.ends_with("fdfeff"));
    }

    #[test]
    fn standard_errors_have_stable_codes() {
        assert_eq!(cancelled().code, CANCELLED);
        assert_eq!(cursor_not_found().code, CURSOR_NOT_FOUND);
    }

    #[test]
    fn elapsed_ms_is_small_for_now_and_does_not_panic() {
        assert!(elapsed_ms(Instant::now()) < 1000);
    }

    #[test]
    fn registry_guard_removes_connection_on_drop_without_interrupting() {
        struct Never;
        impl Interrupt for Never {
            fn interrupt(&self) {
                panic!("không được ngắt khi guard drop");
            }
        }
        let reg = registry::global();
        let id = reg.next_conn_id();
        let (tx, _rx) = mpsc::channel(1);
        reg.add_conn(id, "test", tx, Arc::new(Never));
        let guard = RegistryGuard(id);
        assert!(reg.conn_tx(id).is_some());
        drop(guard);
        assert!(reg.conn_tx(id).is_none());
        // Gỡ hai lần (guard rồi `close`) vô hại.
        assert!(reg.remove_conn(id, false).is_none());
    }

    // ---- StatementResult ----

    fn json_of(s: &StatementResult) -> Value {
        serde_json::to_value(s).unwrap()
    }

    fn column(name: &str) -> Column {
        Column {
            name: name.to_owned(),
            ty: "TEXT".to_owned(),
        }
    }

    fn page(rows: Vec<Vec<Option<String>>>, done: bool) -> Page {
        let mut b = PageBuilder::new(Limits::new(usize::MAX, usize::MAX));
        for r in rows {
            b.push(r);
        }
        b.finish(done)
    }

    #[test]
    fn statement_error_shape() {
        let v = json_of(&statement_error(
            2,
            "SELEC 1",
            Instant::now(),
            "boom".into(),
        ));
        assert_eq!(v["index"], 2);
        assert_eq!(v["sql"], "SELEC 1");
        assert_eq!(v["kind"], "affected");
        assert_eq!(v["error"]["code"], SQL_ERROR);
        assert_eq!(v["error"]["message"], "boom");
        for absent in [
            "columns",
            "rows",
            "cursorId",
            "done",
            "truncated",
            "rowsAffected",
            "firstRowMs",
        ] {
            assert!(v.get(absent).is_none(), "{absent}");
        }
        assert!(v["elapsedMs"].is_u64());
    }

    #[test]
    fn affected_statement_shape() {
        let v = json_of(&affected_statement(0, "UPDATE t".into(), 7, Instant::now()));
        assert_eq!(v["kind"], "affected");
        assert_eq!(v["rowsAffected"], 7);
        assert!(v.get("error").is_none());
        assert!(v.get("rows").is_none() && v.get("columns").is_none());
        assert!(v.get("firstRowMs").is_none());
        // Số âm và 0 vẫn được ghi.
        assert_eq!(
            json_of(&affected_statement(0, "x".into(), 0, Instant::now()))["rowsAffected"],
            0
        );
    }

    #[test]
    fn rows_statement_done_without_cursor() {
        let p = page(vec![row(&[Some("a"), None])], true);
        let v = json_of(&rows_statement(
            1,
            "SELECT".into(),
            vec![column("c1"), column("c2")],
            p,
            None,
            Instant::now(),
        ));
        assert_eq!(v["kind"], "rows");
        assert_eq!(v["index"], 1);
        assert_eq!(v["rows"], json!([["a", null]]));
        assert_eq!(
            v["columns"],
            json!([{"name":"c1","type":"TEXT"},{"name":"c2","type":"TEXT"}])
        );
        assert_eq!(v["done"], true);
        assert!(v.get("cursorId").is_none());
        assert!(v.get("truncated").is_none());
        assert!(v.get("error").is_none());
        // `firstRowMs` do driver mạng điền sau; SQLite và hàm chung không phát.
        assert!(v.get("firstRowMs").is_none());
    }

    #[test]
    fn rows_statement_with_cursor_is_not_truncated() {
        let p = page(vec![row(&[Some("a")])], false);
        let v = json_of(&rows_statement(
            0,
            "S".into(),
            vec![column("c")],
            p,
            Some(9),
            Instant::now(),
        ));
        assert_eq!(v["done"], false);
        assert_eq!(v["cursorId"], 9);
        assert!(v.get("truncated").is_none());
    }

    #[test]
    fn rows_statement_not_done_without_cursor_is_truncated() {
        let p = page(vec![row(&[Some("a")])], false);
        let v = json_of(&rows_statement(
            0,
            "S".into(),
            vec![column("c")],
            p,
            None,
            Instant::now(),
        ));
        assert_eq!(v["done"], false);
        assert_eq!(v["truncated"], true);
        assert!(v.get("cursorId").is_none());
    }

    #[test]
    fn first_row_ms_is_serialized_in_camel_case_when_set() {
        let mut s = affected_statement(0, "x".into(), 0, Instant::now());
        s.first_row_ms = Some(12);
        assert_eq!(json_of(&s)["firstRowMs"], 12);
    }

    // ---- bench-timing ----

    #[cfg(not(feature = "bench-timing"))]
    #[test]
    fn without_bench_timing_response_has_no_phase_timings() {
        let mut b = PageBuilder::new(Limits::new(10, 100));
        let cell = b.read(|| Some("x".to_owned()));
        b.push(vec![cell]);
        let p = b.finish(true);
        for v in [
            json_of(&rows_statement(
                0,
                "S".into(),
                vec![column("c")],
                p,
                None,
                Instant::now(),
            )),
            json_of(&affected_statement(0, "S".into(), 1, Instant::now())),
            json_of(&statement_error(0, "S", Instant::now(), "e".into())),
        ] {
            assert!(v.get("readMs").is_none(), "{v}");
            assert!(v.get("convertMs").is_none(), "{v}");
        }
    }

    #[cfg(feature = "bench-timing")]
    #[test]
    fn with_bench_timing_rows_response_has_read_and_convert_ms() {
        let mut b = PageBuilder::new(Limits::new(10, 100));
        let cell = b.read(|| Some("x".to_owned()));
        b.push(vec![cell]);
        let p = b.finish(true);
        let v = json_of(&rows_statement(
            0,
            "S".into(),
            vec![column("c")],
            p,
            None,
            Instant::now(),
        ));
        assert!(v["readMs"].is_u64(), "{v}");
        assert!(v["convertMs"].is_u64(), "{v}");
        // Câu không trả dòng không có pha đọc/đổi.
        for v in [
            json_of(&affected_statement(0, "S".into(), 1, Instant::now())),
            json_of(&statement_error(0, "S", Instant::now(), "e".into())),
        ] {
            assert!(
                v.get("readMs").is_none() && v.get("convertMs").is_none(),
                "{v}"
            );
        }
    }

    #[cfg(feature = "bench-timing")]
    #[test]
    fn with_bench_timing_phases_accumulate_read_and_push_time() {
        use std::time::Duration;
        // Chờ bận tới khi đồng hồ nhích đủ 3 ms (không dùng sleep).
        fn spin(ms: u64) {
            let start = Instant::now();
            while start.elapsed() < Duration::from_millis(ms) {}
        }
        let mut b = PageBuilder::new(Limits::new(10, 100));
        assert_eq!(b.read(|| 5), 5);
        b.read(|| spin(3));
        b.read(|| spin(3));
        let p = b.finish(true);
        assert!(
            p.phases.read >= Duration::from_millis(6),
            "{:?}",
            p.phases.read
        );
        assert!(p.phases.convert < p.phases.read);
        let v = json_of(&rows_statement(
            0,
            "S".into(),
            vec![column("c")],
            p,
            None,
            Instant::now(),
        ));
        assert!(v["readMs"].as_u64().unwrap() >= 6, "{v}");
    }

    // ---- hold với Cursor giả ----

    /// Cursor giả: trả lần lượt các kết quả cho trước, đếm số lần `next_page` và `abandon`.
    struct Fake {
        id: u64,
        pages: VecDeque<DbResult<Page>>,
        calls: Arc<AtomicUsize>,
        abandoned: Arc<AtomicUsize>,
        /// Đặt `cancel` của request ngay trong `next_page` (giả lập huỷ đúng lúc đọc).
        cancel_during_read: bool,
        /// Gọi `registry.cancel(id)` ngay trong `next_page` (giả lập `s3b_cancel` tới lúc đang đọc).
        registry_cancel: Option<u64>,
        seen_limits: Arc<std::sync::Mutex<Vec<(usize, usize)>>>,
    }

    struct Counters {
        calls: Arc<AtomicUsize>,
        abandoned: Arc<AtomicUsize>,
        limits: Arc<std::sync::Mutex<Vec<(usize, usize)>>>,
    }

    fn fake(id: u64, pages: Vec<DbResult<Page>>, cancel_during_read: bool) -> (Fake, Counters) {
        let calls = Arc::new(AtomicUsize::new(0));
        let abandoned = Arc::new(AtomicUsize::new(0));
        let limits = Arc::new(std::sync::Mutex::new(Vec::new()));
        let cursor = Fake {
            id,
            pages: pages.into(),
            calls: calls.clone(),
            abandoned: abandoned.clone(),
            cancel_during_read,
            registry_cancel: None,
            seen_limits: limits.clone(),
        };
        (
            cursor,
            Counters {
                calls,
                abandoned,
                limits,
            },
        )
    }

    impl Cursor for Fake {
        fn id(&self) -> u64 {
            self.id
        }

        async fn next_page(&mut self, limits: Limits, cancel: &CancelSignal) -> DbResult<Page> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.seen_limits
                .lock()
                .unwrap()
                .push((limits.page_size, limits.max_bytes));
            if self.cancel_during_read {
                cancel.cancel();
            }
            if let Some(id) = self.registry_cancel {
                registry::global().cancel(id);
            }
            self.pages
                .pop_front()
                .unwrap_or_else(|| Err(DbError::internal("no more pages")))
        }

        async fn abandon(self) {
            self.abandoned.fetch_add(1, Ordering::SeqCst);
        }
    }

    type FetchReply = oneshot::Receiver<DbResult<FetchResult>>;

    fn fetch_cmd(
        cursor_id: u64,
        page_size: usize,
        max_bytes: usize,
    ) -> (Cmd, FetchReply, Arc<CancelSignal>) {
        fetch_cmd_with(
            Arc::new(CancelSignal::new()),
            cursor_id,
            page_size,
            max_bytes,
        )
    }

    fn fetch_cmd_with(
        cancel: Arc<CancelSignal>,
        cursor_id: u64,
        page_size: usize,
        max_bytes: usize,
    ) -> (Cmd, FetchReply, Arc<CancelSignal>) {
        let (reply, rx) = oneshot::channel();
        let cmd = Cmd::Fetch(Job {
            id: 1,
            params: FetchParams {
                conn_id: 1,
                cursor_id,
                page_size,
                max_page_bytes: max_bytes,
            },
            cancel: cancel.clone(),
            reply,
        });
        (cmd, rx, cancel)
    }

    fn ok_rows(mut rx: FetchReply) -> (Vec<Vec<Option<String>>>, bool) {
        let r = rx.try_recv().expect("không có reply").expect("lỗi");
        (r.rows, r.done)
    }

    fn err_code(mut rx: FetchReply) -> &'static str {
        rx.try_recv()
            .expect("không có reply")
            .err()
            .expect("phải lỗi")
            .code
    }

    #[tokio::test]
    async fn hold_serves_pages_until_done_then_abandons_and_returns_none() {
        let (cursor, c) = fake(
            7,
            vec![
                Ok(page(vec![row(&[Some("1")])], false)),
                Ok(page(vec![row(&[Some("2")])], true)),
            ],
            false,
        );
        let (tx, mut rx) = mpsc::channel(4);
        let (f1, r1, _) = fetch_cmd(7, 10, 99);
        let (f2, r2, _) = fetch_cmd(7, 20, 88);
        tx.send(f1).await.unwrap();
        tx.send(f2).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(ok_rows(r1), (vec![row(&[Some("1")])], false));
        assert_eq!(ok_rows(r2), (vec![row(&[Some("2")])], true));
        assert_eq!(c.calls.load(Ordering::SeqCst), 2);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
        // Giới hạn của từng fetch được truyền đúng.
        assert_eq!(*c.limits.lock().unwrap(), vec![(10, 99), (20, 88)]);
    }

    #[tokio::test]
    async fn hold_clamps_page_size_zero_to_one() {
        let (cursor, c) = fake(7, vec![Ok(page(vec![], true))], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd(7, 0, 5);
        tx.send(f).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert!(ok_rows(r).1);
        assert_eq!(*c.limits.lock().unwrap(), vec![(1, 5)]);
    }

    #[tokio::test]
    async fn hold_wrong_cursor_id_is_cursor_not_found_and_cursor_stays_usable() {
        let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], true))], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (wrong, rw, _) = fetch_cmd(8, 10, 10);
        let (right, rr, _) = fetch_cmd(7, 10, 10);
        tx.send(wrong).await.unwrap();
        tx.send(right).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(err_code(rw), CURSOR_NOT_FOUND);
        assert!(ok_rows(rr).1);
        // Fetch sai cursor không chạm vào cursor thật.
        assert_eq!(c.calls.load(Ordering::SeqCst), 1);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_other_command_abandons_cursor_and_returns_it() {
        let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd(7, 10, 10);
        let (done_tx, done_rx) = oneshot::channel();
        tx.send(f).await.unwrap();
        tx.send(Cmd::Close(done_tx)).await.unwrap();
        // Lệnh sau còn trong kênh phải nguyên vẹn cho vòng lặp của actor.
        let (after, _ra, _) = fetch_cmd(7, 1, 1);
        tx.send(after).await.unwrap();
        let back = hold(1, cursor, &mut rx).await;
        assert!(matches!(back, Some(Cmd::Close(_))));
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
        assert!(!ok_rows(r).1);
        // Lệnh trả về đúng là lệnh `Close` gốc: người nhận kênh `done` vẫn còn sống.
        if let Some(Cmd::Close(done)) = back {
            done.send(()).unwrap();
            assert!(done_rx.await.is_ok());
        }
        assert!(matches!(rx.try_recv(), Ok(Cmd::Fetch(_))));
    }

    #[tokio::test]
    async fn hold_returns_new_execute_like_command_before_any_fetch() {
        let (cursor, c) = fake(7, vec![], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (reply, _rx) = oneshot::channel();
        tx.send(Cmd::SchemaTree(Job {
            id: 5,
            params: (),
            cancel: Arc::new(CancelSignal::new()),
            reply,
        }))
        .await
        .unwrap();
        let back = hold(1, cursor, &mut rx).await;
        assert!(matches!(back, Some(Cmd::SchemaTree(j)) if j.id == 5));
        assert_eq!(c.calls.load(Ordering::SeqCst), 0);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_closed_channel_abandons_cursor_and_returns_none() {
        let (cursor, c) = fake(7, vec![], false);
        let (tx, mut rx) = mpsc::channel::<Cmd>(1);
        drop(tx);
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
        assert_eq!(c.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn hold_closed_channel_after_one_fetch_abandons_once() {
        let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd(7, 10, 10);
        tx.send(f).await.unwrap();
        drop(tx);
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert!(!ok_rows(r).1);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_error_replies_the_error_abandons_and_stops() {
        let (cursor, c) = fake(7, vec![Err(DbError::new(SQL_ERROR, "mid-way"))], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, mut r, _) = fetch_cmd(7, 10, 10);
        let (next, _rn, _) = fetch_cmd(7, 10, 10);
        tx.send(f).await.unwrap();
        tx.send(next).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        let e = r.try_recv().unwrap().err().unwrap();
        assert_eq!((e.code, e.message.as_str()), (SQL_ERROR, "mid-way"));
        assert_eq!(c.calls.load(Ordering::SeqCst), 1);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
        // Lệnh sau không bị nuốt: vẫn còn trong kênh cho actor xử lý.
        assert!(rx.try_recv().is_ok());
    }

    #[tokio::test]
    async fn hold_cancelled_error_is_passed_through() {
        let (cursor, c) = fake(7, vec![Err(cancelled())], false);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd(7, 10, 10);
        tx.send(f).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(err_code(r), CANCELLED);
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_cancel_during_unfinished_page_replies_cancelled_and_abandons() {
        let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], true);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, cancel) = fetch_cmd(7, 10, 10);
        tx.send(f).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(err_code(r), CANCELLED);
        assert!(cancel.is_cancelled());
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_cancel_on_last_page_still_delivers_the_data() {
        // Trang cuối đã đọc xong (`done`) thì không còn cursor treo cờ interrupt: trả dữ liệu.
        let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], true))], true);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd(7, 10, 10);
        tx.send(f).await.unwrap();
        assert!(hold(1, cursor, &mut rx).await.is_none());
        assert_eq!(ok_rows(r), (vec![row(&[Some("x")])], true));
        assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn hold_marks_request_running_only_while_reading() {
        struct Spy(Arc<AtomicUsize>);
        impl Interrupt for Spy {
            fn interrupt(&self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        let reg = registry::global();
        // Id cố định rất lớn: các test `hold` khác dùng connection id 1 (không đăng ký) và
        // `next_conn_id()` có thể cấp đúng id 1, khi đó `set_running(1, ..)` của chúng đè lên test này.
        let conn = u64::MAX - 1;
        let hits = Arc::new(AtomicUsize::new(0));
        let (conn_tx, _conn_rx) = mpsc::channel(1);
        reg.add_conn(conn, "test", conn_tx, Arc::new(Spy(hits.clone())));
        let _guard = RegistryGuard(conn);

        // Request 1 đăng ký rồi bị huỷ đúng lúc `hold` đang đọc trang: chỉ lúc đó mới ngắt.
        let _req = reg.begin_request(1, conn);
        let (mut cursor, _c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], false);
        cursor.registry_cancel = Some(1);
        let (tx, mut rx) = mpsc::channel(4);
        let (f, r, _) = fetch_cmd_with(_req.flag.clone(), 7, 10, 10);
        tx.send(f).await.unwrap();
        drop(tx);
        assert!(hold(conn, cursor, &mut rx).await.is_none());
        assert_eq!(err_code(r), CANCELLED);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        // Sau `hold` request đã về `running = 0`: cancel tiếp không ngắt nữa (B4).
        reg.cancel(1);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }
}
