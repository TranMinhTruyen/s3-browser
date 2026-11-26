//! Test tích hợp driver PostgreSQL qua 4 hàm FFI, với server thật (`s3b-test-postgres` trong
//! `test-env/`). Không có server thì mỗi test in `SKIP ...` rồi đạt (xem `pg_common`).
//!
//! Mỗi test tự mở connection riêng (và đóng khi kết thúc) nên độc lập thứ tự chạy; bảng tạo ra
//! đều là `temp table` của connection đó.

mod common;
mod pg_common;

use common::*;
use pg_common::*;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn st(r: &Value, i: usize) -> &Value {
    &statements(r)[i]
}

fn code_of(statement: &Value) -> &str {
    statement["error"]["code"].as_str().unwrap_or("")
}

fn message_of(statement: &Value) -> &str {
    statement["error"]["message"].as_str().unwrap_or("")
}

// ---- mở ----

#[test]
fn open_runs_a_query_and_close_makes_the_connection_unknown() {
    let Some(pg) = server("open_runs_a_query") else {
        return;
    };
    let r = pg.open("disable");
    let id = ok(&r)["connId"].as_u64().unwrap();
    assert_eq!(first_cell(&exec(id, "select 1")), "1");
    ok(&call("close", json!({"connId": id})));
    let r = exec(id, "select 1");
    assert_eq!(err_code(&r), "connNotFound");
}

#[test]
fn open_without_database_uses_the_user_name() {
    let Some(pg) = server("open_without_database") else {
        return;
    };
    for over in [json!({"database": null}), json!({"database": ""})] {
        let r = call("open", pg.params_with("disable", over));
        let c = Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
        };
        assert_eq!(c.first("select current_database()"), "postgres");
    }
}

#[test]
fn open_reports_application_name_and_the_chosen_database() {
    let Some(pg) = server("open_reports_application_name") else {
        return;
    };
    let c = pg.conn();
    assert_eq!(c.first("select current_database()"), "s3b");
    assert_eq!(c.first("show application_name"), "S3Browser");
}

