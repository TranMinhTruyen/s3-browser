use super::*;
use mysql_async::{DriverError, Opts, ServerError};
use std::sync::atomic::{AtomicBool, AtomicU64};
use tokio::runtime::Handle;

/// `Shared` không nối tới đâu cả: `drive` chỉ dùng cờ `broken`.
fn shared() -> Shared {
    Shared {
        kill_opts: Opts::default(),
        thread_id: 1,
        seq: AtomicU64::new(0),
        busy: AtomicBool::new(false),
        broken: AtomicBool::new(false),
        handle: Handle::current(),
    }
}

fn server_error(code: u16, message: &str) -> mysql_async::Error {
    mysql_async::Error::Server(ServerError {
        code,
        state: "HY000".into(),
        message: message.into(),
    })
}

/// Lỗi "fatal" của thư viện (connection không dùng tiếp được).
fn fatal_error() -> mysql_async::Error {
    mysql_async::Error::Driver(DriverError::ConnectionClosed)
}

// ---- db_error ----

#[test]
fn db_error_is_sql_error_with_the_server_text_when_not_cancelled() {
    let cancel = CancelSignal::new();
    let e = db_error(
        &server_error(1064, "You have an error in your SQL syntax"),
        &cancel,
    );
    assert_eq!(e.code, SQL_ERROR);
    assert_eq!(
        e.message,
        "ERROR 1064 (HY000): You have an error in your SQL syntax"
    );
}

#[test]
fn db_error_is_cancelled_once_the_request_was_cancelled() {
    let cancel = CancelSignal::new();
    cancel.cancel();
    // Sau KILL QUERY server báo 1317 "Query execution was interrupted": thành `cancelled`.
    let e = db_error(
        &server_error(1317, "Query execution was interrupted"),
        &cancel,
    );
    assert_eq!(e.code, CANCELLED);
    assert_eq!(e.message, cancelled().message);
    assert!(!e.message.contains("1317"));
}

#[test]
fn db_error_of_a_driver_error_uses_its_display_text() {
    let cancel = CancelSignal::new();
    let e = db_error(&fatal_error(), &cancel);
    assert_eq!(e.code, SQL_ERROR);
    assert_eq!(e.message, fatal_error().to_string());
    assert!(!e.message.is_empty());
}

#[test]
fn db_error_of_an_io_error_has_a_single_prefix() {
    let cancel = CancelSignal::new();
    let io = mysql_async::Error::Io(mysql_async::IoError::Io(std::io::Error::other("reset")));
    let e = db_error(&io, &cancel);
    assert_eq!(e.message, "Input/output error: reset");
}

// ---- drive ----

#[tokio::test]
async fn drive_returns_a_ready_value_without_touching_the_flags() {
    let s = shared();
    let cancel = CancelSignal::new();
    let r = drive(async { Ok::<_, mysql_async::Error>(7) }, &cancel, &s).await;
    assert_eq!(r.unwrap(), 7);
    assert!(!s.is_broken());
}

#[tokio::test]
async fn drive_maps_a_server_error_without_marking_the_connection_broken() {
    let s = shared();
    let cancel = CancelSignal::new();
    let r = drive(
        async { Err::<(), _>(server_error(1146, "no table")) },
        &cancel,
        &s,
    )
    .await;
    let e = r.unwrap_err();
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.starts_with("ERROR 1146"), "{}", e.message);
    assert!(!s.is_broken(), "lỗi của server không làm hỏng connection");
}

#[tokio::test]
async fn drive_marks_the_connection_broken_on_a_fatal_error() {
    let s = shared();
    let cancel = CancelSignal::new();
    let e = drive(async { Err::<(), _>(fatal_error()) }, &cancel, &s)
        .await
        .unwrap_err();
    assert_eq!(e.code, SQL_ERROR);
    assert!(s.is_broken());
}

#[tokio::test]
async fn drive_waits_for_a_future_that_needs_more_than_one_poll() {
    let s = shared();
    let cancel = CancelSignal::new();
    let r = drive(
        async {
            tokio::task::yield_now().await;
            Ok::<_, mysql_async::Error>("done")
        },
        &cancel,
        &s,
    )
    .await;
    assert_eq!(r.unwrap(), "done");
}

