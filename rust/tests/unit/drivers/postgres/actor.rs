use super::*;
use futures_util::stream;
use std::net::TcpListener;

/// Một `tokio_postgres::Error` thật (kiểu này không tự dựng được): nối tới server giả đóng
/// socket ngay khi nhận, nên lỗi ra rất nhanh và không cần Docker.
async fn real_error() -> tokio_postgres::Error {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        // Nhận một connection rồi đóng ngay.
        drop(listener.accept());
    });
    let mut config = tokio_postgres::Config::new();
    config
        .host("127.0.0.1")
        .port(port)
        .user("u")
        .password("super-secret-pw")
        .connect_timeout(Duration::from_secs(5));
    config
        .connect(tokio_postgres::NoTls)
        .await
        .err()
        .expect("server giả đóng socket nên phải lỗi")
}

type Item = Result<i32, tokio_postgres::Error>;

// ---- COPY ----

#[test]
fn copy_is_detected_even_after_comments_and_in_scripts() {
    let first_of = |sql: &str| -> Vec<String> {
        split(Dialect::Postgres, sql)
            .into_iter()
            .map(|r| first_words(&sql[r]).0.to_ascii_lowercase())
            .collect()
    };
    assert_eq!(first_of("COPY t TO STDOUT"), ["copy"]);
    assert_eq!(first_of("copy t from stdin"), ["copy"]);
    assert_eq!(first_of("-- c\ncopy t to stdout"), ["copy"]);
    assert_eq!(first_of("/* c */ Copy (select 1) to stdout"), ["copy"]);
    assert_eq!(first_of("select 1; copy t to stdout"), ["select", "copy"]);
    // Không nhầm với câu chỉ chứa chữ `copy`.
    assert_eq!(first_of("select 'copy'"), ["select"]);
    assert_eq!(first_of("select * from copy_t"), ["select"]);
    assert_eq!(first_of("create table copy_t (a int)"), ["create"]);
}

// ---- hàm nhỏ ----

#[test]
fn unsupported_is_an_invalid_request() {
    let e = unsupported();
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "method not supported by driver");
}

#[test]
fn no_params_is_an_empty_exact_size_iterator() {
    let it = no_params();
    assert_eq!(it.len(), 0);
    assert_eq!(it.count(), 0);
}

#[test]
fn raw_borrows_the_bytes_for_every_type() {
    for ty in [Type::INT4, Type::MONEY, Type::TEXT, Type::RECORD] {
        assert!(Raw::accepts(&ty), "{ty}");
    }
    let bytes = [1u8, 2, 3];
    let raw = Raw::from_sql(&Type::INT4, &bytes).ok().unwrap();
    assert_eq!(raw.0, &bytes);
    // NULL không do `Raw` xử lý: `Option<Raw>` cho `None`.
    let null = <Option<Raw<'_>> as FromSql>::from_sql_null(&Type::INT4);
    assert!(null.ok().unwrap().is_none());
}

// ---- db_error ----

#[tokio::test]
async fn db_error_is_sql_error_with_the_server_text() {
    let e = real_error().await;
    let cancel = CancelSignal::new();
    let mapped = db_error(&e, &cancel);
    assert_eq!(mapped.code, SQL_ERROR);
    assert_eq!(mapped.message, error_text(&e));
    assert!(!mapped.message.is_empty());
    // Thông báo lỗi không được chứa mật khẩu.
    assert!(!mapped.message.contains("super-secret-pw"));
}

#[tokio::test]
async fn db_error_after_cancel_is_cancelled() {
    let e = real_error().await;
    let cancel = CancelSignal::new();
    cancel.cancel();
    let mapped = db_error(&e, &cancel);
    assert_eq!(mapped.code, CANCELLED);
}

// ---- or_cancel ----

#[tokio::test]
async fn or_cancel_returns_the_value_when_not_cancelled() {
    let cancel = CancelSignal::new();
    let r = or_cancel(&cancel, async { Ok::<_, tokio_postgres::Error>(5) }).await;
    assert_eq!(r.ok(), Some(5));
}

#[tokio::test]
async fn or_cancel_maps_errors_to_sql_error() {
    let e = real_error().await;
    let text = error_text(&e);
    let cancel = CancelSignal::new();
    let r = or_cancel(&cancel, async { Err::<i32, _>(e) }).await;
    let err = r.err().unwrap();
    assert_eq!(err.code, SQL_ERROR);
    assert_eq!(err.message, text);
}

