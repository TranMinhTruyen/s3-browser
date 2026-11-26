use super::*;
use crate::protocol::{CURSOR_NOT_FOUND, FetchParams, FetchResult, SchemaTreeResult};
use std::sync::Arc;
use tokio::sync::oneshot;

// `read_page` dùng `block_in_place`, chỉ chạy được trên runtime multi-thread (như `runtime.rs`),
// nên mọi test ở đây dùng `flavor = "multi_thread"`.

const BIG: usize = 16 * 1024 * 1024;
const INFINITE_ROWS: &str =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c";
const INFINITE_STEP: &str =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c";
const OVERFLOW_AT_ROW_2: &str =
    "SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)";

async fn mem() -> SqliteConnection {
    SqliteConnection::connect("sqlite::memory:").await.unwrap()
}

fn series(n: u32) -> String {
    format!(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<{n}) SELECT x FROM c"
    )
}

fn limits(page: usize, bytes: usize) -> Limits {
    Limits::new(page, bytes)
}

fn first_col(page: &Page) -> Vec<&str> {
    page.rows.iter().map(|r| r[0].as_deref().unwrap()).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_page_then_empty_done() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let mut held = open_cursor(&mut conn, &series(5), 7).await.ok().unwrap();
    assert_eq!(held.cursor_id, 7);
    let p = read_page(&mut held.stmt, limits(5, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["1", "2", "3", "4", "5"]);
    assert!(!p.done);
    let p = read_page(&mut held.stmt, limits(5, BIG), &cancel).unwrap();
    assert!(p.rows.is_empty());
    assert!(p.done);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn partial_last_page_is_done() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let mut held = open_cursor(&mut conn, &series(5), 1).await.ok().unwrap();
    let p = read_page(&mut held.stmt, limits(3, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["1", "2", "3"]);
    assert!(!p.done);
    let p = read_page(&mut held.stmt, limits(3, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["4", "5"]);
    assert!(p.done);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn max_bytes_stops_early_but_keeps_one_row() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    // Mỗi dòng 10 byte chuỗi.
    let sql = "SELECT 'abcdefghij' FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 \
                   UNION ALL SELECT 4 UNION ALL SELECT 5)";
    // (ngưỡng, số dòng mong đợi): dừng khi tổng byte >= ngưỡng, luôn >= 1 dòng.
    for (max_bytes, expect) in [(0, 1), (1, 1), (10, 1), (11, 2), (20, 2), (21, 3), (BIG, 5)] {
        let mut held = open_cursor(&mut conn, sql, 1).await.ok().unwrap();
        let p = read_page(&mut held.stmt, limits(100, max_bytes), &cancel).unwrap();
        assert_eq!(p.rows.len(), expect, "max_bytes={max_bytes}");
        assert_eq!(p.done, expect == 5, "max_bytes={max_bytes}");
    }
}

/// NULL không tính byte: dòng toàn NULL không bao giờ chạm ngưỡng.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn null_cells_cost_no_bytes() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let sql = "SELECT NULL FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)";
    let mut held = open_cursor(&mut conn, sql, 1).await.ok().unwrap();
    let p = read_page(&mut held.stmt, limits(100, 1), &cancel).unwrap();
    assert_eq!(p.rows.len(), 3);
    assert!(p.done);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn page_size_zero_is_one_row() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let mut held = open_cursor(&mut conn, &series(3), 1).await.ok().unwrap();
    let p = read_page(&mut held.stmt, limits(0, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["1"]);
    assert!(!p.done);
}

/// Cờ huỷ đặt trước: không đọc dòng nào, `cancelled`; bỏ cờ thì đọc tiếp từ dòng đầu.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_flag_set_before_read() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(true);
    let mut held = open_cursor(&mut conn, &series(3), 1).await.ok().unwrap();
    let e = read_page(&mut held.stmt, limits(10, BIG), &cancel)
        .err()
        .unwrap();
    assert_eq!(e.code, CANCELLED);
    cancel.store(false, Ordering::SeqCst);
    let p = read_page(&mut held.stmt, limits(10, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["1", "2", "3"]);
}

/// Huỷ giữa trang: thread khác đặt cờ khi trang đang đọc (kết quả vô hạn, trang cực lớn).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_mid_page_between_rows() {
    let mut conn = mem().await;
    let cancel = Arc::new(AtomicBool::new(false));
    let mut held = open_cursor(&mut conn, INFINITE_ROWS, 1).await.ok().unwrap();
    let flag = cancel.clone();
    let t = std::thread::spawn(move || flag.store(true, Ordering::SeqCst));
    let e = read_page(&mut held.stmt, limits(usize::MAX, usize::MAX), &cancel)
        .err()
        .unwrap();
    t.join().unwrap();
    assert_eq!(e.code, CANCELLED);
}

/// Huỷ khi `sqlite3_step` đang chạy: `sqlite3_interrupt` + cờ huỷ -> `cancelled` (không phải sqlError).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn interrupt_during_step_with_cancel_flag_is_cancelled() {
    let e = interrupt_infinite_step(true).await;
    assert_eq!(e.code, CANCELLED);
}

/// Interrupt mà không có cờ huỷ vẫn là lỗi SQL thường (không bị nuốt thành `cancelled`).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn interrupt_without_cancel_flag_is_sql_error() {
    let e = interrupt_infinite_step(false).await;
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.contains("interrupt"), "{}", e.message);
}

