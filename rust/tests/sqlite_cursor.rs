//! Hồi quy đường đọc dòng SELECT đi thẳng libsqlite3 (`raw::Stmt`): trang, cursor, lỗi giữa chừng,
//! kiểu ô và hợp đồng JSON, kiểm qua `s3b_call` như Go gọi.

mod common;

use common::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Câu có lỗi `integer overflow` ở dòng thứ 2 (dòng 1 đọc bình thường).
const OVERFLOW_AT_ROW_2: &str =
    "SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)";

fn rows(st: &Value) -> &Vec<Value> {
    st["rows"].as_array().unwrap()
}

fn keys(v: &Value) -> BTreeSet<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}

fn set(items: &[&'static str]) -> BTreeSet<&'static str> {
    items.iter().copied().collect()
}

// ---------- kiểu ô ----------

#[test]
fn cell_formats_through_json() {
    let db = Db::new();
    let r = db.exec(
        "SELECT -9223372036854775808, 9223372036854775807, 1.0, -3.0, 0.1, 1e15, 1e20, \
         1e999, -1e999, 9e999-9e999, 'a'||char(0)||'b', CAST(x'ff61' AS TEXT), x'', NULL, ''",
    );
    let st = &statements(&r)[0];
    assert_eq!(
        rows(st)[0],
        json!([
            "-9223372036854775808",
            "9223372036854775807",
            "1.0",
            "-3.0",
            "0.1",
            "1000000000000000",
            "100000000000000000000",
            "Inf",
            "-Inf",
            null, // NaN không tồn tại trong SQLite: phép tính ra NaN thành NULL
            "a\u{0}b",
            "\u{fffd}a",
            "0x",
            null,
            ""
        ])
    );
}

#[test]
fn blob_with_pattern_is_full_hex() {
    let db = Db::new();
    let r = db.exec("SELECT unhex(replace(hex(zeroblob(2500)), '00', '00ff'))");
    let cell = rows(&statements(&r)[0])[0][0].as_str().unwrap().to_owned();
    assert_eq!(cell, format!("0x{}", "00ff".repeat(2500)));
}

#[test]
fn untyped_column_each_row_own_type_in_one_page() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE m(v); INSERT INTO m VALUES(-9223372036854775808),(0.5),('t'),(x''),(NULL),(1e15),(char(0))",
    ));
    let r = db.exec("SELECT v FROM m ORDER BY rowid");
    assert_eq!(
        rows(&statements(&r)[0]),
        &vec![
            json!(["-9223372036854775808"]),
            json!(["0.5"]),
            json!(["t"]),
            json!(["0x"]),
            json!([null]),
            json!(["1000000000000000"]),
            json!(["\u{0}"]),
        ]
    );
}

// ---------- trang ----------

#[test]
fn pages_are_contiguous_and_complete() {
    let db = Db::new();
    let r = db.exec(&series(2500));
    let st = &statements(&r)[0];
    let cur = st["cursorId"].as_u64().unwrap();
    let mut all: Vec<String> = rows(st)
        .iter()
        .map(|r| r[0].as_str().unwrap().to_owned())
        .collect();
    let mut pages = 1;
    loop {
        let f = fetch(db.conn, cur);
        let f = ok(&f);
        all.extend(
            f["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r[0].as_str().unwrap().to_owned()),
        );
        pages += 1;
        if f["done"] == true {
            break;
        }
    }
    // 2500 dòng = 5 trang đầy; trang thứ 6 rỗng + done (hợp đồng cũ).
    assert_eq!(pages, 6);
    let expect: Vec<String> = (1..=2500).map(|n: u32| n.to_string()).collect();
    assert_eq!(all, expect);
}

#[test]
fn fetch_page_size_zero_returns_one_row() {
    let db = Db::new();
    let r = db.exec(&series(600));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    let f = fetch_page(db.conn, cur, 0, MAX_BYTES);
    assert_eq!(ok(&f)["rows"], json!([["501"]]));
    assert_eq!(ok(&f)["done"], false);
    // cursor vẫn dùng tiếp đúng thứ tự
    let f = fetch_page(db.conn, cur, 2, MAX_BYTES);
    assert_eq!(ok(&f)["rows"], json!([["502"], ["503"]]));
}

#[test]
fn fetch_breaks_on_bytes_but_returns_at_least_one_row() {
    let db = Db::new();
    // mỗi ô 2002 ký tự hex
    let sql = "SELECT zeroblob(1000) FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<10) SELECT x FROM c)";
    let r = exec_page(db.conn, sql, 1, MAX_BYTES);
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    let f = fetch_page(db.conn, cur, PAGE, 1);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 1);
    assert_eq!(ok(&f)["done"], false);
    let f = fetch_page(db.conn, cur, PAGE, 5000);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 3);
    let f = fetch_page(db.conn, cur, PAGE, MAX_BYTES);
    // 5 dòng còn lại ít hơn pageSize: gặp hết dòng ngay trong trang này
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 5);
    assert_eq!(ok(&f)["done"], true);
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