#[tokio::test]
async fn drive_on_a_cancelled_request_still_lets_the_future_finish() {
    // Không thả future giữa chừng: huỷ xong thì chờ nó kết thúc rồi mới trả.
    let s = shared();
    let cancel = CancelSignal::new();
    cancel.cancel();
    let r = drive(
        async {
            tokio::task::yield_now().await;
            Ok::<_, mysql_async::Error>(1)
        },
        &cancel,
        &s,
    )
    .await;
    assert_eq!(r.unwrap(), 1, "câu kịp xong thì giữ nguyên kết quả");
    assert!(!s.is_broken());
}

#[tokio::test]
async fn drive_turns_the_error_of_a_cancelled_request_into_cancelled() {
    let s = shared();
    let cancel = CancelSignal::new();
    cancel.cancel();
    let e = drive(
        async {
            tokio::task::yield_now().await;
            Err::<(), _>(server_error(1317, "Query execution was interrupted"))
        },
        &cancel,
        &s,
    )
    .await
    .unwrap_err();
    assert_eq!(e.code, CANCELLED);
    assert!(
        !s.is_broken(),
        "server báo gọn thì connection còn dùng được"
    );
}

#[tokio::test(start_paused = true)]
async fn drive_gives_up_after_the_grace_period_and_marks_the_connection_broken() {
    let s = shared();
    let cancel = CancelSignal::new();
    cancel.cancel();
    // Future không bao giờ xong: đồng hồ ảo nhảy tới hết `CANCEL_GRACE`.
    let e = drive(
        std::future::pending::<mysql_async::Result<()>>(),
        &cancel,
        &s,
    )
    .await
    .unwrap_err();
    assert_eq!(e.code, CANCELLED);
    assert!(s.is_broken());
}

#[tokio::test(start_paused = true)]
async fn drive_keeps_the_result_when_the_cancel_arrives_while_waiting() {
    let s = shared();
    let cancel = Arc::new(CancelSignal::new());
    let trigger = cancel.clone();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        trigger.cancel();
    });
    let fut = async {
        tokio::time::sleep(Duration::from_secs(3)).await;
        Ok::<_, mysql_async::Error>(5)
    };
    // Huỷ lúc giây 1, future xong ở giây 3 (< CANCEL_GRACE): kết quả được giữ.
    assert_eq!(drive(fut, &cancel, &s).await.unwrap(), 5);
    canceller.await.unwrap();
    assert!(!s.is_broken());
}

// ---- shutdown ----

/// Giá trị `KEY=value` trong `test-env/db/db.env`.
fn env_value(key: &str) -> Option<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-env/db/db.env");
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix(&format!("{key}=")))
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Opts tới server test (`port_key` = `MYSQL_PORT`/`MARIADB_PORT`); thiếu server thì
/// `S3B_REQUIRE_DB=1` fail, ngược lại in `SKIP` và trả `None`.
fn server_opts(port_key: &str, user_key: &str) -> Option<Opts> {
    let port = env_value(port_key).and_then(|p| p.parse::<u16>().ok());
    let password = std::env::var("S3B_MYSQL_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env_value("DB_PASSWORD"));
    let reachable = port.is_some_and(|p| {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], p)),
            Duration::from_millis(800),
        )
        .is_ok()
    });
    let (Some(port), Some(password), true) = (port, password, reachable) else {
        let msg = format!("SKIP shutdown {port_key}: chưa có server/mật khẩu test-env");
        assert!(
            !std::env::var("S3B_REQUIRE_DB").is_ok_and(|v| v == "1"),
            "{msg}"
        );
        eprintln!("{msg}");
        return None;
    };
    Some(
        mysql_async::OptsBuilder::default()
            .ip_or_hostname("127.0.0.1")
            .tcp_port(port)
            .user(env_value(user_key).or_else(|| Some("root".into())))
            .pass(Some(password))
            .into(),
    )
}

/// Số connection server đã đếm là "đóng không đàng hoàng" (`Aborted_clients`): `disconnect`
/// gửi `COM_QUIT` nên không tăng, thả `Conn` thô (đóng socket) thì tăng.
async fn aborted_clients(monitor: &mut Conn) -> u64 {
    let (_, v): (String, String) = monitor
        .query_first("show global status like 'Aborted_clients'")
        .await
        .unwrap()
        .unwrap();
    v.parse().unwrap()
}

