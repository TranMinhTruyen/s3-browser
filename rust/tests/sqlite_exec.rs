//! N2: trình điều khiển SQLite (mở/đóng/thực thi/lấy dữ liệu/hủy).

mod common;

use common::*;
use serde_json::{Value, json};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn rows(st: &Value) -> &Vec<Value> {
    st["rows"].as_array().unwrap()
}

// ---------- mở / đóng ----------

#[test]
fn open_existing_temp_file() {
    let db = Db::new();
    assert!(db.conn > 0);
    let r = db.exec("SELECT 1");
    assert_eq!(rows(&statements(&r)[0]), &vec![json!(["1"])]);
}

#[test]
fn open_missing_file_fails_and_does_not_create() {
    let dir = TempDir::new();
    let path = dir.file("missing.db");
    let r = call(
        "open",
        json!({"driver": "sqlite", "path": path, "readOnly": false}),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert!(!std::path::Path::new(&path).exists());
}

#[test]
fn open_text_file_is_not_a_database() {
    let dir = TempDir::new();
    let path = dir.file("text.db");
    std::fs::write(
        &path,
        "this is plain text and certainly not a sqlite database file".repeat(8),
    )
    .unwrap();
    let r = call("open", json!({"driver": "sqlite", "path": path}));
    assert_eq!(err_code(&r), "notADatabase");
}

#[test]
fn read_only_insert_is_statement_error() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a)"));
    let ro = open(&db.path, true);
    let r = exec(ro, "INSERT INTO t VALUES(1)");
    let st = statements(&r);
    assert_eq!(st.len(), 1);
    assert_eq!(st[0]["error"]["code"], "sqlError");
    // vẫn đọc được
    let r = exec(ro, "SELECT count(*) FROM t");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["0"]));
    call("close", json!({"connId": ro}));
}

#[test]
fn close_is_idempotent_and_later_calls_conn_not_found() {
    let db = Db::new();
    let c = db.open_more();
    ok(&call("close", json!({"connId": c})));
    ok(&call("close", json!({"connId": c})));
    assert_eq!(err_code(&exec(c, "SELECT 1")), "connNotFound");
    assert_eq!(err_code(&fetch(c, 1)), "connNotFound");
    assert_eq!(
        err_code(&call("schemaTree", json!({"connId": c}))),
        "connNotFound"
    );
    assert_eq!(
        err_code(&call(
            "tableInfo",
            json!({"connId": c, "schema": "main", "table": "t"})
        )),
        "connNotFound"
    );
    assert_eq!(
        err_code(&call(
            "tableRows",
            json!({"connId": c, "schema": "main", "table": "t", "pageSize": 5, "maxPageBytes": 100})
        )),
        "connNotFound"
    );
}

#[test]
fn unknown_conn_id() {
    init();
    assert_eq!(err_code(&exec(u64::MAX - 1, "SELECT 1")), "connNotFound");
}

#[test]
fn close_with_open_cursor() {
    let db = Db::new();
    let c = db.open_more();
    let r = exec(c, &series(600));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    ok(&call("close", json!({"connId": c})));
    assert_eq!(err_code(&fetch(c, cur)), "connNotFound");
    assert_eq!(err_code(&exec(c, "SELECT 1")), "connNotFound");
}

// ---------- phân trang ----------