// ---------- lỗi giữa chừng ----------

#[test]
fn error_in_first_page_is_statement_error_and_conn_reusable() {
    let db = Db::new();
    let r = db.exec(OVERFLOW_AT_ROW_2);
    let st = statements(&r);
    assert_eq!(st.len(), 1);
    assert_eq!(st[0]["error"]["code"], "sqlError");
    assert!(
        st[0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("integer overflow")
    );
    assert!(st[0].get("rows").is_none());
    assert!(st[0].get("cursorId").is_none());
    // dòng đã đọc trước lỗi không bị rò thành cursor; connection dùng lại bình thường
    assert_eq!(rows(&statements(&db.exec("SELECT 3"))[0])[0], json!(["3"]));
}

#[test]
fn error_in_non_last_select_stops_following_statements() {
    let db = Db::new();
    let r = db.exec(&format!("SELECT 1; {OVERFLOW_AT_ROW_2}; SELECT 3"));
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[0]["kind"], "rows");
    assert_eq!(st[1]["error"]["code"], "sqlError");
}

#[test]
fn error_at_fetch_is_sql_error_and_cursor_is_dropped() {
    let db = Db::new();
    let r = exec_page(db.conn, OVERFLOW_AT_ROW_2, 1, MAX_BYTES);
    let st = &statements(&r)[0];
    assert_eq!(rows(st), &vec![json!(["1"])]);
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();

    let f = fetch(db.conn, cur);
    assert_eq!(err_code(&f), "sqlError");
    assert!(
        f["error"]["message"]
            .as_str()
            .unwrap()
            .contains("integer overflow")
    );
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
    assert_eq!(rows(&statements(&db.exec("SELECT 4"))[0])[0], json!(["4"]));
}

// ---------- câu có cột không phải SELECT thường ----------

#[test]
fn insert_returning_goes_through_rows_path_and_writes() {
    let db = Db::new();
    let r = db.exec(
        "CREATE TABLE t(a INTEGER PRIMARY KEY, b); \
         INSERT INTO t(b) VALUES('x'),('y') RETURNING a, b",
    );
    let st = statements(&r);
    assert_eq!(st[0]["kind"], "affected");
    assert_eq!(st[1]["kind"], "rows");
    assert_eq!(st[1]["rows"], json!([["1", "x"], ["2", "y"]]));
    assert_eq!(st[1]["done"], true);
    assert!(st[1].get("cursorId").is_none());
    assert_eq!(st[1]["columns"][0]["name"], "a");
    assert_eq!(
        rows(&statements(&db.exec("SELECT count(*) FROM t"))[0])[0],
        json!(["2"])
    );
}

#[test]
fn insert_returning_partially_read_still_inserts_all() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a INTEGER PRIMARY KEY, b)"));
    // câu không cuối: chỉ lấy 1 dòng rồi bỏ (truncated)
    let r = exec_page(
        db.conn,
        "INSERT INTO t(b) VALUES('x'),('y'),('z') RETURNING a; SELECT 1",
        1,
        MAX_BYTES,
    );
    let st = statements(&r);
    assert_eq!(st[0]["truncated"], true);
    assert_eq!(rows(&st[0]).len(), 1);
    // câu cuối: giữ cursor, bỏ cursor giữa chừng bằng lệnh khác
    let r = exec_page(
        db.conn,
        "INSERT INTO t(b) VALUES('p'),('q') RETURNING a",
        1,
        MAX_BYTES,
    );
    assert!(statements(&r)[0]["cursorId"].is_number());
    assert_eq!(
        rows(&statements(&db.exec("SELECT count(*) FROM t"))[0])[0],
        json!(["5"])
    );
}

