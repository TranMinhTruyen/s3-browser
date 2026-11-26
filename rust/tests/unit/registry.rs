use super::*;
use std::future::Future;
use std::task::{Context, Poll, Wake, Waker};
use std::time::Duration;

/// `Interrupt` giả: chỉ đếm số lần bị gọi.
#[derive(Default)]
struct Counting(AtomicU64);

impl Counting {
    fn calls(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

impl Interrupt for Counting {
    fn interrupt(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

/// Registry riêng cho từng test (không đụng `global()`), rò rỉ để có `&'static`.
fn registry() -> &'static Registry {
    Box::leak(Box::new(Registry::default()))
}

/// Thêm một connection giả; trả (số lần interrupt, receiver giữ kênh sống).
fn add(reg: &Registry, id: u64, driver: &'static str) -> (Arc<Counting>, mpsc::Receiver<Cmd>) {
    let (tx, rx) = mpsc::channel::<Cmd>(1);
    let counting = Arc::new(Counting::default());
    reg.add_conn(id, driver, tx, counting.clone());
    (counting, rx)
}

/// Waker đếm số lần được đánh thức, để poll tay một future mà không cần runtime.
#[derive(Default)]
struct WakeCount(AtomicU64);

impl Wake for WakeCount {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

fn poll_once<F: Future>(
    fut: &mut std::pin::Pin<Box<F>>,
    wakes: &Arc<WakeCount>,
) -> Poll<F::Output> {
    let waker = Waker::from(wakes.clone());
    fut.as_mut().poll(&mut Context::from_waker(&waker))
}

// ---- Bộ đăng ký: hủy và ngắt (B4) ----

#[test]
fn cancel_interrupts_when_the_request_is_the_running_one() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);

    reg.cancel(10);

    assert!(guard.flag.is_cancelled());
    assert_eq!(counting.calls(), 1);
}

#[test]
fn cancel_after_the_request_finished_does_not_interrupt() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);
    // Actor đọc xong, chưa gỡ request khỏi bảng.
    reg.set_running(1, 0);

    reg.cancel(10);

    assert!(guard.flag.is_cancelled(), "cờ vẫn được đặt");
    assert_eq!(counting.calls(), 0, "không ngắt nhầm request kế tiếp");
}

#[test]
fn cancel_does_not_hit_a_newer_request_of_the_same_connection() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let old = reg.begin_request(10, 1);
    let newer = reg.begin_request(11, 1);
    // Request 11 đang chạy; huỷ muộn của request 10 không được ngắt nó.
    reg.set_running(1, 11);

    reg.cancel(10);

    assert!(old.flag.is_cancelled());
    assert!(!newer.flag.is_cancelled());
    assert_eq!(counting.calls(), 0);

    reg.cancel(11);
    assert!(newer.flag.is_cancelled());
    assert_eq!(counting.calls(), 1);
}

#[test]
fn cancel_of_a_queued_request_sets_flag_without_interrupt() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let queued = reg.begin_request(12, 1);
    // `running == 0`: actor đang rỗi hoặc chạy request khác.
    reg.cancel(12);

    assert!(queued.flag.is_cancelled());
    assert_eq!(counting.calls(), 0);
}

#[test]
fn cancel_unknown_id_is_a_no_op() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    reg.set_running(1, 5);

    reg.cancel(999);
    reg.cancel(0);

    assert_eq!(counting.calls(), 0);
}

#[test]
fn cancel_after_guard_dropped_is_a_no_op() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    let flag = guard.flag.clone();
    reg.set_running(1, 10);
    drop(guard);

    reg.cancel(10);

    assert!(!flag.is_cancelled());
    assert_eq!(counting.calls(), 0);
}

#[test]
fn cancel_when_the_connection_is_already_removed_only_sets_flag() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);
    assert!(reg.remove_conn(1, false).is_some());

    reg.cancel(10);

    assert!(guard.flag.is_cancelled());
    assert_eq!(counting.calls(), 0, "không còn handle để interrupt");
}