/// B4: connection đã `broken` thì `shutdown` vẫn phải `disconnect` (gửi `COM_QUIT`) chứ không
/// thả `Conn` thô, vì `Drop` của `mysql_async` khi `disconnected=false` spawn `cleanup_for_pool`
/// đọc bỏ không timeout. Quan sát phía server: thread biến mất mà không bị tính là aborted.
async fn shutdown_of_a_broken_connection_quits_cleanly(port_key: &str, user_key: &str) {
    let Some(opts) = server_opts(port_key, user_key) else {
        return;
    };
    let mut monitor = Conn::new(opts.clone()).await.unwrap();
    let victim = Conn::new(opts).await.unwrap();
    let tid = victim.id();
    let before = aborted_clients(&mut monitor).await;

    let shared = Arc::new(shared());
    shared.mark_broken();
    assert!(shared.is_broken());
    let started = Instant::now();
    shutdown(Session::new(victim, shared)).await;
    assert!(
        started.elapsed() < CLOSE_TIMEOUT,
        "shutdown phải xong trong hạn đóng"
    );

    // Thread phía server biến mất (thăm dò theo điều kiện, không ngủ cố định).
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let n: u64 = monitor
            .query_first(format!(
                "select count(*) from information_schema.processlist where id = {tid}"
            ))
            .await
            .unwrap()
            .unwrap();
        if n == 0 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "thread {tid} vẫn còn trên server"
        );
        tokio::task::yield_now().await;
    }
    assert_eq!(
        aborted_clients(&mut monitor).await,
        before,
        "shutdown phải gửi COM_QUIT (disconnect), không thả socket thô"
    );
    monitor.disconnect().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_of_a_broken_mysql_connection_quits_cleanly() {
    shutdown_of_a_broken_connection_quits_cleanly("MYSQL_PORT", "MYSQL_USER").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_of_a_broken_mariadb_connection_quits_cleanly() {
    shutdown_of_a_broken_connection_quits_cleanly("MARIADB_PORT", "MARIADB_USER").await;
}

// ---- hàm nhỏ ----

#[test]
fn affected_saturates_instead_of_wrapping() {
    assert_eq!(affected(0), 0);
    assert_eq!(affected(5), 5);
    assert_eq!(affected(i64::MAX as u64), i64::MAX);
    assert_eq!(affected(u64::MAX), i64::MAX);
}

#[test]
fn broken_and_unsupported_errors_have_stable_codes() {
    let b = broken();
    assert_eq!(b.code, CONN_NOT_FOUND);
    assert!(b.message.contains("broken"));
    let u = unsupported();
    assert_eq!(u.code, INVALID_REQUEST);
    assert_eq!(u.message, "method not supported by driver");
}

#[test]
fn fail_records_a_statement_error_and_stops() {
    let mut out = Vec::new();
    let step = fail(
        &mut out,
        2,
        "select x",
        Instant::now(),
        DbError::new(SQL_ERROR, "boom"),
    );
    assert!(matches!(step, Step::Stop));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].index, 2);
    assert_eq!(out[0].sql, "select x");
    assert_eq!(out[0].error.as_ref().unwrap().message, "boom");
}

#[test]
fn fail_on_a_cancelled_error_returns_cancelled_without_a_statement() {
    let mut out = Vec::new();
    let step = fail(&mut out, 0, "select 1", Instant::now(), cancelled());
    assert!(matches!(step, Step::Cancelled(e) if e.code == CANCELLED));
    assert!(out.is_empty());
}

#[tokio::test]
async fn drop_if_cancelled_without_a_cursor_passes_the_result_through() {
    let cancel = CancelSignal::new();
    let (res, held) = drop_if_cancelled::<u8>(Ok(3), None, &cancel).await;
    assert_eq!(res.unwrap(), 3);
    assert!(held.is_none());
    cancel.cancel();
    // Đã huỷ nhưng không giữ cursor nào: kết quả không bị đổi.
    let (res, held) = drop_if_cancelled::<u8>(Ok(4), None, &cancel).await;
    assert_eq!(res.unwrap(), 4);
    assert!(held.is_none());
}