#[test]
fn pragma_with_and_without_columns() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT DEFAULT 'd' NOT NULL)"));
    let r = db.exec("PRAGMA table_info(t)");
    let st = &statements(&r)[0];
    assert_eq!(st["kind"], "rows");
    assert_eq!(st["done"], true);
    assert_eq!(
        rows(st),
        &vec![
            json!(["0", "a", "INTEGER", "0", null, "1"]),
            json!(["1", "b", "TEXT", "1", "'d'", "0"]),
        ]
    );
    let names: Vec<&str> = st["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["cid", "name", "type", "notnull", "dflt_value", "pk"]
    );

    // PRAGMA không có cột là câu affected
    let r = db.exec("PRAGMA user_version = 5; PRAGMA user_version");
    let st = statements(&r);
    assert_eq!(st[0]["kind"], "affected");
    assert_eq!(st[1]["rows"], json!([["5"]]));
}

// ---------- cursor / hold ----------

#[test]
fn wrong_cursor_id_does_not_disturb_sequence() {
    let db = Db::new();
    let r = db.exec(&series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    for bad in [0, cur + 1, cur + 1000, u64::MAX] {
        assert_eq!(err_code(&fetch(db.conn, bad)), "cursorNotFound");
    }
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"][0], json!(["501"]));
    assert_eq!(err_code(&fetch(db.conn, cur + 1)), "cursorNotFound");
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"][0], json!(["1001"]));
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 200);
    assert_eq!(ok(&f)["done"], true);
}

#[test]
fn table_rows_replaces_cursor_and_old_one_is_gone() {
    let db = Db::new();
    ok(&db.exec(&format!("CREATE TABLE t(a); INSERT INTO t {}", series(600))));
    let r = db.exec(&series(1200));
    let old = statements(&r)[0]["cursorId"].as_u64().unwrap();
    let r = call(
        "tableRows",
        json!({"connId": db.conn, "schema": "main", "table": "t", "pageSize": 100, "maxPageBytes": MAX_BYTES}),
    );
    let new = ok(&r)["cursorId"].as_u64().unwrap();
    assert_ne!(old, new);
    assert_eq!(err_code(&fetch(db.conn, old)), "cursorNotFound");
    assert_eq!(
        ok(&fetch_page(db.conn, new, 100, MAX_BYTES))["rows"][0],
        json!(["101"])
    );
}

#[test]
fn table_info_command_drops_cursor() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a)"));
    let r = db.exec(&series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    ok(&call(
        "tableInfo",
        json!({"connId": db.conn, "schema": "main", "table": "t"}),
    ));
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

#[test]
fn cancel_during_fetch_drops_cursor() {
    let db = Db::new();
    let r =
        db.exec("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c");
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    let (conn, id) = (db.conn, next_id());
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        let r = call_with_id(
            id,
            "fetch",
            json!({"connId": conn, "cursorId": cur, "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        );
        let _ = tx.send(());
        r
    });
    while rx.recv_timeout(Duration::from_millis(20)).is_err() {
        cancel(id);
    }
    assert_eq!(err_code(&h.join().unwrap()), "cancelled");
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
    assert_eq!(rows(&statements(&db.exec("SELECT 8"))[0])[0], json!(["8"]));
}

// ---------- đóng connection khi còn cursor ----------

#[test]
fn close_with_open_cursor_releases_file_and_reopens() {
    let dir = TempDir::new();
    let path = dir.file("c.db");
    std::fs::File::create(&path).unwrap();
    let c = open(&path, false);
    ok(&exec(
        c,
        &format!("CREATE TABLE t(a); INSERT INTO t {}", series(700)),
    ));

    // cursor từ execute và (connection khác) từ tableRows, đều còn mở lúc đóng
    let c2 = open(&path, false);
    let r = exec(c, "SELECT a FROM t");
    assert!(statements(&r)[0]["cursorId"].is_number());
    let r = call(
        "tableRows",
        json!({"connId": c2, "schema": "main", "table": "t", "pageSize": 10, "maxPageBytes": MAX_BYTES}),
    );
    assert!(ok(&r)["cursorId"].is_number());

    ok(&call("close", json!({"connId": c})));
    ok(&call("close", json!({"connId": c2})));

    // mọi handle đã nhả: Windows chỉ xoá/ghi đè được file khi không còn handle mở
    let copy = dir.file("copy.db");
    std::fs::copy(&path, &copy).unwrap();
    let c3 = open(&copy, false);
    let r = exec(c3, "SELECT count(*) FROM t");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["700"]));
    ok(&call("close", json!({"connId": c3})));
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_file(&copy).unwrap();
}