#[tokio::test]
async fn or_cancel_prefers_cancellation_even_when_the_future_is_ready() {
    let cancel = CancelSignal::new();
    cancel.cancel();
    let r = or_cancel(&cancel, async { Ok::<_, tokio_postgres::Error>(5) }).await;
    assert_eq!(r.err().unwrap().code, CANCELLED);
}

#[tokio::test]
async fn or_cancel_stops_waiting_when_cancelled_later() {
    let cancel = CancelSignal::new();
    let never = std::future::pending::<Item>();
    let (r, ()) = tokio::join!(or_cancel(&cancel, never), async {
        tokio::task::yield_now().await;
        cancel.cancel();
    });
    assert_eq!(r.err().unwrap().code, CANCELLED);
}

// ---- next_item ----

#[tokio::test]
async fn next_item_yields_items_then_none() {
    let cancel = CancelSignal::new();
    let mut s = stream::iter(vec![Ok(1), Ok(2)] as Vec<Item>);
    assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(1))));
    assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(2))));
    assert!(matches!(next_item(&mut s, &cancel).await, Ok(None)));
}

#[tokio::test]
async fn next_item_reports_server_errors() {
    let e = real_error().await;
    let text = error_text(&e);
    let cancel = CancelSignal::new();
    let mut s = stream::iter(vec![Err(e)] as Vec<Item>);
    match next_item(&mut s, &cancel).await {
        Err(Fail::Server(err)) => {
            assert_eq!(err.code, SQL_ERROR);
            assert_eq!(err.message, text);
        }
        _ => panic!("phải là lỗi của server"),
    }
}

#[tokio::test]
async fn next_item_turns_server_errors_into_cancelled_after_cancel() {
    // Server báo "canceling statement" sau yêu cầu huỷ: người dùng thấy `cancelled`.
    let e = real_error().await;
    let cancel = CancelSignal::new();
    cancel.cancel();
    let mut s = stream::iter(vec![Err(e)] as Vec<Item>);
    match next_item(&mut s, &cancel).await {
        Err(Fail::Server(err)) => assert_eq!(err.code, CANCELLED),
        _ => panic!("phải là lỗi cancelled"),
    }
}

#[tokio::test]
async fn next_item_fast_path_ignores_a_cancel_flag_when_a_row_is_buffered() {
    // Dòng đã nằm sẵn trong buffer thì lấy luôn; vòng `next_page` mới là nơi kiểm cờ huỷ.
    let cancel = CancelSignal::new();
    cancel.cancel();
    let mut s = stream::iter(vec![Ok(7)] as Vec<Item>);
    assert!(matches!(next_item(&mut s, &cancel).await, Ok(Some(7))));
}

#[tokio::test]
async fn next_item_stops_waiting_when_cancelled() {
    let cancel = CancelSignal::new();
    let mut s = stream::pending::<Item>();
    let (r, ()) = tokio::join!(next_item(&mut s, &cancel), async {
        tokio::task::yield_now().await;
        cancel.cancel();
    });
    assert!(matches!(r, Err(Fail::Cancelled)));
}

#[tokio::test]
async fn next_item_returns_cancelled_at_once_when_already_cancelled_and_idle() {
    let cancel = CancelSignal::new();
    cancel.cancel();
    let mut s = stream::pending::<Item>();
    assert!(matches!(
        next_item(&mut s, &cancel).await,
        Err(Fail::Cancelled)
    ));
}

// ---- drop_if_cancelled ----

#[tokio::test]
async fn drop_if_cancelled_without_a_cursor_keeps_the_result() {
    let cancel = CancelSignal::new();
    let (res, held) = drop_if_cancelled(Ok(3), None, &cancel).await;
    assert_eq!(res.ok(), Some(3));
    assert!(held.is_none());
    // Cờ huỷ bật mà không có cursor thì kết quả giữ nguyên (không có gì để bỏ).
    cancel.cancel();
    let (res, held) = drop_if_cancelled(Ok(4), None, &cancel).await;
    assert_eq!(res.ok(), Some(4));
    assert!(held.is_none());
    let (res, _) = drop_if_cancelled::<i32>(Err(unsupported()), None, &cancel).await;
    assert_eq!(res.err().unwrap().code, INVALID_REQUEST);
}