#[test]
fn select_1201_rows_pages() {
    let db = Db::new();
    let r = db.exec(&series(1201));
    let st = &statements(&r)[0];
    assert_eq!(st["kind"], "rows");
    assert_eq!(rows(st).len(), 500);
    assert_eq!(st["done"], false);
    assert!(st.get("truncated").is_none());
    assert_eq!(st["columns"][0]["name"], "x");
    assert_eq!(rows(st)[0], json!(["1"]));
    let cur = st["cursorId"].as_u64().unwrap();

    let f1 = fetch(db.conn, cur);
    let f1 = ok(&f1);
    assert_eq!(f1["rows"].as_array().unwrap().len(), 500);
    assert_eq!(f1["done"], false);
    assert_eq!(f1["rows"][0], json!(["501"]));

    let f2 = fetch(db.conn, cur);
    let f2 = ok(&f2);
    assert_eq!(f2["rows"].as_array().unwrap().len(), 201);
    assert_eq!(f2["done"], true);
    assert_eq!(f2["rows"][200], json!(["1201"]));

    // cursor đã tự đóng
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

#[test]
fn page_exactly_full_then_empty_done() {
    let db = Db::new();
    let r = db.exec(&series(500));
    let st = &statements(&r)[0];
    assert_eq!(rows(st).len(), 500);
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"], json!([]));
    assert_eq!(ok(&f)["done"], true);
}

#[test]
fn empty_select_is_done_immediately() {
    let db = Db::new();
    let r = db.exec("SELECT 1 AS a WHERE 0");
    let st = &statements(&r)[0];
    assert_eq!(st["kind"], "rows");
    assert_eq!(rows(st).len(), 0);
    assert_eq!(st["done"], true);
    assert!(st.get("cursorId").is_none());
    assert_eq!(st["columns"][0]["name"], "a");
}

#[test]
fn page_size_zero_behaves_as_one() {
    let db = Db::new();
    let r = exec_page(db.conn, &series(3), 0, MAX_BYTES);
    assert_eq!(rows(&statements(&r)[0]).len(), 1);
}

// ---------- số hàng bị ảnh hưởng / DDL / nhiều câu ----------

#[test]
fn rows_affected_and_ddl() {
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a, b)");
    let st = &statements(&r)[0];
    assert_eq!(st["kind"], "affected");
    assert_eq!(st["rowsAffected"], 0);

    let r = db.exec("INSERT INTO t VALUES(1,'x'),(2,'y'),(3,'z')");
    assert_eq!(statements(&r)[0]["rowsAffected"], 3);
    let r = db.exec("UPDATE t SET b='q' WHERE a<3");
    assert_eq!(statements(&r)[0]["rowsAffected"], 2);
    let r = db.exec("DELETE FROM t WHERE a=3");
    assert_eq!(statements(&r)[0]["rowsAffected"], 1);
    // DDL ngay sau DML không mượn lại số dòng cũ
    let r = db.exec("CREATE INDEX i ON t(a)");
    assert_eq!(statements(&r)[0]["rowsAffected"], 0);
    let r = db.exec("DROP TABLE t");
    assert_eq!(statements(&r)[0]["rowsAffected"], 0);
}

#[test]
fn multi_statements_dependent() {
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a); INSERT INTO t VALUES(1),(2); SELECT * FROM t");
    let st = statements(&r);
    assert_eq!(st.len(), 3);
    assert_eq!(
        st.iter()
            .map(|s| s["index"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );
    assert_eq!(st[0]["kind"], "affected");
    assert_eq!(st[1]["rowsAffected"], 2);
    assert_eq!(st[2]["kind"], "rows");
    assert_eq!(st[2]["rows"], json!([["1"], ["2"]]));
    assert_eq!(st[2]["done"], true);
    assert_eq!(st[2]["sql"], "SELECT * FROM t");
}

#[test]
fn error_stops_following_statements() {
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a); SELECT * FROM nope; INSERT INTO t VALUES(1)");
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[1]["error"]["code"], "sqlError");
    assert!(st[1]["error"]["message"].as_str().unwrap().contains("nope"));
    // câu 3 không chạy
    let r = db.exec("SELECT count(*) FROM t");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["0"]));
}

#[test]
fn syntax_error_reports_only_failing_statement() {
    let db = Db::new();
    let r = db.exec("SELECT 1; SELEC 2; SELECT 3");
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[0]["kind"], "rows");
    assert_eq!(st[1]["error"]["code"], "sqlError");
    // Đổi hành vi có chủ ý (plan Q1): chỉ giữ câu lỗi, không kèm phần SQL còn lại.
    assert_eq!(st[1]["sql"], "SELEC 2;");
}

#[test]
fn constraint_error_is_statement_error() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a PRIMARY KEY)"));
    let r = db.exec("INSERT INTO t VALUES(1); INSERT INTO t VALUES(1); SELECT 1");
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[1]["error"]["code"], "sqlError");
}

// ---------- tách câu ----------

#[test]
fn semicolon_in_string_and_comments() {
    let db = Db::new();
    let r = db.exec("SELECT 'a;b'; SELECT 2 -- c;d\n; SELECT /* ; */ 3");
    let st = statements(&r);
    assert_eq!(st.len(), 3);
    assert_eq!(st[0]["rows"], json!([["a;b"]]));
    assert_eq!(st[1]["rows"], json!([["2"]]));
    assert_eq!(st[2]["rows"], json!([["3"]]));
}