#[test]
fn close_with_cursor_after_partial_fetches() {
    let db = Db::new();
    let c = db.open_more();
    let r = exec(c, &series(1500));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    assert_eq!(ok(&fetch(c, cur))["rows"].as_array().unwrap().len(), 500);
    ok(&call("close", json!({"connId": c})));
    ok(&call("close", json!({"connId": c})));
    assert_eq!(err_code(&fetch(c, cur)), "connNotFound");
    // connection chính vẫn dùng được
    assert_eq!(rows(&statements(&db.exec("SELECT 6"))[0])[0], json!(["6"]));
}

#[test]
fn many_connections_with_cursors_in_parallel() {
    let db = Db::new();
    let path = db.path.clone();
    let handles: Vec<_> = (0..6)
        .map(|_| {
            let path = path.clone();
            thread::spawn(move || {
                let c = open(&path, false);
                let r = exec(c, &series(3000));
                let st = &statements(&r)[0];
                let mut total = rows(st).len();
                let cur = st["cursorId"].as_u64().unwrap();
                loop {
                    let f = fetch(c, cur);
                    let f = ok(&f);
                    total += f["rows"].as_array().unwrap().len();
                    if f["done"] == true {
                        break;
                    }
                }
                call("close", json!({"connId": c}));
                total
            })
        })
        .collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), 3000);
    }
}

// ---------- hợp đồng JSON ----------

#[test]
fn json_contract_field_names() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a INTEGER)"));

    // rows + cursor
    let r = db.exec(&series(600));
    let st = &statements(&r)[0];
    assert_eq!(
        keys(st),
        set(&[
            "index",
            "sql",
            "kind",
            "columns",
            "rows",
            "cursorId",
            "done",
            "elapsedMs"
        ])
    );
    assert_eq!(keys(&st["columns"][0]), set(&["name", "type"]));
    let cur = st["cursorId"].as_u64().unwrap();

    // fetch
    let f = fetch(db.conn, cur);
    assert_eq!(keys(ok(&f)), set(&["rows", "done"]));

    // rows đã hết: không cursorId, không truncated
    let r = db.exec("SELECT 1");
    assert_eq!(
        keys(&statements(&r)[0]),
        set(&[
            "index",
            "sql",
            "kind",
            "columns",
            "rows",
            "done",
            "elapsedMs"
        ])
    );

    // rows bị cắt (câu không cuối)
    let r = db.exec(&format!("{}; SELECT 1", series(600)));
    assert_eq!(
        keys(&statements(&r)[0]),
        set(&[
            "index",
            "sql",
            "kind",
            "columns",
            "rows",
            "done",
            "truncated",
            "elapsedMs"
        ])
    );

    // affected
    let r = db.exec("INSERT INTO t VALUES(1)");
    assert_eq!(
        keys(&statements(&r)[0]),
        set(&["index", "sql", "kind", "rowsAffected", "elapsedMs"])
    );

    // lỗi của câu
    let r = db.exec("SELECT * FROM nope");
    let st = &statements(&r)[0];
    assert_eq!(
        keys(st),
        set(&["index", "sql", "kind", "elapsedMs", "error"])
    );
    assert_eq!(keys(&st["error"]), set(&["code", "message"]));
    assert_eq!(st["kind"], "affected");

    // response lỗi cấp request
    let r = fetch(db.conn, 424242);
    assert_eq!(keys(&r), set(&["ok", "error"]));
}

// ---------- bổ sung: kiểu ô và escape JSON qua đường đọc C API ----------

#[test]
fn text_needing_json_escape_roundtrips() {
    let db = Db::new();
    // `"`, `\`, xuống dòng, tab, ký tự điều khiển, `/`, U+2028, ký tự ngoài BMP, chữ có dấu tổ hợp.
    let r = db.exec(
        "SELECT '\"', '\\', char(10), char(9), char(13), char(1), char(31), char(127), '/', \
         char(8232), '日本語', '😀', 'e'||char(769), 'it''s', '{\"a\":[1,2]}', '</script>'",
    );
    let st = &statements(&r)[0];
    assert_eq!(
        rows(st)[0],
        json!([
            "\"",
            "\\",
            "\n",
            "\t",
            "\r",
            "\u{1}",
            "\u{1f}",
            "\u{7f}",
            "/",
            "\u{2028}",
            "日本語",
            "😀",
            "e\u{301}",
            "it's",
            "{\"a\":[1,2]}",
            "</script>"
        ])
    );
}