#[test]
fn cancel_only_interrupts_the_connection_of_the_request() {
    let reg = registry();
    let (a, _rx_a) = add(reg, 1, "sqlite");
    let (b, _rx_b) = add(reg, 2, "sqlite");
    let _ga = reg.begin_request(10, 1);
    let _gb = reg.begin_request(20, 2);
    reg.set_running(1, 10);
    reg.set_running(2, 20);

    reg.cancel(10);

    assert_eq!((a.calls(), b.calls()), (1, 0));
}

#[test]
fn cancel_twice_interrupts_twice_and_stays_cancelled() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);

    reg.cancel(10);
    reg.cancel(10);

    assert!(guard.flag.is_cancelled());
    assert_eq!(
        counting.calls(),
        2,
        "interrupt phải idempotent ở driver, registry không chặn"
    );
}

#[test]
fn cancel_from_another_thread_while_running() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);

    std::thread::spawn(move || reg.cancel(10)).join().unwrap();

    assert!(guard.flag.is_cancelled());
    assert_eq!(counting.calls(), 1);
}

// ---- Bộ đăng ký: kết nối ----

#[test]
fn set_running_on_unknown_connection_is_ignored() {
    let reg = registry();
    reg.set_running(42, 7);
    assert!(reg.conn_tx(42).is_none());
}

#[test]
fn remove_conn_interrupts_only_when_asked() {
    let reg = registry();
    let (a, _rx_a) = add(reg, 1, "sqlite");
    let (b, _rx_b) = add(reg, 2, "sqlite");

    assert!(reg.remove_conn(1, false).is_some());
    assert!(reg.remove_conn(2, true).is_some());

    assert_eq!((a.calls(), b.calls()), (0, 1));
}

#[test]
fn remove_conn_with_interrupt_cancels_the_requests_of_that_connection_only() {
    let reg = registry();
    let (_c1, _rx1) = add(reg, 1, "postgres");
    let (_c2, _rx2) = add(reg, 2, "postgres");
    let running = reg.begin_request(10, 1);
    let queued = reg.begin_request(11, 1);
    let other = reg.begin_request(20, 2);
    reg.set_running(1, 10);

    assert!(reg.remove_conn(1, true).is_some());

    // B1: cả request đang chạy lẫn đang xếp hàng của conn 1 bị huỷ; conn 2 không bị đụng.
    assert!(running.flag.is_cancelled());
    assert!(queued.flag.is_cancelled());
    assert!(!other.flag.is_cancelled());
}

#[test]
fn remove_conn_without_interrupt_cancels_nothing() {
    let reg = registry();
    let (_c, _rx) = add(reg, 1, "postgres");
    let req = reg.begin_request(10, 1);
    reg.set_running(1, 10);

    assert!(reg.remove_conn(1, false).is_some());

    assert!(!req.flag.is_cancelled());
}

#[test]
fn remove_conn_twice_and_unknown_return_none_without_interrupt() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");

    assert!(reg.remove_conn(1, true).is_some());
    assert!(reg.remove_conn(1, true).is_none());
    assert!(reg.remove_conn(77, true).is_none());

    assert_eq!(counting.calls(), 1);
}

#[test]
fn removed_connection_is_gone_from_lookups() {
    let reg = registry();
    let (_c, _rx) = add(reg, 1, "sqlite");
    assert_eq!(reg.conn_driver(1), Some("sqlite"));
    assert!(reg.conn_tx(1).is_some());

    reg.remove_conn(1, false);

    assert_eq!(reg.conn_driver(1), None);
    assert!(reg.conn_tx(1).is_none());
}

#[test]
fn conn_tx_is_a_clone_of_the_actor_channel() {
    let reg = registry();
    let (_c, rx) = add(reg, 1, "postgres");
    let tx = reg.conn_tx(1).unwrap();
    assert!(!tx.is_closed());
    drop(rx);
    // Actor (receiver) đã biến mất: kênh đóng, người gọi sẽ nhận `connection_closed`.
    assert!(tx.is_closed());
}