#[test]
fn create_trigger_body_is_one_statement() {
    let db = Db::new();
    let r = db.exec(
        "CREATE TABLE t(a); CREATE TABLE log(m); \
         CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES('x'); INSERT INTO log VALUES('y'); END; \
         INSERT INTO t VALUES(1); SELECT count(*) FROM log",
    );
    let st = statements(&r);
    assert_eq!(st.len(), 5);
    assert!(st.iter().all(|s| s.get("error").is_none()), "{r}");
    assert_eq!(st[4]["rows"], json!([["2"]]));
}

#[test]
fn trivia_only_sql_has_no_statements() {
    let db = Db::new();
    for sql in ["", "   ", "  -- hi\n /* x */ ; ", ";;"] {
        let r = db.exec(sql);
        assert!(statements(&r).is_empty(), "{sql:?}");
    }
}

#[test]
fn last_statement_followed_by_comment_is_last() {
    let db = Db::new();
    let r = db.exec("SELECT 1; -- end");
    let st = statements(&r);
    assert_eq!(st.len(), 1);
    assert_eq!(st[0]["done"], true);

    // câu cuối nhiều dòng + comment vẫn giữ cursor, không bị coi là bị cắt
    let r = db.exec(&format!("{}; /* tail */ -- more", series(600)));
    let st = statements(&r);
    assert_eq!(st.len(), 1);
    assert!(st[0]["cursorId"].is_number());
    assert!(st[0].get("truncated").is_none());
}

// ---------- giá trị ----------

#[test]
fn value_types() {
    let db = Db::new();
    let r =
        db.exec("SELECT NULL, 9007199254740993, -5, 1.5, 2.0, 'héllo 日本 😀', x'', x'00ff10', ''");
    let st = &statements(&r)[0];
    assert_eq!(
        rows(st)[0],
        json!([
            null,
            "9007199254740993",
            "-5",
            "1.5",
            "2.0",
            "héllo 日本 😀",
            "0x",
            "0x00ff10",
            ""
        ])
    );
}

#[test]
fn untyped_column_mixed_storage() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE m(v); INSERT INTO m VALUES(1),(2.5),('x'),(x'ab'),(NULL),(9223372036854775807)",
    ));
    let r = db.exec("SELECT v FROM m ORDER BY rowid");
    assert_eq!(
        rows(&statements(&r)[0]),
        &vec![
            json!(["1"]),
            json!(["2.5"]),
            json!(["x"]),
            json!(["0xab"]),
            json!([null]),
            json!(["9223372036854775807"]),
        ]
    );
}

#[test]
fn blob_few_kb_is_full_hex() {
    let db = Db::new();
    let r = db.exec("SELECT zeroblob(3000)");
    let cell = rows(&statements(&r)[0])[0][0].as_str().unwrap().to_owned();
    assert_eq!(cell.len(), 2 + 6000);
    assert!(cell.starts_with("0x"));
    assert!(cell[2..].bytes().all(|b| b == b'0'));
}

// ---------- Q3 / Q12 ----------

#[test]
fn q3_only_last_select_keeps_cursor() {
    let db = Db::new();
    let r = db.exec(&format!("{}; {}", series(600), series(600)));
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(rows(&st[0]).len(), 500);
    assert_eq!(st[0]["truncated"], true);
    assert_eq!(st[0]["done"], false);
    assert!(st[0].get("cursorId").is_none());
    assert_eq!(rows(&st[1]).len(), 500);
    let cur = st[1]["cursorId"].as_u64().unwrap();
    assert!(st[1].get("truncated").is_none());
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 100);
    assert_eq!(ok(&f)["done"], true);
}

#[test]
fn q3_earlier_select_with_few_rows_not_truncated() {
    let db = Db::new();
    let r = db.exec(&format!("{}; {}", series(3), series(600)));
    let st = statements(&r);
    assert!(st[0].get("truncated").is_none());
    assert_eq!(st[0]["done"], true);
}

#[test]
fn q12_page_breaks_on_bytes_then_fetch_completes() {
    let db = Db::new();
    // mỗi ô 2002 ký tự; ngưỡng 5000 => dừng sau 3 dòng
    let sql = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<100) \
               SELECT zeroblob(1000) FROM c";
    let r = exec_page(db.conn, sql, PAGE, 5000);
    let st = &statements(&r)[0];
    let first = rows(st).len();
    assert!((1..500).contains(&first), "{first}");
    assert_eq!(first, 3);
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();
    let mut total = first;
    loop {
        let f = fetch_page(db.conn, cur, PAGE, 5000);
        let f = ok(&f);
        total += f["rows"].as_array().unwrap().len();
        if f["done"] == true {
            break;
        }
    }
    assert_eq!(total, 100);
}