#[test]
fn big_text_cell_roundtrips_in_one_row() {
    let db = Db::new();
    // 524288 byte 0 -> hex 1.048.576 ký tự '0' -> thay bằng 'é' (2 byte UTF-8): ô 2 MiB.
    let r = db.exec("SELECT replace(hex(zeroblob(524288)), '0', 'é')");
    let cell = rows(&statements(&r)[0])[0][0].as_str().unwrap().to_owned();
    assert_eq!(cell.chars().count(), 1_048_576);
    assert!(cell.chars().all(|c| c == 'é'));
}

#[test]
fn real_and_integer_text_forms_through_json() {
    let db = Db::new();
    let r = db.exec(
        "SELECT 5, 5.0, 5e0, 999999999999999.0, 1e15, -1e15, 123456789.125, 1e-7, 0.1+0.2, \
         -0.5, 2.5e-5, 1e22, 0, -0, 0.0",
    );
    let st = &statements(&r)[0];
    assert_eq!(
        rows(st)[0],
        json!([
            "5",
            "5.0",
            "5.0",
            "999999999999999.0",
            "1000000000000000",
            "-1000000000000000",
            "123456789.125",
            "0.0000001",
            "0.30000000000000004",
            "-0.5",
            "0.000025",
            "10000000000000000000000",
            "0",
            "0",
            "0.0"
        ])
    );
}

#[test]
fn blob_every_byte_value_is_lowercase_hex() {
    let db = Db::new();
    let all: String = (0..=255u8).map(|b| format!("{b:02x}")).collect();
    let r = db.exec(&format!("SELECT x'{all}', x'ABCDEF'"));
    let row = &rows(&statements(&r)[0])[0];
    assert_eq!(row[0], json!(format!("0x{all}")));
    assert_eq!(row[1], json!("0xabcdef"));
}

#[test]
fn column_affinity_decides_storage_class_and_decltype() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE a(i INTEGER, r REAL, t TEXT, n NUMERIC, b BLOB); \
         INSERT INTO a VALUES(2.0, 2, 42, '3.0', 'txt'), (NULL, NULL, NULL, NULL, NULL), \
         (7, 7, '007', '007', x'0a')",
    ));
    let r = db.exec("SELECT i, r, t, n, b, i + 1, 'k' FROM a ORDER BY rowid");
    let st = &statements(&r)[0];
    let types: Vec<&str> = st["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["type"].as_str().unwrap())
        .collect();
    // Cột là biểu thức/literal không có kiểu khai báo: decltype rỗng.
    assert_eq!(
        types,
        ["INTEGER", "REAL", "TEXT", "NUMERIC", "BLOB", "", ""]
    );
    assert_eq!(
        rows(st),
        &vec![
            json!(["2", "2.0", "42", "3", "txt", "3", "k"]),
            json!([null, null, null, null, null, null, "k"]),
            json!(["7", "7.0", "007", "7", "0x0a", "8", "k"]),
        ]
    );
}

#[test]
fn column_names_are_kept_as_is() {
    let db = Db::new();
    let r = db.exec("SELECT 1 AS \"we\"\"ird\", 2 AS \"日本\", 3 AS a, 4 AS a");
    let names: Vec<&str> = statements(&r)[0]["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["we\"ird", "日本", "a", "a"]);
}

// ---------- bổ sung: trang dừng ở maxPageBytes / pageSize ----------

/// Tổng byte chuỗi của các ô khác NULL trong một dòng (cùng cách tính của `read_page`).
fn row_bytes(row: &Value) -> usize {
    row.as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .map(str::len)
        .sum()
}

