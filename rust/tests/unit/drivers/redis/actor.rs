use super::super::tests::{Answer, Fake, session_for};
use super::*;
use crate::drivers::Job;
use crate::protocol::{ExecuteParams, FetchParams, FetchResult, TableParams, TableRowsParams};
use serde_json::{Value as Json, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::oneshot;

/// Server giả có vài lệnh dựng sẵn cho các test dưới đây.
async fn fake_db() -> Fake {
    Fake::start(|cmd| {
        let name = cmd[0].to_ascii_uppercase();
        match name.as_str() {
            "GET" => Some(Answer::raw("$1\r\nv\r\n")),
            "ECHO" => Some(Answer::raw("$5\r\nhello\r\n")),
            "LRANGE" => Some(Answer::raw("*5\r\n:1\r\n:2\r\n:3\r\n:4\r\n:5\r\n")),
            "HGETALL" => Some(Answer::raw("%2\r\n$1\r\na\r\n:1\r\n$1\r\nb\r\n:2\r\n")),
            "BOOM" => Some(Answer::raw("-ERR unknown command 'BOOM'\r\n")),
            "WRONGTYPE" => Some(Answer::raw(
                "-WRONGTYPE Operation against a key holding the wrong kind of value\r\n",
            )),
            "BLPOP" => Some(Answer::Hang),
            "DROPME" => Some(Answer::Close),
            "SELECT" if cmd.get(1).is_some_and(|n| n == "99") => {
                Some(Answer::raw("-ERR DB index is out of range\r\n"))
            }
            _ => None,
        }
    })
    .await
}

/// Lỗi của kết quả (kiểu `T` của driver không có `Debug` nên không dùng được `expect_err`).
fn err_of<T>(result: DbResult<T>) -> DbError {
    match result {
        Ok(_) => panic!("phải là lỗi"),
        Err(e) => e,
    }
}

fn args(items: &[&str]) -> Vec<Vec<u8>> {
    items.iter().map(|a| a.as_bytes().to_vec()).collect()
}

fn live_cancel() -> Arc<CancelSignal> {
    Arc::new(CancelSignal::new())
}

fn cancelled_signal() -> Arc<CancelSignal> {
    let c = live_cancel();
    c.cancel();
    c
}

async fn exec(
    session: &mut Session,
    sql: &str,
    page_size: usize,
    cancel: &CancelSignal,
) -> Executed {
    execute(session, sql, Limits::new(page_size, 1 << 20), cancel, 7).await
}

fn statements(e: &Executed) -> Vec<Json> {
    let Ok(list) = &e.res else {
        panic!("request không được lỗi: {:?}", e.res.as_ref().err());
    };
    list.iter()
        .map(|s| serde_json::to_value(s).expect("serialize"))
        .collect()
}

// ---- không hỗ trợ / Session::send ----

#[test]
fn unsupported_methods_use_a_stable_code() {
    let e = unsupported();
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "method not supported by driver");
}

#[tokio::test]
async fn send_returns_the_reply_and_passes_arguments_untouched() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let cancel = CancelSignal::new();
    let value = s
        .send(&args(&["ECHO", "a\r\nb", "é ", ""]), &cancel)
        .await
        .expect("chạy được");
    assert_eq!(value, redis::Value::BulkString(b"hello".to_vec()));
    let sent = fake.commands_of(0).pop().expect("có lệnh");
    assert_eq!(sent, ["ECHO", "a\r\nb", "é ", ""]);
    let bin = s
        .send(&[b"ECHO".to_vec(), vec![0xff, 0x00, 0x80]], &cancel)
        .await;
    assert!(bin.is_ok(), "đối số nhị phân không làm hỏng lệnh");
}