#[test]
fn q12_row_larger_than_max_bytes_still_returns_one_row() {
    let db = Db::new();
    let r = exec_page(
        db.conn,
        "SELECT zeroblob(1000) FROM (SELECT 1 UNION ALL SELECT 2)",
        PAGE,
        10,
    );
    let st = &statements(&r)[0];
    assert_eq!(rows(st).len(), 1);
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();
    let f = fetch_page(db.conn, cur, PAGE, 10);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 1);
}

// ---------- cursor ----------

#[test]
fn new_execute_closes_old_cursor() {
    let db = Db::new();
    let r = db.exec(&series(600));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    ok(&db.exec("SELECT 1"));
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

#[test]
fn fetch_wrong_cursor_id_keeps_real_cursor() {
    let db = Db::new();
    let r = db.exec(&series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    assert_eq!(err_code(&fetch(db.conn, cur + 1000)), "cursorNotFound");
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 500);
}

#[test]
fn fetch_without_any_cursor() {
    let db = Db::new();
    assert_eq!(err_code(&fetch(db.conn, 1)), "cursorNotFound");
}

#[test]
fn metadata_on_main_conn_works_while_tab_has_cursor() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a)"));
    let tab = db.open_more();
    let r = exec(tab, &series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    // connection chính (db.conn) độc lập với tab
    let tree = call("schemaTree", json!({"connId": db.conn}));
    assert_eq!(ok(&tree)["schemas"][0]["tables"], json!(["t"]));
    // cursor của tab vẫn dùng được
    assert_eq!(ok(&fetch(tab, cur))["rows"].as_array().unwrap().len(), 500);
    call("close", json!({"connId": tab}));
}

#[test]
fn other_command_on_same_conn_drops_cursor() {
    let db = Db::new();
    let r = db.exec(&series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    ok(&call("schemaTree", json!({"connId": db.conn})));
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

// ---------- huỷ ----------

/// Chạy `f` ở thread khác rồi gọi `s3b_cancel(id)` lặp lại tới khi `f` xong.
fn run_and_cancel<T: Send + 'static>(id: u64, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        let v = f();
        let _ = tx.send(());
        v
    });
    // Request có thể chưa đăng ký lúc đầu: gọi lại tới khi xong, không phụ thuộc thời gian chặt.
    while rx.recv_timeout(Duration::from_millis(20)).is_err() {
        cancel(id);
    }
    h.join().unwrap()
}

#[test]
fn cancel_infinite_execute_then_conn_reusable() {
    let db = Db::new();
    let (conn, id) = (db.conn, next_id());
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "execute",
            json!({"connId": conn, "sql": INFINITE, "pageSize": 500, "maxPageBytes": MAX_BYTES}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    let r = db.exec("SELECT 42");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["42"]));
}

#[test]
fn cancel_during_fetch_then_conn_reusable() {
    let db = Db::new();
    let r =
        db.exec("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c");
    let st = &statements(&r)[0];
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();
    let (conn, id) = (db.conn, next_id());
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "fetch",
            json!({"connId": conn, "cursorId": cur, "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    let r = db.exec("SELECT 7");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["7"]));
}

#[test]
fn cancel_only_affects_target_request() {
    let db = Db::new();
    let other = db.open_more();
    let (conn, id) = (db.conn, next_id());
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "execute",
            json!({"connId": conn, "sql": INFINITE, "pageSize": 500, "maxPageBytes": MAX_BYTES}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    // connection khác không bị ảnh hưởng
    assert_eq!(
        rows(&statements(&exec(other, "SELECT 1"))[0])[0],
        json!(["1"])
    );
    call("close", json!({"connId": other}));
}

#[test]
fn cancel_racing_close_does_not_crash() {
    let db = Db::new();
    let c = db.open_more();
    let id = next_id();
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        let r = call_with_id(
            id,
            "execute",
            json!({"connId": c, "sql": INFINITE, "pageSize": 500, "maxPageBytes": MAX_BYTES}),
        );
        let _ = tx.send(());
        r
    });
    let stopper = thread::spawn(move || {
        // spam cancel song song với close cho tới khi request kết thúc
        loop {
            cancel(id);
            if rx.recv_timeout(Duration::from_millis(1)).is_ok() {
                break;
            }
        }
    });
    // close có thể tới trước hoặc sau khi request đăng ký; cả hai đều không được crash
    thread::sleep(Duration::from_millis(50));
    ok(&call("close", json!({"connId": c})));
    let r = h.join().unwrap();
    stopper.join().unwrap();
    // cancelled, ok có lỗi từng câu hoặc connNotFound: chỉ cần JSON hợp lệ
    assert!(r["ok"].is_boolean());
    assert_eq!(err_code(&exec(c, "SELECT 1")), "connNotFound");
}

// ---------- huỷ request xếp hàng (B4) ----------

fn spawn_exec(
    conn: u64,
    id: u64,
    sql: &'static str,
) -> (thread::JoinHandle<Value>, mpsc::Receiver<()>) {
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        let r = call_with_id(
            id,
            "execute",
            json!({"connId": conn, "sql": sql, "pageSize": 500, "maxPageBytes": MAX_BYTES}),
        );
        let _ = tx.send(());
        r
    });
    (h, rx)
}