#[test]
fn max_page_bytes_counts_utf8_bytes_of_every_column_and_skips_null() {
    let db = Db::new();
    // Mỗi dòng: 'é' (2 byte) + 12345 (5 byte) + NULL (0) = 7 byte; dừng khi tổng >= ngưỡng.
    let sql = format!("SELECT 'é', 12345, NULL FROM ({})", series(10));
    // Ngưỡng 70 bằng đúng tổng 10 dòng: trang dừng ngay khi chạm ngưỡng nên chưa thấy hết dòng
    // (done = false); chỉ ngưỡng 71 mới đọc tiếp tới lúc `step` báo hết.
    for (max_bytes, expect, done) in [
        (0, 1, false),
        (1, 1, false),
        (7, 1, false),
        (8, 2, false),
        (14, 2, false),
        (15, 3, false),
        (70, 10, false),
        (71, 10, true),
    ] {
        let r = exec_page(db.conn, &sql, PAGE, max_bytes);
        let st = &statements(&r)[0];
        assert_eq!(rows(st).len(), expect, "maxPageBytes={max_bytes}");
        assert_eq!(st["done"], done, "maxPageBytes={max_bytes}");
    }
}

#[test]
fn byte_and_row_limits_never_lose_or_repeat_rows() {
    let db = Db::new();
    // Độ dài dòng tăng dần (x ký tự 'a'), nên trang bị cắt ở các vị trí khác nhau.
    let sql = format!(
        "SELECT x, replace(hex(zeroblob(x)), '0', 'a') FROM ({})",
        series(80)
    );
    // (pageSize, maxPageBytes) lần lượt cho trang đầu rồi các lần fetch (lặp vòng khi hết).
    let limits: [(u64, u64); 5] = [(7, 200), (5, 150), (1, 1), (100, 400), (3, MAX_BYTES)];
    let r = exec_page(db.conn, &sql, limits[0].0, limits[0].1);
    let st = &statements(&r)[0];
    let cur = st["cursorId"].as_u64().unwrap();
    let mut seen: Vec<u64> = Vec::new();
    let mut check_page = |page: &Vec<Value>, done: bool, (size, max): (u64, u64)| {
        assert!(!page.is_empty() || done, "trang rỗng chỉ khi done");
        assert!(page.len() as u64 <= size.max(1));
        let total: usize = page.iter().map(row_bytes).sum();
        if let Some(last) = page.last() {
            // Chỉ dừng khi chạm một trong hai giới hạn (hoặc hết dòng).
            let hit_rows = page.len() as u64 >= size.max(1);
            let hit_bytes = total as u64 >= max;
            assert!(hit_rows || hit_bytes || done, "trang dừng sớm vô cớ");
            // Bỏ dòng cuối thì chưa chạm ngưỡng byte (trừ trang có đúng 1 dòng).
            assert!(
                page.len() == 1 || ((total - row_bytes(last)) as u64) < max,
                "đọc quá ngưỡng byte"
            );
        }
        seen.extend(
            page.iter()
                .map(|r| r[0].as_str().unwrap().parse::<u64>().unwrap()),
        );
    };
    check_page(rows(st), st["done"] == true, limits[0]);
    let mut done = st["done"] == true;
    let mut i = 1;
    while !done {
        let lim = limits[i % limits.len()];
        i += 1;
        let f = fetch_page(db.conn, cur, lim.0, lim.1);
        let f = ok(&f);
        done = f["done"] == true;
        check_page(f["rows"].as_array().unwrap(), done, lim);
    }
    assert_eq!(seen, (1..=80).collect::<Vec<u64>>());
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

#[test]
fn page_size_stop_keeps_cursor_and_next_page_continues() {
    let db = Db::new();
    let r = exec_page(db.conn, &series(10), 4, MAX_BYTES);
    let st = &statements(&r)[0];
    assert_eq!(rows(st).len(), 4);
    assert_eq!(st["done"], false);
    let cur = st["cursorId"].as_u64().unwrap();
    let f = fetch_page(db.conn, cur, 4, MAX_BYTES);
    assert_eq!(ok(&f)["rows"], json!([["5"], ["6"], ["7"], ["8"]]));
    assert_eq!(ok(&f)["done"], false);
    let f = fetch_page(db.conn, cur, 4, MAX_BYTES);
    assert_eq!(ok(&f)["rows"], json!([["9"], ["10"]]));
    assert_eq!(ok(&f)["done"], true);
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
}

// ---------- bổ sung: lỗi runtime giữa lúc đọc dòng ----------

#[test]
fn runtime_error_statement_keeps_index_and_own_sql() {
    let db = Db::new();
    let r = db.exec(&format!(
        "SELECT 1; SELECT 2; {OVERFLOW_AT_ROW_2}; SELECT 4"
    ));
    let st = statements(&r);
    assert_eq!(st.len(), 3);
    assert_eq!(st[2]["index"], 2);
    assert_eq!(st[2]["kind"], "affected");
    assert_eq!(st[2]["sql"], format!("{OVERFLOW_AT_ROW_2};"));
    assert_eq!(st[2]["error"]["code"], "sqlError");
    // Các câu trước lỗi giữ nguyên kết quả.
    assert_eq!(st[0]["rows"], json!([["1"]]));
    assert_eq!(st[1]["rows"], json!([["2"]]));

    // Câu lỗi là câu cuối (không `;`) và câu lỗi đứng sau comment.
    let r = db.exec(&format!("SELECT 1; /* c */ {OVERFLOW_AT_ROW_2}"));
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[1]["sql"], format!("/* c */ {OVERFLOW_AT_ROW_2}"));
    assert_eq!(st[1]["error"]["code"], "sqlError");
}