#[tokio::test]
async fn send_turns_a_server_error_into_sql_error_and_keeps_the_connection() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let cancel = CancelSignal::new();
    let e = s
        .send(&args(&["WRONGTYPE", "k"]), &cancel)
        .await
        .expect_err("lỗi");
    assert_eq!(e.code, SQL_ERROR);
    assert_eq!(
        e.message,
        "WRONGTYPE Operation against a key holding the wrong kind of value"
    );
    assert!(s.live.is_some(), "lỗi của server không làm mất connection");
    s.send(&args(&["GET", "k"]), &cancel)
        .await
        .expect("lệnh sau vẫn chạy");
    assert_eq!(fake.accepted(), 1);
}

#[tokio::test]
async fn a_cancelled_request_drops_the_connection_and_the_next_one_reconnects() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = s
        .send(&args(&["GET", "k"]), &cancelled_signal())
        .await
        .expect_err("đã huỷ");
    assert_eq!(e.code, CANCELLED);
    assert!(s.live.is_none());
    fake.wait_closed(1).await;
    assert_eq!(fake.count("GET"), 0, "lệnh đã huỷ không được gửi");
    s.send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect("nối lại rồi chạy");
    assert!(s.live.is_some());
    assert_eq!(fake.accepted(), 2);
}

#[tokio::test]
async fn reconnect_selects_the_remembered_database_not_zero() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    s.target.db = 4;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    s.send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect("nối lại");
    let second = fake.commands_of(1);
    assert!(
        second.iter().any(|c| c == &["SELECT", "4"]),
        "connection mới phải chọn lại DB 4: {second:?}"
    );
}

#[tokio::test]
async fn cancelling_a_blocking_command_drops_the_connection() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let cancel = CancelSignal::new();
    let blpop = args(&["BLPOP", "q", "0"]);
    let (res, ()) = tokio::join!(s.send(&blpop, &cancel), async {
        fake.wait_for("BLPOP", 1).await;
        cancel.cancel();
    });
    assert_eq!(res.expect_err("bị huỷ").code, CANCELLED);
    assert!(s.live.is_none());
    fake.wait_closed(1).await;
    // Sau đó lệnh thường vẫn chạy.
    s.send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect("nối lại");
}

#[tokio::test]
async fn a_dropped_network_connection_is_a_sql_error_and_reconnects_next_time() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let cancel = CancelSignal::new();
    let e = s
        .send(&args(&["DROPME"]), &cancel)
        .await
        .expect_err("mất mạng");
    assert_eq!(e.code, SQL_ERROR);
    assert!(!e.message.is_empty());
    assert!(s.live.is_none(), "lỗi mạng phải thả connection");
    s.send(&args(&["GET", "k"]), &cancel)
        .await
        .expect("nối lại");
    assert_eq!(fake.accepted(), 2);
}

// ---- ensure_connected ----

#[tokio::test]
async fn reconnect_to_a_closed_port_reports_open_failed() {
    let mut fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    fake.stop_listening().await;
    let e = s
        .send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect_err("không nối lại được");
    assert_eq!(e.code, OPEN_FAILED);
    assert!(
        e.message.starts_with("reconnect failed: cannot connect"),
        "{}",
        e.message
    );
    assert!(s.live.is_none());
}

#[tokio::test]
async fn reconnect_that_is_refused_by_the_server_reports_its_text() {
    let hellos = Arc::new(AtomicUsize::new(0));
    let counter = hellos.clone();
    let fake = Fake::start(move |cmd| {
        (cmd[0].eq_ignore_ascii_case("HELLO") && counter.fetch_add(1, Ordering::SeqCst) >= 1)
            .then(|| Answer::raw("-ERR max number of clients reached\r\n"))
    })
    .await;
    let mut s = session_for(&fake, 0).await;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    let e = s
        .send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect_err("bị từ chối");
    assert_eq!(e.code, OPEN_FAILED);
    assert_eq!(
        e.message,
        "reconnect failed: ERR max number of clients reached"
    );
}