/// Chạy `read_page` trên câu có một `step` vô hạn, thread khác gọi interrupt lặp lại tới khi xong.
async fn interrupt_infinite_step(set_flag: bool) -> DbError {
    let mut conn = mem().await;
    let cancel = Arc::new(AtomicBool::new(false));
    // Lấy handle interrupt TRƯỚC khi `open_cursor` (khoá nằm trong `Stmt` sau đó).
    let handle = {
        let mut h = conn.lock_handle().await.unwrap();
        // SAFETY: `conn` sống hơn `handle`, `handle` chỉ dùng trong test này.
        unsafe { raw::InterruptHandle::of(&mut h) }
    };
    let mut held = open_cursor(&mut conn, INFINITE_STEP, 1).await.ok().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let (flag, stop2) = (cancel.clone(), stop.clone());
    let t = std::thread::spawn(move || {
        while !stop2.load(Ordering::SeqCst) {
            if set_flag {
                flag.store(true, Ordering::SeqCst);
            }
            handle.interrupt();
            std::thread::yield_now();
        }
    });
    let res = read_page(&mut held.stmt, limits(10, BIG), &cancel);
    stop.store(true, Ordering::SeqCst);
    t.join().unwrap();
    res.err().unwrap()
}

/// Lỗi ở dòng 2: `read_page` trả `sqlError`, các dòng đã đọc của trang đó bị bỏ.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn error_mid_page_is_sql_error() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let mut held = open_cursor(&mut conn, OVERFLOW_AT_ROW_2, 1)
        .await
        .ok()
        .unwrap();
    let e = read_page(&mut held.stmt, limits(10, BIG), &cancel)
        .err()
        .unwrap();
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.contains("integer overflow"), "{}", e.message);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_cursor_bad_sql_is_sql_error() {
    let mut conn = mem().await;
    let e = open_cursor(&mut conn, "SELECT * FROM nope", 1)
        .await
        .err()
        .unwrap();
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.contains("nope"));
    // Connection không bị khoá sau lỗi.
    let (res, held) = execute(
        &mut conn,
        "SELECT 1",
        limits(10, BIG),
        &AtomicBool::new(false),
        1,
    )
    .await;
    assert!(held.is_none());
    assert_eq!(
        res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
        Some("1")
    );
}

