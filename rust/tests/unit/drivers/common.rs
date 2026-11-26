use super::*;
use crate::drivers::Job;
use crate::protocol::FetchParams;
use crate::registry::Interrupt;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::oneshot;

#[test]
fn millis_between_is_saturating_and_never_panics() {
    let a = Instant::now();
    let b = a + std::time::Duration::from_millis(1500);
    assert_eq!(millis_between(a, b), 1500);
    assert_eq!(millis_between(a, a), 0);
    // `at` trước `start` (đồng hồ lệch) về 0 thay vì panic hay âm.
    assert_eq!(millis_between(b, a), 0);
}

fn row(cells: &[Option<&str>]) -> Vec<Option<String>> {
    cells.iter().map(|c| c.map(str::to_owned)).collect()
}

// ---- Giới hạn ----

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

#[cfg(feature = "bench-timing")]
#[test]
fn with_bench_timing_add_read_and_add_convert_accumulate_for_network_drivers() {
    use std::time::Duration;
    let mut b = PageBuilder::new(Limits::new(10, 100));
    // Driver mạng đã `await` nên tự đo rồi cộng vào pha, nhiều lần thì dồn lại.
    b.add_read(Duration::from_millis(7));
    b.add_read(Duration::from_millis(5));
    b.add_convert(Duration::from_millis(3));
    b.add_convert(Duration::from_millis(4));
    let p = b.finish(true);
    assert_eq!(p.phases.read, Duration::from_millis(12));
    // Chưa `push` dòng nào nên pha convert chỉ gồm phần `add_convert`.
    assert_eq!(p.phases.convert, Duration::from_millis(7));
    let v = json_of(&rows_statement(
        0,
        "S".into(),
        vec![column("c")],
        p,
        None,
        Instant::now(),
    ));
    assert_eq!(v["readMs"], 12, "{v}");
    assert_eq!(v["convertMs"], 7, "{v}");
}

// ---- giữ với Cursor giả ----

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
    // Gọi Fetch bằng cursor sai không chạm vào cursor thật.
    assert_eq!(c.calls.load(Ordering::SeqCst), 1);
    assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn hold_other_command_abandons_cursor_and_returns_it() {
    let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], false);
    let (tx, mut rx) = mpsc::channel(4);
    let (f, r, _) = fetch_cmd(7, 10, 10);
    let (reply, _rx) = oneshot::channel();
    tx.send(f).await.unwrap();
    // P2: lệnh không phải `Close` thì cursor vẫn được `abandon`.
    tx.send(Cmd::SchemaTree(Job {
        id: 6,
        params: (),
        cancel: Arc::new(CancelSignal::new()),
        reply,
    }))
    .await
    .unwrap();
    // Lệnh sau còn trong kênh phải nguyên vẹn cho vòng lặp của actor.
    let (after, _ra, _) = fetch_cmd(7, 1, 1);
    tx.send(after).await.unwrap();
    let back = hold(1, cursor, &mut rx).await;
    assert!(matches!(back, Some(Cmd::SchemaTree(j)) if j.id == 6));
    assert_eq!(c.abandoned.load(Ordering::SeqCst), 1);
    assert!(!ok_rows(r).1);
    assert!(matches!(rx.try_recv(), Ok(Cmd::Fetch(_))));
}