#[tokio::test(start_paused = true)]
async fn reconnect_gives_up_after_the_connect_timeout() {
    let hellos = Arc::new(AtomicUsize::new(0));
    let counter = hellos.clone();
    let fake = Fake::start(move |cmd| {
        (cmd[0].eq_ignore_ascii_case("HELLO") && counter.fetch_add(1, Ordering::SeqCst) >= 1)
            .then_some(Answer::Hang)
    })
    .await;
    let mut s = session_for(&fake, 0).await;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    let started = tokio::time::Instant::now();
    let e = s
        .send(&args(&["GET", "k"]), &CancelSignal::new())
        .await
        .expect_err("hết giờ");
    assert_eq!(e.code, OPEN_FAILED);
    assert_eq!(e.message, "reconnect failed: timed out");
    assert_eq!(started.elapsed(), crate::drivers::redis::CONNECT_TIMEOUT);
}

#[tokio::test]
async fn a_cancel_while_reconnecting_stops_the_attempt() {
    let hellos = Arc::new(AtomicUsize::new(0));
    let counter = hellos.clone();
    let fake = Fake::start(move |cmd| {
        (cmd[0].eq_ignore_ascii_case("HELLO") && counter.fetch_add(1, Ordering::SeqCst) >= 1)
            .then_some(Answer::Hang)
    })
    .await;
    let mut s = session_for(&fake, 0).await;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    let cancel = CancelSignal::new();
    let started = std::time::Instant::now();
    let get = args(&["GET", "k"]);
    let (res, ()) = tokio::join!(s.send(&get, &cancel), async {
        fake.wait_for("HELLO", 2).await;
        cancel.cancel();
    });
    assert_eq!(res.expect_err("huỷ").code, CANCELLED);
    assert!(s.live.is_none());
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "không chờ hết timeout"
    );
}

#[tokio::test]
async fn a_request_cancelled_before_reconnecting_does_not_open_a_socket() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let _ = s.send(&args(&["GET", "k"]), &cancelled_signal()).await;
    assert_eq!(fake.accepted(), 1);
    let e = s
        .send(&args(&["GET", "k"]), &cancelled_signal())
        .await
        .expect_err("huỷ");
    assert_eq!(e.code, CANCELLED);
    assert_eq!(fake.accepted(), 1, "không nối lại cho request đã huỷ");
}

// ---- thực thi ----

#[tokio::test]
async fn empty_text_runs_nothing() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let before = fake.names().len();
    for sql in ["", "  \n\n \t "] {
        let e = exec(&mut s, sql, 10, &CancelSignal::new()).await;
        assert!(statements(&e).is_empty(), "{sql:?}");
        assert!(e.held.is_none());
    }
    assert_eq!(fake.names().len(), before, "không gửi lệnh nào");
}

#[tokio::test]
async fn one_command_gives_one_rows_statement_with_the_json_shape_go_expects() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "  GET k  ", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 1);
    let st = &list[0];
    assert_eq!(st["index"], 0);
    assert_eq!(st["sql"], "GET k");
    assert_eq!(st["kind"], "rows");
    assert_eq!(st["columns"], json!([{"name": "value", "type": "text"}]));
    assert_eq!(st["rows"], json!([["v"]]));
    assert_eq!(st["done"], true);
    assert!(st.get("cursorId").is_none());
    assert!(st.get("truncated").is_none());
    assert!(st.get("error").is_none());
    assert!(st["elapsedMs"].is_u64());
    assert!(st["firstRowMs"].is_u64());
    assert!(e.held.is_none());
}

#[tokio::test]
async fn a_resp3_map_reply_is_a_key_value_table() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "HGETALL h", 10, &CancelSignal::new()).await;
    let st = &statements(&e)[0];
    assert_eq!(
        st["columns"],
        json!([{"name": "key", "type": "text"}, {"name": "value", "type": "text"}])
    );
    assert_eq!(st["rows"], json!([["a", "1"], ["b", "2"]]));
}