#[test]
fn cancel_queued_request_does_not_interrupt_running_one() {
    let db = Db::new();
    for _ in 0..20 {
        let (id1, id2) = (next_id(), next_id());
        let (h1, rx1) = spawn_exec(db.conn, id1, INFINITE);
        // Cho request 1 thời gian bắt đầu chạy (chờ trên channel, không sleep).
        assert!(rx1.recv_timeout(Duration::from_millis(30)).is_err());
        let (h2, rx2) = spawn_exec(db.conn, id2, "SELECT 1");
        // Huỷ request 2 lặp lại (có thể chưa đăng ký lúc đầu) trong khi request 1 còn chạy.
        for _ in 0..10 {
            cancel(id2);
            assert!(rx1.try_recv().is_err(), "request 1 bị interrupt nhầm");
            if rx2.recv_timeout(Duration::from_millis(5)).is_ok() {
                break;
            }
        }
        assert!(rx1.try_recv().is_err(), "request 1 bị interrupt nhầm");
        // Request 1 vẫn chạy; tự huỷ để kết thúc.
        let mut r1_done = false;
        while !r1_done {
            cancel(id1);
            r1_done = rx1.recv_timeout(Duration::from_millis(20)).is_ok();
        }
        assert_eq!(err_code(&h1.join().unwrap()), "cancelled");
        cancel(id2);
        assert_eq!(err_code(&h2.join().unwrap()), "cancelled");
        // conn dùng lại được
        assert_eq!(rows(&statements(&db.exec("SELECT 5"))[0])[0], json!(["5"]));
    }
}

#[test]
fn stale_cancel_does_not_hit_next_request() {
    let db = Db::new();
    for _ in 0..20 {
        let (conn, id) = (db.conn, next_id());
        let r = run_and_cancel(id, move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": INFINITE, "pageSize": 500, "maxPageBytes": MAX_BYTES}),
            )
        });
        assert_eq!(err_code(&r), "cancelled");
        // cancel muộn của request cũ chạy song song với request kế tiếp
        let (tx, rx) = mpsc::channel::<()>();
        let stopper = thread::spawn(move || {
            while rx.recv_timeout(Duration::from_millis(1)).is_err() {
                cancel(id);
            }
        });
        for _ in 0..5 {
            assert_eq!(rows(&statements(&db.exec("SELECT 9"))[0])[0], json!(["9"]));
        }
        tx.send(()).unwrap();
        stopper.join().unwrap();
    }
}

#[test]
fn close_with_queued_request_returns_valid_responses() {
    let db = Db::new();
    for _ in 0..20 {
        let c = db.open_more();
        let (id1, id2) = (next_id(), next_id());
        let (h1, rx1) = spawn_exec(c, id1, INFINITE);
        assert!(rx1.recv_timeout(Duration::from_millis(30)).is_err());
        let (h2, _rx2) = spawn_exec(c, id2, "SELECT 1");
        cancel(id2);
        ok(&call("close", json!({"connId": c})));
        let (r1, r2) = (h1.join().unwrap(), h2.join().unwrap());
        assert!(r1["ok"].is_boolean());
        assert!(r2["ok"].is_boolean());
        assert_eq!(err_code(&exec(c, "SELECT 1")), "connNotFound");
    }
}