// ---------- thực thi ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_only_last_statement_keeps_cursor() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let sql = format!("{}; {}", series(5), series(5));
    let (res, held) = execute(&mut conn, &sql, limits(3, BIG), &cancel, 9).await;
    let st = res.unwrap();
    assert_eq!(st.len(), 2);
    // Câu đầu: còn dòng nhưng bỏ -> truncated, không cursor.
    assert_eq!(st[0].truncated, Some(true));
    assert_eq!(st[0].done, Some(false));
    assert_eq!(st[0].cursor_id, None);
    assert_eq!(st[0].rows.as_ref().unwrap().len(), 3);
    // Câu cuối: giữ cursor.
    assert_eq!(st[1].truncated, None);
    assert_eq!(st[1].cursor_id, Some(9));
    let held = held.unwrap();
    assert_eq!(held.cursor_id, 9);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_done_has_no_cursor() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (res, held) = execute(&mut conn, &series(3), limits(10, BIG), &cancel, 9).await;
    let st = res.unwrap();
    assert_eq!(st[0].done, Some(true));
    assert_eq!(st[0].cursor_id, None);
    assert!(held.is_none());
    drop(held);
    // Câu đã finalize: connection đóng được, không panic.
    conn.close().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_error_in_last_select_first_page() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (res, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(10, BIG), &cancel, 1).await;
    let st = res.unwrap();
    assert_eq!(st.len(), 1);
    assert_eq!(st[0].error.as_ref().unwrap().code, SQL_ERROR);
    assert!(st[0].rows.is_none());
    assert!(held.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_error_in_non_last_select_stops_rest() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let sql = format!("{OVERFLOW_AT_ROW_2}; SELECT 2");
    let (res, held) = execute(&mut conn, &sql, limits(10, BIG), &cancel, 1).await;
    let st = res.unwrap();
    assert_eq!(st.len(), 1);
    assert_eq!(st[0].error.as_ref().unwrap().code, SQL_ERROR);
    assert!(held.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_cancelled_before_start() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(true);
    let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 1).await;
    assert_eq!(res.err().unwrap().code, CANCELLED);
    assert!(held.is_none());
}

/// RETURNING có cột nên đi đường cursor, và việc ghi thật sự xảy ra kể cả khi chỉ đọc một phần.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn execute_insert_returning_writes_all_rows() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let sql = "CREATE TABLE t(a INTEGER PRIMARY KEY, b); \
                   INSERT INTO t(b) VALUES('x'),('y'),('z') RETURNING a, b";
    let (res, held) = execute(&mut conn, sql, limits(1, BIG), &cancel, 3).await;
    let st = res.unwrap();
    assert_eq!(st[0].kind, "affected");
    assert_eq!(st[1].kind, "rows");
    assert_eq!(st[1].rows.as_ref().unwrap().len(), 1);
    assert_eq!(st[1].cursor_id, Some(3));
    // Bỏ cursor giữa chừng: 3 dòng vẫn đã được ghi.
    drop(held);
    let (res, _) = execute(
        &mut conn,
        "SELECT count(*) FROM t",
        limits(10, BIG),
        &cancel,
        4,
    )
    .await;
    assert_eq!(
        res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
        Some("3")
    );
}

// ---------- hold ----------