#[tokio::test]
async fn the_last_command_keeps_a_cursor_when_rows_remain() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "LRANGE l 0 -1", 2, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list[0]["rows"], json!([["1"], ["2"]]));
    assert_eq!(list[0]["done"], false);
    assert_eq!(list[0]["cursorId"], 7);
    assert!(list[0].get("truncated").is_none());
    let mut held = e.held.expect("giữ cursor");
    assert_eq!(held.id, 7);
    assert_eq!(held.id(), 7);
    let cancel = CancelSignal::new();
    let page = held
        .next_page(Limits::new(2, 1 << 20), &cancel)
        .await
        .expect("trang 2");
    assert_eq!(
        page.rows,
        vec![vec![Some("3".to_owned())], vec![Some("4".to_owned())]]
    );
    assert!(!page.done);
    let page = held
        .next_page(Limits::new(2, 1 << 20), &cancel)
        .await
        .expect("trang 3");
    assert_eq!(page.rows, vec![vec![Some("5".to_owned())]]);
    assert!(page.done);
    let page = held
        .next_page(Limits::new(2, 1 << 20), &cancel)
        .await
        .expect("hết");
    assert!(page.rows.is_empty() && page.done);
}

#[tokio::test]
async fn a_command_that_is_not_the_last_is_truncated_without_a_cursor() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "LRANGE l 0 -1\nGET k", 2, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["rows"], json!([["1"], ["2"]]));
    assert_eq!(list[0]["truncated"], true);
    assert!(list[0].get("cursorId").is_none());
    assert_eq!(list[1]["rows"], json!([["v"]]));
    assert!(e.held.is_none(), "GET xong thì không còn cursor");
}

#[tokio::test]
async fn no_cursor_is_kept_when_a_syntax_error_follows() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "LRANGE l 0 -1\nGET \"x", 2, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["truncated"], true);
    assert!(list[0].get("cursorId").is_none());
    assert!(e.held.is_none());
    assert_eq!(list[1]["index"], 1);
    assert_eq!(list[1]["sql"], "GET \"x");
    assert_eq!(list[1]["kind"], "affected");
    assert_eq!(list[1]["error"]["code"], "sqlError");
    assert_eq!(
        list[1]["error"]["message"],
        "line 2: unterminated double quote"
    );
}

#[tokio::test]
async fn execution_stops_at_the_first_server_error() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "GET a\nBOOM x\nGET b", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 2, "lệnh sau lỗi không chạy");
    assert_eq!(list[0]["rows"], json!([["v"]]));
    assert_eq!(list[1]["index"], 1);
    assert_eq!(list[1]["sql"], "BOOM x");
    assert_eq!(list[1]["error"]["code"], "sqlError");
    assert_eq!(list[1]["error"]["message"], "ERR unknown command 'BOOM'");
    assert_eq!(fake.count("GET"), 1);
    assert!(e.held.is_none());
    // Connection vẫn dùng được sau lỗi của server.
    let again = exec(&mut s, "GET c", 10, &CancelSignal::new()).await;
    assert_eq!(statements(&again)[0]["rows"], json!([["v"]]));
    assert_eq!(fake.accepted(), 1);
}

#[tokio::test]
async fn a_wrongtype_error_does_not_stop_the_next_request() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "WRONGTYPE k", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert!(
        list[0]["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("WRONGTYPE ")
    );
    let e = exec(&mut s, "GET k", 10, &CancelSignal::new()).await;
    assert_eq!(statements(&e)[0]["rows"], json!([["v"]]));
}

#[tokio::test]
async fn a_syntax_error_on_the_first_line_sends_nothing() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let before = fake.names().len();
    let e = exec(&mut s, "GET \"x", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["index"], 0);
    assert_eq!(
        list[0]["error"]["message"],
        "line 1: unterminated double quote"
    );
    assert_eq!(fake.names().len(), before);
}