#[test]
fn syntax_error_after_comment_and_in_last_position() {
    let db = Db::new();
    let r = db.exec("SELECT 1; /* c */ SELEC 2; SELECT 3");
    let st = statements(&r);
    assert_eq!(st.len(), 2);
    assert_eq!(st[1]["sql"], "/* c */ SELEC 2;");
    let r = db.exec("SELECT 1; SELECT 2; SELEC 3");
    let st = statements(&r);
    assert_eq!(st.len(), 3);
    assert_eq!(st[2]["sql"], "SELEC 3");
    assert_eq!(st[2]["error"]["code"], "sqlError");
}

#[test]
fn runtime_error_in_later_page_drops_page_and_cursor() {
    let db = Db::new();
    // Dòng 4 lỗi (abs(INT64_MIN) tràn số).
    let sql = "SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT 2 UNION ALL SELECT 3 \
               UNION ALL SELECT -9223372036854775807-1 UNION ALL SELECT 5)";
    let r = exec_page(db.conn, sql, 2, MAX_BYTES);
    let st = &statements(&r)[0];
    assert_eq!(rows(st), &vec![json!(["1"]), json!(["2"])]);
    let cur = st["cursorId"].as_u64().unwrap();
    let f = fetch_page(db.conn, cur, 3, MAX_BYTES);
    assert_eq!(err_code(&f), "sqlError");
    assert!(
        f["error"]["message"]
            .as_str()
            .unwrap()
            .contains("integer overflow")
    );
    assert!(f.get("result").is_none());
    assert_eq!(err_code(&fetch(db.conn, cur)), "cursorNotFound");
    assert_eq!(rows(&statements(&db.exec("SELECT 9"))[0])[0], json!(["9"]));
}

// ---------- bổ sung: nhiều câu, câu không trả dòng, connection chỉ đọc ----------

#[test]
fn mixed_statements_in_one_script() {
    let db = Db::new();
    let r = db.exec(
        "CREATE TABLE t(a); INSERT INTO t VALUES(1),(2),(3); SELECT a FROM t ORDER BY a; \
         UPDATE t SET a = a * 10 WHERE a < 3; DELETE FROM t WHERE a = 3; \
         SELECT a FROM t ORDER BY a",
    );
    let st = statements(&r);
    let kinds: Vec<&str> = st.iter().map(|s| s["kind"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        [
            "affected", "affected", "rows", "affected", "affected", "rows"
        ]
    );
    assert_eq!(st[0]["rowsAffected"], 0);
    assert_eq!(st[1]["rowsAffected"], 3);
    assert_eq!(st[2]["rows"], json!([["1"], ["2"], ["3"]]));
    assert_eq!(st[3]["rowsAffected"], 2);
    assert_eq!(st[4]["rowsAffected"], 1);
    assert_eq!(st[5]["rows"], json!([["10"], ["20"]]));
    for (i, s) in st.iter().enumerate() {
        assert_eq!(s["index"], i);
        assert!(s.get("error").is_none());
        assert!(s["elapsedMs"].is_number());
    }
    // Câu không cuối đã đọc hết thì không bị đánh dấu cắt, không có cursor.
    assert!(st[2].get("truncated").is_none());
    assert!(st[2].get("cursorId").is_none());
}

#[test]
fn read_only_connection_reads_rows_with_cursor() {
    let db = Db::new();
    ok(&db.exec(&format!("CREATE TABLE t(a); INSERT INTO t {}", series(700))));
    let ro = open(&db.path, true);
    let r = exec_page(ro, "SELECT a FROM t ORDER BY a", 500, MAX_BYTES);
    let st = &statements(&r)[0];
    assert_eq!(rows(st).len(), 500);
    let cur = st["cursorId"].as_u64().unwrap();
    let f = fetch(ro, cur);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 200);
    assert_eq!(ok(&f)["done"], true);
    ok(&call("close", json!({"connId": ro})));
}