fn fetch_job(cursor_id: u64, page: usize) -> (Cmd, oneshot::Receiver<DbResult<FetchResult>>) {
    let (reply, rx) = oneshot::channel();
    let job = Job {
        id: 1,
        params: FetchParams {
            conn_id: 0,
            cursor_id,
            page_size: page,
            max_page_bytes: BIG,
        },
        cancel: Arc::new(CancelSignal::new()),
        reply,
    };
    (Cmd::Fetch(job), rx)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hold_wrong_cursor_keeps_real_one_then_drains() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
    let held = held.unwrap();
    let (tx, mut rx) = mpsc::channel(8);

    let (wrong, wrong_rx) = fetch_job(99, 10);
    let (right1, right1_rx) = fetch_job(5, 2);
    let (right2, right2_rx) = fetch_job(5, 10);
    for c in [wrong, right1, right2] {
        tx.send(c).await.ok().unwrap();
    }
    // `hold` kết thúc (None) khi cursor hết dòng; không còn lệnh nào chờ.
    assert!(hold(0, held, &mut rx).await.is_none());

    assert_eq!(
        wrong_rx.await.unwrap().err().unwrap().code,
        CURSOR_NOT_FOUND
    );
    let r1 = right1_rx.await.unwrap().ok().unwrap();
    assert_eq!(r1.rows.len(), 2);
    assert!(!r1.done);
    assert_eq!(r1.rows[0][0].as_deref(), Some("3"));
    let r2 = right2_rx.await.unwrap().ok().unwrap();
    assert_eq!(r2.rows.len(), 1);
    assert_eq!(r2.rows[0][0].as_deref(), Some("5"));
    assert!(r2.done);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hold_other_command_drops_cursor_and_returns_it() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
    let held = held.unwrap();
    let (tx, mut rx) = mpsc::channel(8);
    let (reply, _schema_rx) = oneshot::channel::<DbResult<SchemaTreeResult>>();
    let other = Cmd::SchemaTree(Job {
        id: 2,
        params: (),
        cancel: Arc::new(CancelSignal::new()),
        reply,
    });
    tx.send(other).await.ok().unwrap();
    let back = hold(0, held, &mut rx).await;
    assert!(matches!(back, Some(Cmd::SchemaTree(_))));
    // Cursor đã bị bỏ (finalize, nhả connection): connection dùng lại và đóng được.
    let (res, _) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 6).await;
    assert!(res.is_ok());
    conn.close().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hold_error_replies_and_drops_cursor() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (_, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(10, BIG), &cancel, 5).await;
    // Câu đầu đã lỗi ngay ở trang đầu nên không có cursor; dùng pageSize 1 để lỗi nằm ở fetch.
    assert!(held.is_none());
    drop(held);
    let (_, held) = execute(&mut conn, OVERFLOW_AT_ROW_2, limits(1, BIG), &cancel, 5).await;
    let held = held.unwrap();
    let (tx, mut rx) = mpsc::channel(8);
    let (fetch, fetch_rx) = fetch_job(5, 10);
    let (again, again_rx) = fetch_job(5, 10);
    tx.send(fetch).await.ok().unwrap();
    tx.send(again).await.ok().unwrap();
    // Lỗi -> `hold` trả None ngay, lệnh thứ hai không được phục vụ bởi cursor cũ.
    assert!(hold(0, held, &mut rx).await.is_none());
    assert_eq!(fetch_rx.await.unwrap().err().unwrap().code, SQL_ERROR);
    // Lệnh còn lại nằm trong kênh, actor sẽ trả `cursorNotFound` ở vòng lặp chính.
    let Some(Cmd::Fetch(job)) = rx.recv().await else {
        panic!("lệnh thứ hai phải còn trong kênh");
    };
    drop(again_rx);
    assert_eq!(job.params.cursor_id, 5);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hold_closed_channel_returns_none() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
    let (tx, mut rx) = mpsc::channel::<Cmd>(8);
    drop(tx);
    assert!(hold(0, held.unwrap(), &mut rx).await.is_none());
    conn.close().await.unwrap();
}

/// Fetch mang cờ huỷ đã bật: `hold` trả `cancelled`, bỏ cursor (finalize) và kết thúc; connection
/// dùng lại và đóng sạch được.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hold_fetch_with_cancel_flag_replies_cancelled_and_drops_cursor() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (_, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 5).await;
    let (tx, mut rx) = mpsc::channel(8);
    let (fetch, fetch_rx) = fetch_job(5, 2);
    let Cmd::Fetch(job) = &fetch else {
        panic!("fetch_job phải trả Cmd::Fetch");
    };
    job.cancel.cancel();
    tx.send(fetch).await.ok().unwrap();
    assert!(hold(0, held.unwrap(), &mut rx).await.is_none());
    assert_eq!(fetch_rx.await.unwrap().err().unwrap().code, CANCELLED);
    let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &cancel, 6).await;
    assert!(held.is_none());
    drop(held);
    assert_eq!(
        res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
        Some("1")
    );
    conn.close().await.unwrap();
}