#[tokio::test]
async fn commands_before_a_syntax_error_run_and_the_error_index_follows_them() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "GET a\nGET b\nGET 'c", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 3);
    assert_eq!(list[2]["index"], 2);
    assert_eq!(
        list[2]["error"]["message"],
        "line 3: unterminated single quote"
    );
    assert_eq!(fake.count("GET"), 2);
}

#[tokio::test]
async fn blocked_commands_are_reported_and_never_sent() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "GET a\nmonitor\nGET b", 10, &CancelSignal::new()).await;
    let list = statements(&e);
    assert_eq!(list.len(), 2);
    assert_eq!(
        list[1]["error"]["message"],
        "line 2: command is not supported (it never ends)"
    );
    assert_eq!(fake.count("MONITOR"), 0);
    assert_eq!(fake.count("GET"), 1);
}

// ---- SELECT ----

#[tokio::test]
async fn a_successful_select_is_remembered() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    assert_eq!(s.target.db, 0);
    exec(&mut s, "SELECT 5", 10, &CancelSignal::new()).await;
    assert_eq!(s.target.db, 5);
    exec(&mut s, "select 6", 10, &CancelSignal::new()).await;
    assert_eq!(s.target.db, 6);
    // Nhiều dòng: SELECT cuối cùng thắng.
    exec(
        &mut s,
        "SELECT 2\nGET k\nSELECT 3",
        10,
        &CancelSignal::new(),
    )
    .await;
    assert_eq!(s.target.db, 3);
}

#[tokio::test]
async fn a_failed_or_malformed_select_does_not_change_the_remembered_database() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    s.target.db = 1;
    let e = exec(&mut s, "SELECT 99", 10, &CancelSignal::new()).await;
    assert_eq!(
        statements(&e)[0]["error"]["message"],
        "ERR DB index is out of range"
    );
    assert_eq!(s.target.db, 1);
    for sql in ["SELECT abc", "SELECT", "SELECT 1 2"] {
        exec(&mut s, sql, 10, &CancelSignal::new()).await;
        assert_eq!(s.target.db, 1, "{sql}");
    }
}

#[tokio::test]
async fn after_a_cancel_the_next_command_runs_in_the_selected_database() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    exec(&mut s, "SELECT 5", 10, &CancelSignal::new()).await;
    let e = exec(&mut s, "GET k", 10, &cancelled_signal()).await;
    assert_eq!(e.res.as_ref().err().map(|e| e.code), Some(CANCELLED));
    exec(&mut s, "GET k", 10, &CancelSignal::new()).await;
    let second = fake.commands_of(1);
    let select = second
        .iter()
        .position(|c| c == &["SELECT", "5"])
        .expect("SELECT 5");
    let get = second.iter().position(|c| c[0] == "GET").expect("GET");
    assert!(select < get, "chọn DB trước khi chạy lệnh: {second:?}");
}

// ---- huỷ ----

#[tokio::test]
async fn a_cancel_returns_an_error_even_when_earlier_commands_succeeded() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let cancel = CancelSignal::new();
    let (e, ()) = tokio::join!(exec(&mut s, "GET a\nBLPOP q 0", 10, &cancel), async {
        fake.wait_for("BLPOP", 1).await;
        cancel.cancel();
    });
    assert_eq!(e.res.err().map(|e| e.code), Some(CANCELLED));
    assert!(e.held.is_none());
    assert!(s.live.is_none());
}

#[tokio::test]
async fn a_cancelled_request_with_a_syntax_error_after_it_is_still_cancelled() {
    let fake = fake_db().await;
    let mut s = session_for(&fake, 0).await;
    let e = exec(&mut s, "GET a\nGET 'x", 10, &cancelled_signal()).await;
    assert_eq!(e.res.err().map(|e| e.code), Some(CANCELLED));
}

// ---- Held / fill ----

fn int_reply(n: i64) -> Reply {
    Reply::new(redis::Value::Array(
        (1..=n).map(redis::Value::Int).collect(),
    ))
}