// ---------- bổ sung: huỷ ----------

/// Chạy `f` ở thread khác rồi gọi `s3b_cancel(id)` lặp lại tới khi `f` xong.
fn run_and_cancel<T: Send + 'static>(id: u64, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        let v = f();
        let _ = tx.send(());
        v
    });
    while rx.recv_timeout(Duration::from_millis(20)).is_err() {
        cancel(id);
    }
    h.join().unwrap()
}

const INFINITE_ROWS: &str =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c";

#[test]
fn cancel_mid_page_of_last_select_returns_only_cancelled() {
    let db = Db::new();
    let (conn, id) = (db.conn, next_id());
    let sql = format!("SELECT 1; {INFINITE_ROWS}");
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "execute",
            json!({"connId": conn, "sql": sql, "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        )
    });
    // Lỗi cấp request, không trả một phần `statements`; không còn cursor nào.
    assert_eq!(err_code(&r), "cancelled");
    assert_eq!(err_code(&fetch(db.conn, 1)), "cursorNotFound");
    assert_eq!(rows(&statements(&db.exec("SELECT 5"))[0])[0], json!(["5"]));
}

#[test]
fn cancel_mid_page_of_non_last_select_stops_script() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE after_cancel(a)"));
    let (conn, id) = (db.conn, next_id());
    let sql = format!("{INFINITE_ROWS}; INSERT INTO after_cancel VALUES(1)");
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "execute",
            json!({"connId": conn, "sql": sql, "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    // Câu sau câu bị huỷ không chạy.
    let r = db.exec("SELECT count(*) FROM after_cancel");
    assert_eq!(rows(&statements(&r)[0])[0], json!(["0"]));
}

#[test]
fn cancel_table_rows_mid_page_then_new_cursor_works() {
    let db = Db::new();
    ok(&db.exec(&format!("CREATE VIEW inf AS {INFINITE_ROWS}")));
    let (conn, id) = (db.conn, next_id());
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "tableRows",
            json!({"connId": conn, "schema": "main", "table": "inf",
                   "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    // Sau huỷ: cursor mới mở và đọc tiếp bình thường.
    let r = db.exec(&series(1200));
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    assert_eq!(ok(&fetch(db.conn, cur))["rows"][0], json!(["501"]));
}

#[test]
fn stale_cancel_of_finished_execute_keeps_its_cursor_usable() {
    let db = Db::new();
    let id = next_id();
    let r = call_with_id(
        id,
        "execute",
        json!({"connId": db.conn, "sql": series(1200), "pageSize": PAGE, "maxPageBytes": MAX_BYTES}),
    );
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    // Request đã xong: huỷ id cũ không được interrupt cursor đang mở hay đánh dấu huỷ fetch sau.
    for _ in 0..3 {
        cancel(id);
    }
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"][0], json!(["501"]));
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 500);
    let f = fetch(db.conn, cur);
    assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 200);
    assert_eq!(ok(&f)["done"], true);
}

#[test]
fn cancelled_fetch_does_not_affect_next_request_on_same_connection() {
    let db = Db::new();
    let r = db.exec(INFINITE_ROWS);
    let cur = statements(&r)[0]["cursorId"].as_u64().unwrap();
    let (conn, id) = (db.conn, next_id());
    let r = run_and_cancel(id, move || {
        call_with_id(
            id,
            "fetch",
            json!({"connId": conn, "cursorId": cur, "pageSize": 4_000_000_000u64, "maxPageBytes": 4_000_000_000u64}),
        )
    });
    assert_eq!(err_code(&r), "cancelled");
    // Request kế tiếp (id mới) trên cùng connection không bị ảnh hưởng bởi cờ huỷ cũ.
    let r = db.exec(&series(1200));
    let st = &statements(&r)[0];
    assert_eq!(rows(st).len(), 500);
    let cur = st["cursorId"].as_u64().unwrap();
    assert_eq!(
        ok(&fetch(db.conn, cur))["rows"].as_array().unwrap().len(),
        500
    );
}