#[test]
fn wrong_password_is_open_failed_and_never_leaks_any_password() {
    let Some(pg) = server("wrong_password") else {
        return;
    };
    let wrong = pg.wrong_password();
    let r = call(
        "open",
        pg.params_with("disable", json!({"password": wrong})),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert!(!r.to_string().contains(&wrong), "{r}");
    assert!(!pg.password_leaks_in(&r), "response chứa mật khẩu thật");
}

#[test]
fn missing_password_is_open_failed() {
    let Some(pg) = server("missing_password") else {
        return;
    };
    let r = call("open", pg.params_with("disable", json!({"password": null})));
    assert_eq!(err_code(&r), "openFailed");
    assert!(!pg.password_leaks_in(&r));
}

#[test]
fn wrong_database_is_open_failed_with_the_server_message() {
    let Some(pg) = server("wrong_database") else {
        return;
    };
    let r = call(
        "open",
        pg.params_with("disable", json!({"database": "no_such_db_zz"})),
    );
    assert_eq!(err_code(&r), "openFailed");
    let msg = r["error"]["message"].as_str().unwrap();
    assert!(msg.contains("no_such_db_zz"), "{msg}");
    assert!(!pg.password_leaks_in(&r));
}

#[test]
fn wrong_user_is_open_failed() {
    let Some(pg) = server("wrong_user") else {
        return;
    };
    let r = call(
        "open",
        pg.params_with("disable", json!({"username": "no_such_user_zz"})),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert!(!pg.password_leaks_in(&r));
}

#[test]
fn refused_port_is_open_failed() {
    let Some(pg) = server("refused_port") else {
        return;
    };
    let r = call("open", pg.params_with("disable", json!({"port": 1})));
    assert_eq!(err_code(&r), "openFailed");
    assert!(!pg.password_leaks_in(&r));
}

#[test]
fn unresolvable_host_is_open_failed() {
    let Some(pg) = server("unresolvable_host") else {
        return;
    };
    let r = call(
        "open",
        pg.params_with("disable", json!({"host": "no-such-host.invalid"})),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert!(!pg.password_leaks_in(&r));
}

/// Địa chỉ không định tuyến được: `open` phải trả `openFailed` sau khoảng 10 giây (không treo).
/// Ignore vì chạy ~10 giây và phụ thuộc cách mạng của máy trả lời (có máy báo unreachable ngay).
#[test]
#[ignore = "cần mạng: chờ tới 10 giây, kết quả phụ thuộc môi trường mạng"]
fn connect_timeout_gives_open_failed_within_about_ten_seconds() {
    let Some(pg) = server("connect_timeout") else {
        return;
    };
    let t0 = Instant::now();
    let r = call(
        "open",
        pg.params_with("disable", json!({"host": "10.255.255.1", "port": 5432})),
    );
    let took = t0.elapsed();
    assert_eq!(err_code(&r), "openFailed", "{r}");
    assert!(took < Duration::from_secs(15), "{took:?}");
}

// ---- thực thi ----

#[test]
fn select_returns_columns_rows_and_done() {
    let Some(pg) = server("select_returns_columns") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1 as a, 'x'::text as b, null::int as n");
    let s = st(&r, 0);
    assert_eq!(s["kind"], "rows");
    assert_eq!(s["index"], 0);
    assert_eq!(s["done"], true);
    assert!(s["cursorId"].is_null());
    assert!(s["error"].is_null());
    assert_eq!(s["columns"][0], json!({"name": "a", "type": "int4"}));
    assert_eq!(s["columns"][1], json!({"name": "b", "type": "text"}));
    assert_eq!(s["columns"][2], json!({"name": "n", "type": "int4"}));
    assert_eq!(s["rows"], json!([["1", "x", null]]));
    assert!(s["firstRowMs"].is_u64(), "{s}");
}

#[test]
fn query_without_rows_still_has_columns_and_is_done() {
    let Some(pg) = server("query_without_rows") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1 as a where false");
    let s = st(&r, 0);
    assert_eq!(s["kind"], "rows");
    assert_eq!(s["rows"], json!([]));
    assert_eq!(s["done"], true);
    assert_eq!(s["columns"][0]["name"], "a");
}

#[test]
fn empty_string_and_null_are_different_cells() {
    let Some(pg) = server("empty_string_and_null") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select '', null::text, ' '");
    assert_eq!(st(&r, 0)["rows"], json!([["", null, " "]]));
}

#[test]
fn dml_and_ddl_report_rows_affected() {
    let Some(pg) = server("dml_and_ddl") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("create temp table t_aff(a int)");
    assert_eq!(st(&r, 0)["kind"], "affected");
    assert_eq!(st(&r, 0)["rowsAffected"], 0);
    let r = c.exec("insert into t_aff select x from generate_series(1,5) x");
    assert_eq!(st(&r, 0)["rowsAffected"], 5);
    let r = c.exec("update t_aff set a = a + 1 where a <= 2");
    assert_eq!(st(&r, 0)["rowsAffected"], 2);
    // Sau UPDATE: 2, 3, 3, 4, 5.
    let r = c.exec("delete from t_aff where a > 3");
    assert_eq!(st(&r, 0)["rowsAffected"], 2);
    let r = c.exec("delete from t_aff where false");
    assert_eq!(st(&r, 0)["rowsAffected"], 0);
    assert_eq!(c.first("select count(*) from t_aff"), "3");
}

#[test]
fn insert_returning_gives_rows() {
    let Some(pg) = server("insert_returning") else {
        return;
    };
    let c = pg.conn();
    c.exec("create temp table t_ret(a int, b text)");
    let r = c.exec("insert into t_ret values (1,'x'),(2,null) returning a, b");
    let s = st(&r, 0);
    assert_eq!(s["kind"], "rows");
    assert_eq!(s["rows"], json!([["1", "x"], ["2", null]]));
}

#[test]
fn sql_error_is_in_the_statement_not_the_request() {
    let Some(pg) = server("sql_error_is_in_the_statement") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select * from no_such_table_zz");
    let s = st(&r, 0);
    assert_eq!(code_of(s), "sqlError");
    assert!(message_of(s).contains("no_such_table_zz"), "{s}");
    assert_eq!(s["index"], 0);
    // Connection vẫn dùng được sau lỗi.
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn runtime_error_in_a_statement_is_a_statement_error() {
    let Some(pg) = server("runtime_error") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1/0");
    assert_eq!(code_of(st(&r, 0)), "sqlError");
    assert!(message_of(st(&r, 0)).contains("division by zero"), "{r}");
    let r = c.exec("select 'abc'::int");
    assert_eq!(code_of(st(&r, 0)), "sqlError");
    let r = c.exec("create temp table t_dup(a int primary key); insert into t_dup values (1),(1)");
    assert_eq!(statements(&r).len(), 2);
    assert!(message_of(st(&r, 1)).contains("duplicate key"), "{r}");
}

#[test]
fn script_runs_in_order_and_stops_at_the_first_error() {
    let Some(pg) = server("script_runs_in_order") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec(
        "create temp table z(a int); insert into z values (1),(2); select * from z order by a; \
         select * from no_such_table_zz; select 99",
    );
    let all = statements(&r);
    assert_eq!(all.len(), 4, "câu sau lỗi không được chạy: {r}");
    assert_eq!(all[0]["kind"], "affected");
    assert_eq!(all[1]["rowsAffected"], 2);
    assert_eq!(all[2]["rows"], json!([["1"], ["2"]]));
    assert_eq!(code_of(&all[3]), "sqlError");
    for (i, s) in all.iter().enumerate() {
        assert_eq!(s["index"], i);
    }
}

#[test]
fn empty_or_comment_only_script_has_no_statements() {
    let Some(pg) = server("empty_or_comment_only") else {
        return;
    };
    let c = pg.conn();
    for sql in ["", "   ", "-- only a comment", "/* block */", ";", " ; ; "] {
        let r = c.exec(sql);
        assert_eq!(ok(&r)["statements"], json!([]), "{sql:?}");
    }
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn empty_statements_between_semicolons_are_skipped() {
    let Some(pg) = server("empty_statements") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1; ; select 2;");
    assert_eq!(statements(&r).len(), 2);
    assert_eq!(st(&r, 1)["rows"], json!([["2"]]));
}

#[test]
fn splitter_respects_dollar_quotes_strings_and_comments() {
    let Some(pg) = server("splitter") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select $$a;b$$; select 'x;y' -- c; d\n; select 3 /* ; */");
    let all = statements(&r);
    assert_eq!(all.len(), 3, "{r}");
    assert_eq!(all[0]["rows"], json!([["a;b"]]));
    assert_eq!(all[1]["rows"], json!([["x;y"]]));
    assert_eq!(all[2]["rows"], json!([["3"]]));
}

#[test]
fn show_values_and_explain_are_rows() {
    let Some(pg) = server("show_values_explain") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("show server_version_num; values (1,'a'),(2,'b'); explain select 1");
    let all = statements(&r);
    assert_eq!(all.len(), 3);
    assert!(
        all[0]["rows"][0][0]
            .as_str()
            .unwrap()
            .parse::<u32>()
            .is_ok()
    );
    assert_eq!(all[1]["rows"], json!([["1", "a"], ["2", "b"]]));
    assert_eq!(all[2]["kind"], "rows");
}

#[test]
fn set_and_transaction_commands_are_affected_with_zero() {
    let Some(pg) = server("set_and_transaction") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("set timezone = 'UTC'; begin; commit");
    for s in statements(&r) {
        assert_eq!(s["kind"], "affected", "{s}");
        assert_eq!(s["rowsAffected"], 0);
    }
}

#[test]
fn notify_and_listen_do_not_break_the_connection() {
    let Some(pg) = server("notify_and_listen") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("listen ch_zz; notify ch_zz; select pg_notify('ch_zz','b'), 1");
    assert_eq!(statements(&r).len(), 3, "{r}");
    assert_eq!(c.first("select 5"), "5");
}

// ---- phân trang ----

#[test]
fn paging_fetches_every_row_exactly_once() {
    let Some(pg) = server("paging_fetches_every_row") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(&series_pg(1200), 500, MAX_BYTES);
    let s = st(&r, 0);
    assert_eq!(s["rows"].as_array().unwrap().len(), 500);
    assert_eq!(s["done"], false);
    assert!(s["truncated"].is_null());
    let cursor = s["cursorId"].as_u64().unwrap();
    assert_eq!(s["rows"][0], json!(["1", "row 1"]));

    let f = c.fetch_page(cursor, 500, MAX_BYTES);
    let p2 = ok(&f);
    assert_eq!(p2["rows"].as_array().unwrap().len(), 500);
    assert_eq!(p2["done"], false);
    assert_eq!(p2["rows"][0], json!(["501", "row 501"]));

    let f = c.fetch_page(cursor, 500, MAX_BYTES);
    let p3 = ok(&f);
    assert_eq!(p3["rows"].as_array().unwrap().len(), 200);
    assert_eq!(p3["done"], true);
    assert_eq!(p3["rows"][199], json!(["1200", "row 1200"]));

    // Cursor hết dòng thì bị bỏ.
    assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn exact_page_size_result_gives_a_cursor_then_an_empty_done_page() {
    let Some(pg) = server("exact_page_size") else {
        return;
    };
    let c = pg.conn();
    // Giống SQLite: trang vừa đầy thì chưa biết hết dòng, trang kế rỗng và `done`.
    let r = c.exec_page(&series_pg(10), 10, MAX_BYTES);
    let s = st(&r, 0);
    assert_eq!(s["rows"].as_array().unwrap().len(), 10);
    assert_eq!(s["done"], false, "{s}");
    let cursor = s["cursorId"].as_u64().unwrap();
    let f = c.fetch_page(cursor, 10, MAX_BYTES);
    assert_eq!(ok(&f)["rows"], json!([]));
    assert_eq!(ok(&f)["done"], true);
    assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
}

#[test]
fn page_size_larger_than_the_result_is_done() {
    let Some(pg) = server("page_size_larger") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(&series_pg(3), 500, MAX_BYTES);
    assert_eq!(st(&r, 0)["done"], true);
    assert_eq!(row_count(&r, 0), 3);
}

#[test]
fn max_page_bytes_limits_the_page() {
    let Some(pg) = server("max_page_bytes") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(&series_pg(1000), 1000, 2000);
    let s = st(&r, 0);
    let n = s["rows"].as_array().unwrap().len();
    assert!(n > 0 && n < 1000, "{n}");
    assert_eq!(s["done"], false);
    let cursor = s["cursorId"].as_u64().unwrap();
    // Lấy hết phần còn lại: đủ 1000 dòng, không mất không trùng.
    let mut total = n;
    loop {
        let f = c.fetch_page(cursor, 1000, 2000);
        let page = ok(&f);
        total += page["rows"].as_array().unwrap().len();
        if page["done"] == true {
            break;
        }
    }
    assert_eq!(total, 1000);
}

#[test]
fn non_last_statement_with_more_rows_is_truncated_and_the_last_keeps_the_cursor() {
    let Some(pg) = server("truncated_non_last") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(
        &format!("{}; {}", series_pg(900), series_pg(700)),
        100,
        MAX_BYTES,
    );
    let first = st(&r, 0);
    assert_eq!(first["truncated"], true, "{first}");
    assert_eq!(first["done"], false);
    assert!(first["cursorId"].is_null());
    assert_eq!(first["rows"].as_array().unwrap().len(), 100);
    let last = st(&r, 1);
    assert_eq!(last["done"], false);
    let cursor = last["cursorId"].as_u64().unwrap();
    assert_eq!(
        ok(&c.fetch_page(cursor, 100, MAX_BYTES))["rows"][0][0],
        "101"
    );
}

#[test]
fn fetch_with_unknown_cursor_or_connection_has_stable_codes() {
    let Some(pg) = server("fetch_unknown") else {
        return;
    };
    let c = pg.conn();
    assert_eq!(err_code(&c.fetch(987_654_321)), "cursorNotFound");
    assert_eq!(err_code(&fetch(987_654_321, 1)), "connNotFound");
    assert_eq!(err_code(&exec(987_654_321, "select 1")), "connNotFound");
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn a_new_execute_drops_the_previous_cursor() {
    let Some(pg) = server("new_execute_drops_cursor") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(&series_pg(1000), 10, MAX_BYTES);
    let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
    assert_eq!(c.first("select 2"), "2");
    assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
}

#[test]
fn error_in_the_middle_of_a_fetch_is_reported_and_the_connection_survives() {
    let Some(pg) = server("error_mid_fetch") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(
        "select 10/(x-700) from generate_series(1,1000) x",
        100,
        MAX_BYTES,
    );
    let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
    let mut failure = None;
    for _ in 0..20 {
        let f = c.fetch_page(cursor, 100, MAX_BYTES);
        if f["ok"] != true {
            failure = Some(f);
            break;
        }
        assert_eq!(
            f["result"]["done"], false,
            "lỗi phải tới trước khi hết dòng"
        );
    }
    let f = failure.expect("fetch phải gặp division by zero");
    assert_eq!(err_code(&f), "sqlError");
    assert!(
        f["error"]["message"]
            .as_str()
            .unwrap()
            .contains("division by zero"),
        "{f}"
    );
    // Cursor đã bị bỏ, connection dùng tiếp được.
    assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn close_with_an_open_cursor_succeeds() {
    let Some(pg) = server("close_with_cursor") else {
        return;
    };
    let r = pg.open("disable");
    let id = ok(&r)["connId"].as_u64().unwrap();
    let r = exec_page(
        id,
        "select * from generate_series(1,5000000) x",
        10,
        MAX_BYTES,
    );
    assert_eq!(st(&r, 0)["done"], false);
    ok(&call("close", json!({"connId": id})));
    assert_eq!(err_code(&fetch(id, 1)), "connNotFound");
}

// ---- COPY ----

#[test]
fn copy_is_blocked_with_a_statement_error_and_the_connection_stays_usable() {
    let Some(pg) = server("copy_is_blocked") else {
        return;
    };
    let c = pg.conn();
    c.exec("create temp table cz(a int)");
    for sql in [
        "copy (select 1) to stdout",
        "COPY cz FROM stdin",
        "-- c\n copy cz to stdout",
    ] {
        let r = c.exec(sql);
        assert_eq!(statements(&r).len(), 1, "{sql}");
        assert_eq!(code_of(st(&r, 0)), "sqlError", "{sql}");
        assert_eq!(message_of(st(&r, 0)), "COPY is not supported", "{sql}");
        assert_eq!(c.first("select 11"), "11", "sau {sql}");
    }
}

#[test]
fn copy_in_a_script_stops_the_script_there() {
    let Some(pg) = server("copy_in_a_script") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1; copy (select 1) to stdout; select 3");
    let all = statements(&r);
    assert_eq!(all.len(), 2, "{r}");
    assert_eq!(all[0]["rows"], json!([["1"]]));
    assert_eq!(message_of(&all[1]), "COPY is not supported");
    assert_eq!(c.first("select 4"), "4");
}

// ---- huỷ ----

/// Huỷ `sql` (chứa `marker`) khi nó đã chạy ở server: phải ra `cancelled` nhanh và connection
/// `c` dùng tiếp được.
fn assert_cancelled_quickly_and_usable(pg: &Server, c: &Conn, sql: &str, marker: &str) {
    let monitor = pg.conn();
    let id = next_id();
    let t = c.exec_in_thread(id, sql);
    wait_until_active(&monitor, marker);
    let t0 = Instant::now();
    cancel(id);
    let r = t.join().unwrap();
    assert_eq!(err_code(&r), "cancelled", "{r}");
    assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    assert_eq!(
        c.first("select 1"),
        "1",
        "connection phải dùng được sau khi huỷ"
    );
}

#[test]
fn cancel_a_running_binary_query_returns_cancelled() {
    let Some(pg) = server("cancel_binary") else {
        return;
    };
    let c = pg.conn();
    let m = marker("cb");
    // Cột int4 + text: đọc nhị phân.
    let sql = format!("select 1 as x, '{m}' as m from pg_sleep(30)");
    assert_cancelled_quickly_and_usable(&pg, &c, &sql, &m);
}

#[test]
fn cancel_a_running_simple_query_returns_cancelled() {
    let Some(pg) = server("cancel_simple") else {
        return;
    };
    let c = pg.conn();
    let m = marker("cs");
    // Cột `void` và `money` ngoài danh sách: chạy bằng simple query.
    let sql = format!("select pg_sleep(30), 1::money, '{m}'");
    assert_cancelled_quickly_and_usable(&pg, &c, &sql, &m);
}

#[test]
fn cancel_in_a_script_stops_the_whole_request() {
    let Some(pg) = server("cancel_in_a_script") else {
        return;
    };
    let c = pg.conn();
    let m = marker("cscript");
    let sql = format!("select 1; select 1 as x, '{m}' as m from pg_sleep(30); select 3");
    assert_cancelled_quickly_and_usable(&pg, &c, &sql, &m);
}

#[test]
fn cancel_repeatedly_never_leaves_the_connection_broken() {
    let Some(pg) = server("cancel_repeatedly") else {
        return;
    };
    let c = pg.conn();
    for i in 0..8 {
        let m = marker(&format!("loop{i}"));
        let sql = format!("select 1 as x, '{m}' as m from pg_sleep(30)");
        assert_cancelled_quickly_and_usable(&pg, &c, &sql, &m);
    }
    // Lần huỷ nào cũng không để sót yêu cầu huỷ làm hỏng câu sau.
    for i in 0..20 {
        assert_eq!(c.first(&format!("select {i}")), i.to_string());
    }
}

#[test]
fn cancel_after_the_request_finished_does_not_touch_the_next_one() {
    let Some(pg) = server("cancel_after_finished") else {
        return;
    };
    let c = pg.conn();
    let id = next_id();
    let r = call_with_id(
        id,
        "execute",
        json!({"connId": c.id, "sql": "select 1", "pageSize": 10, "maxPageBytes": MAX_BYTES}),
    );
    assert_eq!(first_cell(&r), "1");
    cancel(id);
    let r = c.exec("select pg_sleep(0.2), 7");
    assert_eq!(st(&r, 0)["rows"][0][1], "7", "{r}");
}

#[test]
fn cancel_of_an_unknown_request_id_is_harmless() {
    let Some(pg) = server("cancel_unknown_id") else {
        return;
    };
    let c = pg.conn();
    cancel(next_id());
    assert_eq!(c.first("select 1"), "1");
}

#[test]
fn cancel_inside_a_transaction_aborts_it_but_rollback_recovers() {
    let Some(pg) = server("cancel_in_transaction") else {
        return;
    };
    let c = pg.conn();
    ok(&c.exec("begin"));
    let m = marker("ctx");
    let monitor = pg.conn();
    let id = next_id();
    let t = c.exec_in_thread(id, &format!("select 1 as x, '{m}' as m from pg_sleep(30)"));
    wait_until_active(&monitor, &m);
    cancel(id);
    assert_eq!(err_code(&t.join().unwrap()), "cancelled");
    // Server đánh dấu transaction là aborted: `rollback` phải chạy được rồi mọi thứ bình thường.
    let r = c.exec("rollback");
    assert_eq!(st(&r, 0)["kind"], "affected", "{r}");
    assert_eq!(c.first("select 1"), "1");
}

// ---- bỏ cursor ----

/// `n` dòng mà server chỉ trả mỗi dòng sau ~10 ms (cột bool nên đọc nhị phân). Câu còn chạy ở
/// server lúc cursor bị bỏ, nên cancel (hoặc đọc bỏ) có tác dụng thật chứ không phụ thuộc may rủi
/// việc server đã gửi xong chưa.
fn slow_rows(n: u32) -> String {
    format!("select x, (pg_sleep(0.01) is not null) as s from generate_series(1,{n}) x")
}

#[test]
fn abandoning_a_read_cursor_cancels_it_without_a_canceling_statement_error() {
    let Some(pg) = server("abandon_read_cursor") else {
        return;
    };
    let c = pg.conn();
    // 100.000 dòng x 10 ms = hơn 16 phút nếu phải đọc hết: chỉ nhanh khi câu bị huỷ phía server.
    for i in 0..3 {
        let r = c.exec_page(&slow_rows(100_000), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false, "{r}");
        let t0 = Instant::now();
        let r = c.exec(&format!("select {i}"));
        assert_eq!(first_cell(&r), i.to_string(), "{r}");
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    }
}

#[test]
fn abandoning_a_big_cursor_gives_no_canceling_statement_error() {
    let Some(pg) = server("abandon_big_cursor") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page("select * from generate_series(1,5000000) x", 10, MAX_BYTES);
    assert_eq!(st(&r, 0)["done"], false);
    let t0 = Instant::now();
    let r = c.exec("select 7");
    assert_eq!(first_cell(&r), "7", "{r}");
    assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    // Không còn lỗi "canceling statement due to user request" nằm chờ ở câu sau.
    for i in 0..5 {
        let r = c.exec_page("select * from generate_series(1,2000000) x", 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        assert_eq!(c.first(&format!("select {i}")), i.to_string());
    }
}

#[test]
fn abandoning_a_write_returning_cursor_still_applies_the_write() {
    let Some(pg) = server("abandon_write_returning") else {
        return;
    };
    let c = pg.conn();
    c.exec("create temp table t_w(a int)");
    // INSERT ... RETURNING không an toàn để huỷ: bỏ cursor chỉ đọc bỏ (~3 giây), không rollback
    // câu ghi. Nếu bị huỷ giữa chừng thì cả câu INSERT rollback và `count` ra 0.
    let r = c.exec_page(
        "insert into t_w select x from generate_series(1,300) x          where pg_sleep(0.01) is not null returning a",
        10,
        MAX_BYTES,
    );
    assert_eq!(st(&r, 0)["done"], false, "{r}");
    assert_eq!(c.first("select count(*) from t_w"), "300");
}

#[test]
fn abandoning_a_cursor_inside_a_transaction_keeps_the_transaction_alive() {
    let Some(pg) = server("abandon_in_transaction") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec_page(
        &format!("begin; create temp table t_tx(a int); {}", slow_rows(300)),
        10,
        MAX_BYTES,
    );
    assert_eq!(st(&r, 2)["done"], false, "{r}");
    // Câu kế bỏ cursor: nếu bị huỷ phía server thì transaction thành aborted và câu này lỗi.
    let r = c.exec("select 42");
    assert_eq!(first_cell(&r), "42", "{r}");
    // `rollback` huỷ luôn bảng tạm trong transaction => transaction vẫn còn sống tới lúc đó.
    ok(&c.exec("rollback"));
    let r = c.exec("select count(*) from t_tx");
    assert_eq!(code_of(st(&r, 0)), "sqlError", "{r}");
    assert!(message_of(st(&r, 0)).contains("t_tx"), "{r}");
}

#[test]
fn transaction_with_commit_persists_after_an_abandoned_cursor() {
    let Some(pg) = server("abandon_then_commit") else {
        return;
    };
    let c = pg.conn();
    c.exec("create temp table t_c(a int)");
    c.exec("begin");
    c.exec("insert into t_c values (1)");
    let r = c.exec_page(&slow_rows(300), 10, MAX_BYTES);
    assert_eq!(st(&r, 0)["done"], false);
    assert_eq!(c.first("select count(*) from t_c"), "1");
    ok(&c.exec("commit"));
    assert_eq!(c.first("select count(*) from t_c"), "1");
}

#[test]
fn rollback_work_to_savepoint_does_not_make_abandon_abort_the_transaction() {
    let Some(pg) = server("rollback_work_to_savepoint") else {
        return;
    };
    let c = pg.conn();
    for rollback in [
        "rollback work to savepoint s1",
        "rollback transaction to savepoint s1",
    ] {
        let r = c.exec_page(
            // 300 dòng (~3 giây): bỏ cursor trong transaction còn mở phải đọc bỏ hết số dòng này.
            &format!("begin; savepoint s1; {rollback}; {}", slow_rows(300)),
            10,
            MAX_BYTES,
        );
        assert_eq!(st(&r, 3)["done"], false, "{r}");
        // Bỏ cursor: theo đúng thì transaction còn sống nên không được huỷ câu phía server.
        let r = c.exec("select 1");
        assert_eq!(first_cell(&r), "1", "{rollback}: transaction bị abort: {r}");
        ok(&c.exec("rollback"));
    }
}

// ---- kiểu dữ liệu ----

#[test]
fn timestamptz_is_always_printed_in_utc_with_plus_zero() {
    let Some(pg) = server("timestamptz_utc") else {
        return;
    };
    let c = pg.conn();
    assert_eq!(
        c.first("select timestamptz '2020-01-01 07:00:00+07'"),
        "2020-01-01 00:00:00+00"
    );
    assert_eq!(
        c.first("select timestamptz '2020-01-01 00:30:00+07'"),
        "2019-12-31 17:30:00+00"
    );
    assert_eq!(
        c.first("select timestamptz '2020-06-15 12:34:56.789+00'"),
        "2020-06-15 12:34:56.789+00"
    );
    ok(&c.exec("set timezone = 'Asia/Ho_Chi_Minh'"));
    assert_eq!(
        c.first("select timestamptz '2020-01-01 00:00:00+00'"),
        "2020-01-01 00:00:00+00"
    );
    // timestamp không múi giờ giữ nguyên, không đổi theo session.
    assert_eq!(
        c.first("select timestamp '2020-01-01 00:00:00'"),
        "2020-01-01 00:00:00"
    );
}

#[test]
fn types_outside_the_allow_list_run_through_simple_query_with_the_same_shape() {
    let Some(pg) = server("types_outside_allow_list") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec(
        "select 12.5::money as mo, '(1,2)'::point as pt, to_tsvector('simple', 'a b') as ts, \
         '[1,5)'::int4range as rg, 7 as n",
    );
    let s = st(&r, 0);
    let names: Vec<&str> = s["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["mo", "pt", "ts", "rg", "n"]);
    let types: Vec<&str> = s["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["type"].as_str().unwrap())
        .collect();
    assert_eq!(types, ["money", "point", "tsvector", "int4range", "int4"]);
    assert_eq!(
        s["rows"],
        json!([["$12.50", "(1,2)", "'a':1 'b':2", "[1,5)", "7"]])
    );
    // Cả câu chạy bằng simple query vẫn phân trang đúng.
    let r = c.exec_page(
        "select x, x::money from generate_series(1,30) x",
        10,
        MAX_BYTES,
    );
    let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
    assert_eq!(ok(&c.fetch_page(cursor, 10, MAX_BYTES))["rows"][0][0], "11");
}

#[test]
fn common_types_have_the_expected_text() {
    let Some(pg) = server("common_types") else {
        return;
    };
    let c = pg.conn();
    let cases = [
        ("1::int2", "1"),
        ("(-2147483648)::int4", "-2147483648"),
        ("9223372036854775807::int8", "9223372036854775807"),
        ("123.4500::numeric", "123.4500"),
        ("'NaN'::numeric", "NaN"),
        ("true", "t"),
        ("false", "f"),
        ("'\\xdeadbeef'::bytea", "\\xdeadbeef"),
        (
            "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid",
            "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        ),
        ("'{\"a\": [1, 2]}'::jsonb", "{\"a\": [1, 2]}"),
        ("'{\"a\":1}'::json", "{\"a\":1}"),
        ("date '2020-02-29'", "2020-02-29"),
        ("time '12:34:56'", "12:34:56"),
        ("interval '1 day 02:03:04'", "1 day 02:03:04"),
        ("'10.0.0.1/24'::inet", "10.0.0.1/24"),
        ("'08:00:2b:01:02:03'::macaddr", "08:00:2b:01:02:03"),
        ("ARRAY[1,2,3]", "{1,2,3}"),
        ("ARRAY['a',NULL,'b c']", "{a,NULL,\"b c\"}"),
        ("'héllo 日本語'::text", "héllo 日本語"),
        ("1.5::float8", "1.5"),
        ("0.1::float4", "0.1"),
        ("'Infinity'::float8", "Infinity"),
    ];
    for (expr, want) in cases {
        assert_eq!(c.first(&format!("select {expr}")), want, "{expr}");
    }
    assert_eq!(c.first("select null::int8"), Value::Null);
    assert_eq!(c.first("select null::int[]"), Value::Null);
}

#[test]
fn large_text_and_many_columns_round_trip() {
    let Some(pg) = server("large_text_and_many_columns") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select repeat('é', 100000) as big");
    let cell = st(&r, 0)["rows"][0][0].as_str().unwrap();
    assert_eq!(cell.chars().count(), 100_000);
    let cols: Vec<String> = (0..120).map(|i| format!("{i} as c{i}")).collect();
    let r = c.exec(&format!("select {}", cols.join(", ")));
    assert_eq!(st(&r, 0)["columns"].as_array().unwrap().len(), 120);
    assert_eq!(st(&r, 0)["rows"][0][119], "119");
}

#[test]
fn duplicate_column_names_and_unnamed_columns_are_kept() {
    let Some(pg) = server("duplicate_column_names") else {
        return;
    };
    let c = pg.conn();
    let r = c.exec("select 1 as a, 2 as a, 3");
    let cols = &st(&r, 0)["columns"];
    assert_eq!(cols[0]["name"], "a");
    assert_eq!(cols[1]["name"], "a");
    assert_eq!(cols[2]["name"], "?column?");
    assert_eq!(st(&r, 0)["rows"], json!([["1", "2", "3"]]));
}

// ---- nhiều kết nối ----

#[test]
fn connections_are_isolated_from_each_other() {
    let Some(pg) = server("connections_are_isolated") else {
        return;
    };
    let (a, b) = (pg.conn(), pg.conn());
    assert_ne!(a.id, b.id);
    a.exec("create temp table only_a(x int)");
    let r = b.exec("select * from only_a");
    assert_eq!(code_of(st(&r, 0)), "sqlError");
    assert_eq!(a.first("select count(*) from only_a"), "0");
    // Đóng một connection không ảnh hưởng connection kia.
    drop(a);
    assert_eq!(b.first("select 1"), "1");
}

#[test]
fn many_connections_can_run_concurrently() {
    let Some(pg) = server("many_connections") else {
        return;
    };
    let conns: Vec<Conn> = (0..6).map(|_| pg.conn()).collect();
    let handles: Vec<_> = conns
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let id = c.id;
            std::thread::spawn(move || {
                let r = exec(id, &format!("select pg_sleep(0.1), {i}"));
                st(&r, 0)["rows"][0][1].as_str().unwrap().to_owned()
            })
        })
        .collect();
    for (i, h) in handles.into_iter().enumerate() {
        assert_eq!(h.join().unwrap(), i.to_string());
    }
}