fn texts(page: &Page) -> Vec<String> {
    page.rows.iter().map(|r| r[0].clone().unwrap()).collect()
}

#[tokio::test]
async fn pages_keep_order_without_gaps_or_repeats() {
    let mut held = Held {
        id: 3,
        reply: int_reply(7),
    };
    let cancel = CancelSignal::new();
    let mut all = Vec::new();
    let mut sizes = Vec::new();
    loop {
        let page = held
            .next_page(Limits::new(3, 1 << 20), &cancel)
            .await
            .unwrap();
        sizes.push(page.rows.len());
        all.extend(texts(&page));
        if page.done {
            break;
        }
    }
    assert_eq!(sizes, [3, 3, 1]);
    assert_eq!(all, ["1", "2", "3", "4", "5", "6", "7"]);
}

#[tokio::test]
async fn an_exact_multiple_of_the_page_size_ends_with_an_empty_done_page_or_a_done_flag() {
    let mut held = Held {
        id: 1,
        reply: int_reply(4),
    };
    let cancel = CancelSignal::new();
    let a = held
        .next_page(Limits::new(2, 1 << 20), &cancel)
        .await
        .unwrap();
    assert_eq!(texts(&a), ["1", "2"]);
    assert!(!a.done);
    let b = held
        .next_page(Limits::new(2, 1 << 20), &cancel)
        .await
        .unwrap();
    assert_eq!(texts(&b), ["3", "4"]);
    assert!(b.done, "hết dòng thì trang cuối phải báo done");
}

#[tokio::test]
async fn max_page_bytes_cuts_a_page_but_always_returns_at_least_one_row() {
    let big = redis::Value::Array(
        (0..5)
            .map(|_| redis::Value::BulkString(b"abcd".to_vec()))
            .collect(),
    );
    let mut held = Held {
        id: 1,
        reply: Reply::new(big),
    };
    let cancel = CancelSignal::new();
    let first = held.next_page(Limits::new(100, 8), &cancel).await.unwrap();
    assert_eq!(first.rows.len(), 2, "dừng khi đủ 8 byte");
    let second = held.next_page(Limits::new(100, 1), &cancel).await.unwrap();
    assert_eq!(second.rows.len(), 1, "luôn có ít nhất một dòng");
    let third = held.next_page(Limits::new(100, 0), &cancel).await.unwrap();
    assert_eq!(third.rows.len(), 1);
    let rest = held
        .next_page(Limits::new(100, 1 << 20), &cancel)
        .await
        .unwrap();
    assert_eq!(rest.rows.len(), 1);
    assert!(rest.done);
}

#[tokio::test]
async fn a_page_size_of_zero_still_makes_progress() {
    let mut held = Held {
        id: 1,
        reply: int_reply(2),
    };
    let cancel = CancelSignal::new();
    let page = held
        .next_page(Limits::new(0, 1 << 20), &cancel)
        .await
        .unwrap();
    assert_eq!(texts(&page), ["1"]);
    assert!(!page.done);
}

#[tokio::test]
async fn an_empty_reply_gives_one_empty_done_page() {
    let mut held = Held {
        id: 1,
        reply: int_reply(0),
    };
    let page = held
        .next_page(Limits::new(10, 1 << 20), &CancelSignal::new())
        .await
        .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.done);
}

// ---- run: vòng lặp actor ----

/// Actor đang chạy trên server giả: kênh lệnh và id request tăng dần.
struct Rig {
    tx: mpsc::Sender<Cmd>,
    next_request: u64,
    task: tokio::task::JoinHandle<()>,
}

impl Rig {
    async fn start(fake: &Fake) -> Self {
        let session = session_for(fake, 0).await;
        let id = registry::global().next_conn_id();
        let (tx, rx) = mpsc::channel(8);
        Self {
            tx,
            next_request: 100,
            task: tokio::spawn(run(id, session, rx)),
        }
    }