// ---------- drop_cursor_if_cancelled ----------

/// Cờ huỷ bật + còn cursor (cursor có thể mang cờ interrupt treo do `cancel` chạy muộn):
/// trả `cancelled`, bỏ cursor; connection không còn bị `interrupted` và đóng sạch được.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drop_cursor_if_cancelled_flag_on_with_cursor_drops_and_clears_interrupt() {
    let mut conn = mem().await;
    let handle = {
        let mut h = conn.lock_handle().await.unwrap();
        // SAFETY: `conn` sống hơn `handle`, `handle` chỉ dùng trong test này.
        unsafe { raw::InterruptHandle::of(&mut h) }
    };
    let no_cancel = AtomicBool::new(false);
    let (res, held) = execute(&mut conn, &series(5), limits(2, BIG), &no_cancel, 3).await;
    assert!(res.is_ok() && held.is_some());
    // Mô phỏng `cancel` chạy sau khi trang đã đọc xong: cờ bật rồi interrupt, cursor còn mở.
    let cancel = AtomicBool::new(true);
    handle.interrupt();
    let (res, held) = drop_cursor_if_cancelled(res, held, &cancel);
    assert_eq!(res.err().unwrap(), cancelled());
    assert!(held.is_none());
    drop(held);
    // Cursor đã finalize nên cờ interrupt treo được SQLite xoá: câu kế chạy bình thường.
    let (res, held) = execute(&mut conn, "SELECT 1", limits(10, BIG), &no_cancel, 4).await;
    assert!(held.is_none());
    drop(held);
    assert_eq!(
        res.unwrap()[0].rows.as_ref().unwrap()[0][0].as_deref(),
        Some("1")
    );
    conn.close().await.unwrap();
}

/// Cờ huỷ không bật: kết quả và cursor giữ nguyên, cursor đọc tiếp được đúng chỗ.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn drop_cursor_if_cancelled_flag_off_keeps_result_and_cursor() {
    let mut conn = mem().await;
    let cancel = AtomicBool::new(false);
    let (res, held) = execute(&mut conn, &series(5), limits(2, BIG), &cancel, 3).await;
    let (res, held) = drop_cursor_if_cancelled(res, held, &cancel);
    let st = res.unwrap();
    assert_eq!(st[0].cursor_id, Some(3));
    assert_eq!(st[0].rows.as_ref().unwrap().len(), 2);
    let mut held = held.unwrap();
    assert_eq!(held.cursor_id, 3);
    let p = read_page(&mut held.stmt, limits(10, BIG), &cancel).unwrap();
    assert_eq!(first_col(&p), ["3", "4", "5"]);
    assert!(p.done);
}

/// Không còn cursor thì kết quả không đổi dù cờ huỷ bật hay không: `Ok` giữ `Ok`, lỗi gốc giữ
/// nguyên mã (không bị đổi thành `cancelled`).
#[test]
fn drop_cursor_if_cancelled_without_cursor_keeps_result() {
    for flag in [false, true] {
        let cancel = AtomicBool::new(flag);
        let (res, held) = drop_cursor_if_cancelled(Ok(42u32), None, &cancel);
        assert_eq!(res.unwrap(), 42, "flag={flag}");
        assert!(held.is_none(), "flag={flag}");

        let original = DbError::new(SQL_ERROR, "boom");
        let (res, held) = drop_cursor_if_cancelled::<u32>(Err(original.clone()), None, &cancel);
        assert_eq!(res.err().unwrap(), original, "flag={flag}");
        assert!(held.is_none(), "flag={flag}");
    }
}