#[test]
fn drivers_are_kept_per_connection() {
    let reg = registry();
    let (_a, _rx_a) = add(reg, 1, "sqlite");
    let (_b, _rx_b) = add(reg, 2, "postgres");
    assert_eq!(reg.conn_driver(1), Some("sqlite"));
    assert_eq!(reg.conn_driver(2), Some("postgres"));
}

#[test]
fn next_conn_id_starts_at_one_and_never_repeats_across_threads() {
    let reg = registry();
    assert_eq!(reg.next_conn_id(), 1);
    assert_eq!(reg.next_conn_id(), 2);
    let mut all: Vec<u64> = (0..8)
        .map(|_| {
            std::thread::spawn(move || (0..200).map(|_| reg.next_conn_id()).collect::<Vec<_>>())
        })
        .collect::<Vec<_>>()
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect();
    let n = all.len();
    all.sort_unstable();
    all.dedup();
    assert_eq!(all.len(), n);
    assert_eq!(all[0], 3);
}

#[test]
fn global_registry_is_a_singleton() {
    assert!(std::ptr::eq(global(), global()));
}

#[test]
fn re_adding_a_connection_id_resets_running() {
    let reg = registry();
    let (_a, _rx_a) = add(reg, 1, "sqlite");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);
    let (fresh, _rx_b) = add(reg, 1, "sqlite");

    reg.cancel(10);

    assert!(guard.flag.is_cancelled());
    assert_eq!(fresh.calls(), 0, "entry mới có running = 0");
}

#[test]
fn guard_drop_removes_only_its_own_request() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "sqlite");
    let a = reg.begin_request(10, 1);
    let b = reg.begin_request(11, 1);
    reg.set_running(1, 11);
    drop(a);

    reg.cancel(11);

    assert!(b.flag.is_cancelled());
    assert_eq!(counting.calls(), 1);
}

// ---- CancelSignal ----

#[test]
fn new_signal_is_not_cancelled_and_flag_follows_it() {
    let s = CancelSignal::new();
    assert!(!s.is_cancelled());
    assert!(!s.flag().load(Ordering::SeqCst));
    s.cancel();
    assert!(s.is_cancelled());
    assert!(s.flag().load(Ordering::SeqCst));
    // Huỷ lại không đổi gì.
    s.cancel();
    assert!(s.is_cancelled());
}

#[test]
fn writing_the_raw_flag_is_seen_by_is_cancelled() {
    let s = CancelSignal::new();
    s.flag().store(true, Ordering::SeqCst);
    assert!(s.is_cancelled());
}

#[test]
fn cancelled_is_immediately_ready_when_cancelled_before_waiting() {
    let s = CancelSignal::new();
    s.cancel();
    let wakes = Arc::new(WakeCount::default());
    let mut fut = Box::pin(s.cancelled());
    assert!(
        poll_once(&mut fut, &wakes).is_ready(),
        "huỷ trước khi chờ không được mất"
    );
    assert_eq!(wakes.0.load(Ordering::SeqCst), 0);
}

#[test]
fn cancelled_stays_pending_until_cancel_then_wakes_the_task() {
    let s = CancelSignal::new();
    let wakes = Arc::new(WakeCount::default());
    let mut fut = Box::pin(s.cancelled());
    assert!(poll_once(&mut fut, &wakes).is_pending());
    // Poll lại khi chưa huỷ vẫn pending, không bị đánh thức giả.
    assert!(poll_once(&mut fut, &wakes).is_pending());
    assert_eq!(wakes.0.load(Ordering::SeqCst), 0);

    s.cancel();

    assert_eq!(wakes.0.load(Ordering::SeqCst), 1, "đúng một lần đánh thức");
    assert!(poll_once(&mut fut, &wakes).is_ready());
}