    fn job<P, R>(
        &mut self,
        params: P,
        cancel: Arc<CancelSignal>,
    ) -> (Job<P, R>, oneshot::Receiver<DbResult<R>>) {
        self.next_request += 1;
        let (reply, rx) = oneshot::channel();
        (
            Job {
                id: self.next_request,
                params,
                cancel,
                reply,
            },
            rx,
        )
    }

    async fn execute(&mut self, sql: &str, page_size: usize) -> DbResult<ExecuteResult> {
        self.execute_with(sql, page_size, live_cancel()).await
    }

    async fn execute_with(
        &mut self,
        sql: &str,
        page_size: usize,
        cancel: Arc<CancelSignal>,
    ) -> DbResult<ExecuteResult> {
        let params: ExecuteParams = serde_json::from_value(json!({
            "connId": 1, "sql": sql, "pageSize": page_size, "maxPageBytes": 1 << 20
        }))
        .unwrap();
        let (job, rx) = self.job(params, cancel);
        self.tx.send(Cmd::Execute(job)).await.unwrap();
        rx.await.expect("actor trả lời")
    }

    async fn fetch(&mut self, cursor_id: u64, page_size: usize) -> DbResult<FetchResult> {
        let params: FetchParams = serde_json::from_value(json!({
            "connId": 1, "cursorId": cursor_id, "pageSize": page_size, "maxPageBytes": 1 << 20
        }))
        .unwrap();
        let (job, rx) = self.job(params, live_cancel());
        self.tx.send(Cmd::Fetch(job)).await.unwrap();
        rx.await.expect("actor trả lời")
    }

    async fn close(self) {
        let (done, wait) = oneshot::channel();
        self.tx.send(Cmd::Close(done)).await.unwrap();
        wait.await.expect("báo xong");
        self.task.await.expect("actor kết thúc");
    }
}

fn cursor_of(res: &ExecuteResult) -> Option<u64> {
    res.statements.last().and_then(|s| s.cursor_id)
}

#[tokio::test]
async fn the_actor_pages_through_a_cursor_with_fetch() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let res = rig.execute("LRANGE l 0 -1", 2).await.expect("execute");
    let cursor = cursor_of(&res).expect("còn dòng nên có cursor");
    let a = rig.fetch(cursor, 2).await.expect("trang 2");
    assert_eq!(a.rows.len(), 2);
    assert!(!a.done);
    let b = rig.fetch(cursor, 2).await.expect("trang 3");
    assert_eq!(b.rows.len(), 1);
    assert!(b.done);
    // Hết dòng thì cursor đã đóng.
    let gone = err_of(rig.fetch(cursor, 2).await);
    assert_eq!(gone.code, crate::protocol::CURSOR_NOT_FOUND);
    rig.close().await;
    fake.wait_closed(1).await;
}

#[tokio::test]
async fn fetch_with_a_wrong_cursor_id_keeps_the_real_cursor() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let res = rig.execute("LRANGE l 0 -1", 2).await.expect("execute");
    let cursor = cursor_of(&res).expect("cursor");
    let wrong = err_of(rig.fetch(cursor + 100, 2).await);
    assert_eq!(wrong.code, crate::protocol::CURSOR_NOT_FOUND);
    assert_eq!(rig.fetch(cursor, 10).await.expect("đúng id").rows.len(), 3);
    rig.close().await;
}

#[tokio::test]
async fn fetch_without_any_cursor_is_cursor_not_found() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let e = err_of(rig.fetch(1, 10).await);
    assert_eq!(e.code, crate::protocol::CURSOR_NOT_FOUND);
    rig.close().await;
}

#[tokio::test]
async fn a_new_command_drops_the_open_cursor() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let first = rig.execute("LRANGE l 0 -1", 2).await.expect("execute");
    let old = cursor_of(&first).expect("cursor");
    let second = rig.execute("GET k", 2).await.expect("lệnh mới");
    assert!(cursor_of(&second).is_none());
    let e = err_of(rig.fetch(old, 2).await);
    assert_eq!(e.code, crate::protocol::CURSOR_NOT_FOUND);
    // Cursor id không dùng lại giữa các request.
    let third = rig.execute("LRANGE l 0 -1", 2).await.expect("lệnh thứ ba");
    assert_ne!(cursor_of(&third), Some(old));
    rig.close().await;
}