#[tokio::test]
async fn hold_close_drops_the_cursor_without_abandon_and_returns_the_close() {
    let (cursor, c) = fake(7, vec![Ok(page(vec![row(&[Some("x")])], false))], false);
    let (tx, mut rx) = mpsc::channel(4);
    let (f, r, _) = fetch_cmd(7, 10, 10);
    let (done_tx, done_rx) = oneshot::channel();
    tx.send(f).await.unwrap();
    tx.send(Cmd::Close(done_tx)).await.unwrap();
    let (after, _ra, _) = fetch_cmd(7, 1, 1);
    tx.send(after).await.unwrap();
    let back = hold(1, cursor, &mut rx).await;
    // Cursor bị thả mà không `abandon` (nó có thể treo lệnh đóng).
    assert_eq!(c.abandoned.load(Ordering::SeqCst), 0);
    assert_eq!(c.calls.load(Ordering::SeqCst), 1);
    assert!(!ok_rows(r).1);
    // Lệnh trả về đúng là `Close` gốc: người nhận kênh `done` vẫn còn sống.
    let Some(Cmd::Close(done)) = back else {
        panic!("phải trả lại lệnh Close");
    };
    done.send(()).unwrap();
    assert!(done_rx.await.is_ok());
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

// ---- first_words ----

#[test]
fn first_words_returns_the_first_two_alphabetic_words() {
    assert_eq!(first_words("select 1"), ("select", ""));
    assert_eq!(first_words("SELECT * FROM t"), ("SELECT", "FROM"));
    assert_eq!(first_words("rollback to savepoint s1"), ("rollback", "to"));
    // Ký tự không phải chữ cái là dấu ngăn từ (kể cả số, `_`, dấu câu).
    assert_eq!(first_words("begin;"), ("begin", ""));
    assert_eq!(first_words("(select 1)"), ("select", ""));
    assert_eq!(first_words("  \n\tcommit   work"), ("commit", "work"));
    assert_eq!(first_words("1 select"), ("select", ""));
    assert_eq!(first_words("end/*x*/transaction"), ("end", "x"));
    assert_eq!(first_words(""), ("", ""));
    assert_eq!(first_words("123 456"), ("", ""));
    assert_eq!(first_words("héllo wörld"), ("h", "llo"));
}

// ---- is_cancel_safe ----

#[test]
fn plain_reads_are_cancel_safe() {
    for sql in [
        "select 1",
        "SELECT * FROM t WHERE a = 1",
        "SeLeCt 1",
        "values (1), (2)",
        "VALUES (1)",
        "table t",
        "TABLE public.t",
        "show all",
        "SHOW search_path",
        "select * from t for update",
        "select 'x' union all select 'y'",
    ] {
        assert!(is_cancel_safe(sql), "{sql}");
    }
}

#[test]
fn with_is_cancel_safe_only_without_write_keywords() {
    assert!(is_cancel_safe("with a as (select 1) select * from a"));
    assert!(is_cancel_safe(
        "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10) SELECT * FROM r"
    ));
    // Tên chứa từ khoá nhưng không phải từ khoá.
    assert!(is_cancel_safe(
        "with update_log as (select 1) select * from update_log"
    ));
    assert!(is_cancel_safe(
        "with insertion as (select 1) select * from insertion"
    ));
    assert!(is_cancel_safe(
        "with merged as (select 1) select * from merged"
    ));
    for sql in [
        "with x as (insert into t values (1) returning *) select * from x",
        "WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x",
        "with x as (delete from t returning *) select * from x",
        "with x as (merge into t using s on true when matched then delete returning *) select 1",
        "with a as (select 1) insert into t select * from a",
        "with a as (select 1) DELETE from t",
    ] {
        assert!(!is_cancel_safe(sql), "{sql}");
    }
}

#[test]
fn statements_that_write_or_are_unknown_are_not_cancel_safe() {
    for sql in [
        "insert into t values (1) returning id",
        "update t set a = 1 returning a",
        "delete from t returning a",
        "merge into t using s on true when matched then delete",
        "explain analyze select 1",
        "call proc()",
        "create table t (a int)",
        "refresh materialized view v",
        "do $$ begin end $$",
        "begin",
        "selectfoo 1",
        // Bắt đầu bằng `(` hoặc ký tự khác chữ cái: coi là không an toàn.
        "(select 1)",
        " select 1",
        "\nselect 1",
        "1",
        "",
        "-- c\nselect 1",
    ] {
        assert!(!is_cancel_safe(sql), "{sql:?}");
    }
}

#[test]
fn with_keyword_inside_a_string_is_treated_conservatively() {
    // Giới hạn đã biết: không phân tích chuỗi/comment, nên từ khoá trong literal làm câu bị
    // coi là không an toàn (chỉ đọc bỏ, không huỷ); sai theo hướng an toàn.
    assert!(!is_cancel_safe(
        "with a as (select 'delete') select * from a"
    ));
}

// ---- has_write_keyword (B3) ----

#[test]
fn has_write_keyword_flags_writes_and_ddl_in_any_statement_of_the_batch() {
    for sql in [
        "SELECT 1; UPDATE ##probe SET a = 2",
        "select 1;
insert into t values (1)",
        "DELETE FROM t",
        "merge t using s on 1=1 when matched then delete;",
        "EXEC sp_who",
        "execute dbo.p",
        "CREATE TABLE t (a int)",
        "ALTER TABLE t ADD b int",
        "DROP TABLE t",
        "TRUNCATE TABLE t",
        "SELECT a INTO #x FROM t",
        "SeLeCt 1; DeLeTe FROM t",
        // B11
        "SELECT 1; GRANT SELECT ON t TO u",
        "select 1; dbcc checkident('t')",
        "SELECT 1; DISABLE TRIGGER tr ON t",
        "select 1; receive top(1) * from q",
        "SELECT 1; BACKUP DATABASE d TO DISK='x'",
    ] {
        assert!(has_write_keyword(sql), "{sql}");
    }
}

#[test]
fn has_write_keyword_is_false_for_reads_and_names_that_only_contain_a_keyword() {
    for sql in [
        "SELECT 1",
        "select * from t where a = 1",
        "with a as (select 1) select * from a",
        "select * from update_log",
        "select intolerance, drops, executed from created",
        "",
    ] {
        assert!(!has_write_keyword(sql), "{sql:?}");
    }
}

#[test]
fn has_write_keyword_is_conservative_inside_strings_and_comments() {
    // Giới hạn đã biết: quét thô, từ khoá trong literal/comment vẫn tính là có ghi (sai theo
    // hướng an toàn: chỉ đọc bỏ, không huỷ phía server).
    assert!(has_write_keyword("select 'delete'"));
    assert!(has_write_keyword("select 1 -- drop it"));
}

// ---- words (Q12) ----

#[test]
fn words_splits_on_non_word_chars_and_drops_empty_pieces() {
    assert_eq!(
        words("a;b  c_d,1x").collect::<Vec<_>>(),
        ["a", "b", "c_d", "1x"]
    );
    assert_eq!(words("  ;; ,, ").count(), 0);
    assert_eq!(words("").count(), 0);
    // Ký tự không ASCII là ranh giới từ.
    assert_eq!(words("héllo").collect::<Vec<_>>(), ["h", "llo"]);
    assert_eq!(words("#tmp.x").collect::<Vec<_>>(), ["tmp", "x"]);
}

#[test]
fn words_iterator_is_cloneable_for_lookahead() {
    let mut it = words("begin tran x");
    it.next();
    assert_eq!(it.clone().next(), Some("tran"));
    assert_eq!(it.next(), Some("tran"));
}

#[test]
fn contains_word_matches_whole_words_case_insensitively() {
    assert!(contains_word("SELECT 1; Delete x", &["delete"]));
    assert!(!contains_word("select deleted", &["delete"]));
    assert!(!contains_word("", &["delete"]));
}

#[test]
fn begin_blocks_that_are_not_transactions_do_not_set_in_tx() {
    // Q2
    for sql in [
        "BEGIN TRY",
        "begin try select 1 end try",
        "BEGIN CATCH",
        "begin catch",
        "BEGIN NOT ATOMIC select 1; END",
        "begin atomic",
    ] {
        assert!(!after(false, &[sql]), "{sql}");
    }
    // Đang trong transaction thì khối lệnh không tắt nó.
    assert!(after(true, &["BEGIN TRY"]));
}

#[test]
fn begin_and_start_transaction_still_set_in_tx() {
    for sql in [
        "BEGIN",
        "begin;",
        "BEGIN TRANSACTION",
        "begin tran",
        "BEGIN WORK",
        "START TRANSACTION",
        "start transaction read only",
    ] {
        assert!(after(false, &[sql]), "{sql}");
    }
}

// ---- track_tx ----

fn after(start: bool, sqls: &[&str]) -> bool {
    let mut in_tx = start;
    for sql in sqls {
        track_tx(&mut in_tx, sql);
    }
    in_tx
}

#[test]
fn begin_and_start_open_a_transaction() {
    for sql in [
        "begin",
        "BEGIN",
        "Begin",
        "begin transaction",
        "BEGIN ISOLATION LEVEL SERIALIZABLE",
        "begin read only",
        "start transaction",
        "START TRANSACTION READ WRITE",
    ] {
        assert!(after(false, &[sql]), "{sql}");
        // Đã trong transaction thì vẫn trong transaction.
        assert!(after(true, &[sql]), "{sql}");
    }
}

#[test]
fn commit_end_rollback_abort_close_the_transaction() {
    for sql in [
        "commit",
        "COMMIT",
        "commit work",
        "commit transaction",
        "end",
        "END TRANSACTION",
        "rollback",
        "ROLLBACK",
        "rollback work",
        "abort",
        "ABORT WORK",
    ] {
        assert!(!after(true, &[sql]), "{sql}");
        assert!(!after(false, &[sql]), "{sql}");
    }
}

#[test]
fn rollback_to_savepoint_and_prepared_do_not_end_the_transaction() {
    for sql in [
        "rollback to savepoint s1",
        "ROLLBACK TO s1",
        "rollback to s1",
        "commit prepared 'tx1'",
        "rollback prepared 'tx1'",
        "COMMIT PREPARED 'tx1'",
    ] {
        assert!(after(true, &[sql]), "{sql}");
        assert!(!after(false, &[sql]), "{sql}");
    }
}

#[test]
fn other_statements_leave_the_transaction_state_alone() {
    for sql in [
        "select 1",
        "savepoint s1",
        "release savepoint s1",
        "insert into t values (1)",
        "set transaction isolation level serializable",
        "",
        // Không phải từ `begin`/`end`/`commit` nguyên vẹn.
        "beginning",
        "endpoint",
        "commits",
    ] {
        assert!(after(true, &[sql]), "{sql:?}");
        assert!(!after(false, &[sql]), "{sql:?}");
    }
}

#[test]
fn transaction_state_follows_a_script() {
    assert!(after(
        false,
        &["begin", "select 1", "savepoint a", "rollback to a"]
    ));
    assert!(!after(false, &["begin", "select 1", "commit"]));
    assert!(after(false, &["begin", "commit", "begin"]));
    assert!(!after(false, &["begin", "rollback to a", "rollback"]));
    assert!(!after(false, &["start transaction", "end", "select 1"]));
}

#[test]
fn rollback_work_to_savepoint_does_not_end_the_transaction() {
    // Từ thứ hai là `work`/`transaction`, `to` là từ thứ ba nên `track_tx` không nhận ra.
    for sql in [
        "rollback work to savepoint s1",
        "ROLLBACK TRANSACTION TO SAVEPOINT s1",
        "rollback work to s1",
    ] {
        assert!(after(true, &[sql]), "{sql}");
    }
}

#[test]
fn and_chain_keeps_the_transaction_open() {
    for sql in [
        "commit and chain",
        "COMMIT AND CHAIN",
        "rollback work and chain",
        "ROLLBACK TRANSACTION AND CHAIN",
        "end and chain",
        "abort and chain;",
    ] {
        assert!(after(true, &[sql]), "{sql}");
        assert!(!after(false, &[sql]), "{sql}");
    }
}

#[test]
fn and_no_chain_and_noise_words_end_the_transaction() {
    for sql in [
        "commit and no chain",
        "ROLLBACK WORK AND NO CHAIN",
        "COMMIT WORK",
        "END TRANSACTION",
        "abort",
        "commit;",
        "commit\n",
        "\n  rollback\n;\n",
        "commit transaction and no chain;",
    ] {
        assert!(!after(true, &[sql]), "{sql:?}");
    }
}

#[test]
fn semicolons_and_newlines_do_not_change_the_result() {
    for sql in [
        "rollback\nto\nsavepoint s1;",
        "ROLLBACK TRANSACTION\n  TO SAVEPOINT s1\n;",
        "commit\nand\nchain;",
        "commit prepared 'x';",
    ] {
        assert!(after(true, &[sql]), "{sql:?}");
    }
    assert!(!after(true, &["commit\n;"]));
}

// ---- giới hạn đã biết của MySQL/MariaDB (cùng `track_tx`/`is_cancel_safe` với PostgreSQL) ----

#[test]
fn mysql_transaction_statements_are_tracked() {
    for sql in [
        "begin work",
        "BEGIN",
        "start transaction",
        "START TRANSACTION WITH CONSISTENT SNAPSHOT",
        "start transaction read only",
    ] {
        assert!(after(false, &[sql]), "{sql}");
    }
    for sql in ["commit", "commit work", "rollback", "ROLLBACK WORK"] {
        assert!(!after(true, &[sql]), "{sql}");
    }
    // `ROLLBACK TO SAVEPOINT` và `COMMIT AND CHAIN` không kết thúc transaction.
    assert!(after(true, &["rollback to savepoint s1"]));
    assert!(after(true, &["COMMIT AND CHAIN"]));
}

#[test]
fn mysql_set_autocommit_is_not_recognised_as_a_transaction() {
    // Giới hạn đã biết: `SET autocommit=0` mở transaction ngầm nhưng `track_tx` không nhận ra,
    // nên `in_tx` vẫn false (bỏ cursor trong đó có thể `KILL` thay vì chỉ đọc bỏ).
    for sql in [
        "set autocommit=0",
        "SET autocommit = 0",
        "set @@autocommit=0",
    ] {
        assert!(!after(false, &[sql]), "{sql}");
        assert!(after(true, &[sql]), "{sql}: không được tự đóng transaction");
    }
}

#[test]
fn mysql_read_statements_cancel_safety() {
    for sql in [
        "select 1",
        "SHOW TABLES",
        "show create table t",
        "table t",
        "values row(1)",
    ] {
        assert!(is_cancel_safe(sql), "{sql}");
    }
    // `DESCRIBE`/`EXPLAIN`/`CALL` và câu ghi dữ liệu không được `KILL` giữa chừng.
    for sql in [
        "describe t",
        "explain select 1",
        "call p()",
        "insert into t values (1)",
        "update t set a = 1",
        "delete from t",
        "replace into t values (1)",
        "load data infile 'x' into table t",
    ] {
        assert!(!is_cancel_safe(sql), "{sql}");
    }
}