#[test]
fn cancel_wakes_every_waiter() {
    let s = CancelSignal::new();
    let wakes: Vec<_> = (0..4).map(|_| Arc::new(WakeCount::default())).collect();
    let mut futs: Vec<_> = (0..4).map(|_| Box::pin(s.cancelled())).collect();
    for (f, w) in futs.iter_mut().zip(&wakes) {
        assert!(poll_once(f, w).is_pending());
    }

    s.cancel();

    for (f, w) in futs.iter_mut().zip(&wakes) {
        assert_eq!(w.0.load(Ordering::SeqCst), 1);
        assert!(poll_once(f, w).is_ready());
    }
}

#[test]
fn a_dropped_waiter_does_not_break_later_waiters() {
    let s = CancelSignal::new();
    let wakes = Arc::new(WakeCount::default());
    let mut gone = Box::pin(s.cancelled());
    assert!(poll_once(&mut gone, &wakes).is_pending());
    drop(gone);
    let mut kept = Box::pin(s.cancelled());
    assert!(poll_once(&mut kept, &wakes).is_pending());

    s.cancel();

    assert!(poll_once(&mut kept, &wakes).is_ready());
}

#[tokio::test]
async fn cancel_wins_a_select_against_a_never_ready_future() {
    let s = Arc::new(CancelSignal::new());
    let canceller = {
        let s = s.clone();
        tokio::spawn(async move { s.cancel() })
    };
    let outcome = tokio::select! {
        () = s.cancelled() => "cancelled",
        () = std::future::pending::<()>() => "io",
    };
    canceller.await.unwrap();
    assert_eq!(outcome, "cancelled");
}

#[tokio::test]
async fn select_prefers_a_ready_io_future_when_not_cancelled() {
    let s = CancelSignal::new();
    let outcome = tokio::select! {
        () = s.cancelled() => "cancelled",
        () = std::future::ready(()) => "io",
    };
    assert_eq!(outcome, "io");
    assert!(!s.is_cancelled());
}

#[tokio::test]
async fn pre_cancelled_signal_makes_select_return_at_once() {
    let s = CancelSignal::new();
    s.cancel();
    let outcome = tokio::select! {
        () = s.cancelled() => "cancelled",
        () = std::future::pending::<()>() => "io",
    };
    assert_eq!(outcome, "cancelled");
}

#[tokio::test]
async fn cancelled_can_be_awaited_again_after_it_fired() {
    let s = CancelSignal::new();
    s.cancel();
    s.cancelled().await;
    s.cancelled().await;
}

#[tokio::test]
async fn registry_cancel_wakes_the_future_of_a_running_request() {
    let reg = registry();
    let (counting, _rx) = add(reg, 1, "postgres");
    let guard = reg.begin_request(10, 1);
    reg.set_running(1, 10);
    let flag = guard.flag.clone();
    let waiter = tokio::spawn(async move { flag.cancelled().await });
    // Nhường cho task chạy tới chỗ chờ.
    tokio::task::yield_now().await;

    reg.cancel(10);

    tokio::time::timeout(Duration::from_secs(10), waiter)
        .await
        .expect("future phải được đánh thức")
        .unwrap();
    assert_eq!(counting.calls(), 1);
}

/// Không mất tín hiệu: `cancel` từ thread khác chạy chen vào bất kỳ lúc nào so với việc
/// `cancelled()` đăng ký chờ. Hết thời gian chờ (chỉ để test không treo khi có lỗi) nghĩa là mất tín hiệu.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_is_never_lost_under_racing_threads() {
    for _ in 0..2000 {
        let s = Arc::new(CancelSignal::new());
        let waiter = {
            let s = s.clone();
            tokio::spawn(async move { s.cancelled().await })
        };
        let canceller = {
            let s = s.clone();
            std::thread::spawn(move || s.cancel())
        };
        tokio::time::timeout(Duration::from_secs(10), waiter)
            .await
            .expect("mất tín hiệu huỷ")
            .unwrap();
        canceller.join().unwrap();
    }
}