#[tokio::test]
async fn sqlite_only_methods_are_rejected_without_touching_the_server() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let before = fake.names().len();

    let params: TableRowsParams = serde_json::from_value(json!({
        "connId": 1, "schema": "s", "table": "t", "pageSize": 1, "maxPageBytes": 1
    }))
    .unwrap();
    let (job, rx) = rig.job(params, live_cancel());
    rig.tx.send(Cmd::TableRows(job)).await.unwrap();
    assert_eq!(
        rx.await.unwrap().err().map(|e| e.message),
        Some("method not supported by driver".to_owned())
    );

    let (job, rx) = rig.job((), live_cancel());
    rig.tx.send(Cmd::SchemaTree(job)).await.unwrap();
    assert_eq!(
        rx.await.unwrap().err().map(|e| e.code),
        Some(INVALID_REQUEST)
    );

    let params: TableParams =
        serde_json::from_value(json!({"connId": 1, "schema": "s", "table": "t"})).unwrap();
    let (job, rx) = rig.job(params, live_cancel());
    rig.tx.send(Cmd::TableInfo(job)).await.unwrap();
    assert_eq!(
        rx.await.unwrap().err().map(|e| e.code),
        Some(INVALID_REQUEST)
    );

    assert_eq!(fake.names().len(), before);
    // Actor vẫn chạy bình thường sau đó.
    assert!(rig.execute("GET k", 10).await.is_ok());
    rig.close().await;
}

#[tokio::test]
async fn a_request_cancelled_before_it_starts_is_rejected_and_not_sent() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let before = fake.count("GET");
    let e = rig
        .execute_with("GET k", 10, cancelled_signal())
        .await
        .err()
        .expect("đã huỷ");
    assert_eq!(e.code, CANCELLED);
    assert_eq!(fake.count("GET"), before);
    assert!(
        rig.execute("GET k", 10).await.is_ok(),
        "request sau vẫn chạy"
    );
    rig.close().await;
}

#[tokio::test]
async fn cancelling_a_running_request_through_the_actor_reports_cancelled_and_recovers() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let cancel = live_cancel();
    let (res, ()) = tokio::join!(rig.execute_with("BLPOP q 0", 10, cancel.clone()), async {
        fake.wait_for("BLPOP", 1).await;
        cancel.cancel();
    });
    assert_eq!(err_of(res).code, CANCELLED);
    fake.wait_closed(1).await;
    // Lệnh kế tiếp nối lại và chạy.
    let ok = rig.execute("GET k", 10).await.expect("nối lại");
    assert_eq!(ok.statements.len(), 1);
    assert_eq!(fake.accepted(), 2);
    rig.close().await;
}

#[tokio::test]
async fn closing_the_actor_closes_the_socket() {
    let fake = fake_db().await;
    let rig = Rig::start(&fake).await;
    rig.close().await;
    fake.wait_closed(1).await;
}

#[tokio::test]
async fn the_actor_ends_when_the_channel_closes_and_drops_the_socket() {
    let fake = fake_db().await;
    let rig = Rig::start(&fake).await;
    let Rig { tx, task, .. } = rig;
    drop(tx);
    task.await.expect("actor kết thúc");
    fake.wait_closed(1).await;
}

#[tokio::test]
async fn a_close_while_a_cursor_is_open_still_completes() {
    let fake = fake_db().await;
    let mut rig = Rig::start(&fake).await;
    let res = rig.execute("LRANGE l 0 -1", 2).await.expect("execute");
    assert!(cursor_of(&res).is_some());
    rig.close().await;
    fake.wait_closed(1).await;
}
