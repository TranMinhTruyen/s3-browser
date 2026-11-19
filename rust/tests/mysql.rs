//! Test tích hợp driver MySQL và MariaDB qua 4 hàm FFI, với server thật (`s3b-test-mysql` 8.4,
//! `s3b-test-mariadb` 11.4 trong `test-env/`). Mỗi test chạy cho cả hai server (macro `both!` sinh
//! `<tên>::mysql` và `<tên>::mariadb`); không có server thì test in `SKIP ...` rồi đạt (xem
//! `my_common`).
//!
//! Mỗi test tự mở connection riêng (và đóng khi kết thúc) nên độc lập thứ tự chạy; bảng tạo ra
//! đều là `temporary table` của connection đó.

mod common;
mod my_common;

use common::*;
use my_common::*;
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

/// Mọi `type` của cột trong một statement.
fn types(statement: &Value) -> Vec<String> {
    statement["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["type"].as_str().unwrap().to_owned())
        .collect()
}

/// Nguồn dòng chạy chậm: `1000 x 1000` dòng, mỗi dòng đợi ~10 ms ở server. Câu còn chạy khi cursor
/// bị bỏ nên cancel (hoặc đọc bỏ) có tác dụng thật; `marker` để biết câu có còn ở server không.
fn slow_rows(marker: &str) -> String {
    format!(
        "with recursive c(x) as (select 1 union all select x+1 from c where x<1000) \
         select a.x, sleep(0.01) as s, '{marker}' as m from c a, c b"
    )
}

/// Nguồn dòng khổng lồ chạy ngay (không chờ): tích Descartes của 3 bảng dẫn xuất 500 dòng
/// (125 triệu dòng, đọc thẳng từ server không dừng để chuẩn bị).
fn endless_rows(marker: &str) -> String {
    format!(
        "with recursive c(x) as (select 1 union all select x+1 from c where x<500)          select a.x, '{marker}' as m from c a, c b, c d"
    )
}

/// Không còn câu nào chứa `marker` chạy ở server (do connection khác nhìn vào), tối đa 10 s.
fn wait_until_gone(monitor: &Conn, marker: &str) {
    let sql = format!(
        "select count(*) from information_schema.processlist where command = 'Query' \
         and id <> connection_id() and info like '%{marker}%'"
    );
    wait_for(Duration::from_secs(10), marker, || {
        monitor.first(&sql) == "0"
    });
}

/// Huỷ `sql` (chứa `marker`) khi nó đã chạy ở server: phải ra `cancelled` nhanh và connection
/// `c` dùng tiếp được.
fn assert_cancelled_quickly_and_usable(s: &Server, c: &Conn, sql: &str, marker: &str) {
    let monitor = s.conn();
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

both! {
    // ---- open ----

    fn open_runs_a_query_and_close_makes_the_connection_unknown(s: &Server) {
        let r = s.open("disable");
        let id = ok(&r)["connId"].as_u64().unwrap();
        assert_eq!(first_cell(&exec(id, "select 1")), "1");
        ok(&call("close", json!({"connId": id})));
        let r = exec(id, "select 1");
        assert_eq!(err_code(&r), "connNotFound");
    }

    fn open_selects_the_database_and_sets_the_long_write_timeout(s: &Server) {
        let c = s.conn();
        assert_eq!(c.first("select database()"), "s3b");
        // Câu INIT: server không ngắt cursor nằm yên lâu giữa hai lần fetch.
        assert_eq!(c.first("select @@session.net_write_timeout"), "3600");
    }

    fn open_without_database_selects_none(s: &Server) {
        for over in [json!({"database": null}), json!({"database": ""})] {
            let c = s.conn_with("disable", over);
            assert_eq!(c.first("select database()"), Value::Null);
            // Chọn DB sau đó bằng USE.
            ok(&c.exec("use s3b"));
            assert_eq!(c.first("select database()"), "s3b");
        }
    }

    fn close_removes_the_thread_from_the_server(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let tid = c.thread_id();
        assert!(thread_exists(&monitor, &tid));
        drop(c);
        wait_for(Duration::from_secs(10), "thread đóng", || {
            !thread_exists(&monitor, &tid)
        });
    }

    fn wrong_password_is_open_failed_1045_and_never_leaks_any_password(s: &Server) {
        let wrong = s.wrong_password();
        let r = call(
            "open",
            s.params_with("disable", json!({"password": wrong})),
        );
        assert_eq!(err_code(&r), "openFailed");
        let msg = r["error"]["message"].as_str().unwrap();
        assert!(msg.starts_with("ERROR 1045"), "{msg}");
        assert!(!r.to_string().contains(&wrong), "{r}");
        assert!(!s.password_leaks_in(&r), "response chứa mật khẩu thật");
    }

    fn missing_password_is_open_failed(s: &Server) {
        let r = call("open", s.params_with("disable", json!({"password": null})));
        assert_eq!(err_code(&r), "openFailed");
        assert!(!s.password_leaks_in(&r));
    }

    fn wrong_database_is_open_failed_1049(s: &Server) {
        let r = call(
            "open",
            s.params_with("disable", json!({"database": "no_such_db_zz"})),
        );
        assert_eq!(err_code(&r), "openFailed");
        let msg = r["error"]["message"].as_str().unwrap();
        assert!(msg.starts_with("ERROR 1049"), "{msg}");
        assert!(msg.contains("no_such_db_zz"), "{msg}");
        assert!(!s.password_leaks_in(&r));
    }

    fn wrong_user_is_open_failed(s: &Server) {
        let r = call(
            "open",
            s.params_with("disable", json!({"username": "no_such_user_zz"})),
        );
        assert_eq!(err_code(&r), "openFailed");
        let msg = r["error"]["message"].as_str().unwrap();
        if s.is_mariadb() {
            assert!(msg.starts_with("ERROR 1045"), "{msg}");
        } else {
            // MySQL 8.4 với user không tồn tại đòi đổi sang plugin `sha256_password` mà driver
            // không hỗ trợ, nên không có `ERROR 1045` (xem báo cáo, mục Lỗi cho rust-native).
            assert!(
                msg.starts_with("ERROR 1045") || msg.contains("sha256_password"),
                "{msg}"
            );
        }
        assert!(!s.password_leaks_in(&r));
    }

    fn refused_port_is_open_failed(s: &Server) {
        let r = call("open", s.params_with("disable", json!({"port": 1})));
        assert_eq!(err_code(&r), "openFailed");
        // `Error::Io` đã có tiền tố "Input/output error:"; không lặp lại.
        let msg = r["error"]["message"].as_str().unwrap();
        assert_eq!(msg.matches("Input/output error").count(), 1, "{msg}");
        assert!(!s.password_leaks_in(&r));
    }

    fn unresolvable_host_is_open_failed(s: &Server) {
        let r = call(
            "open",
            s.params_with("disable", json!({"host": "no-such-host.invalid"})),
        );
        assert_eq!(err_code(&r), "openFailed");
        assert!(!s.password_leaks_in(&r));
    }

    /// Địa chỉ không định tuyến được: `open` phải trả `openFailed` sau khoảng 10 giây (không treo).
    /// Ignore vì chạy ~10 giây và phụ thuộc cách mạng của máy trả lời.
    #[ignore = "cần mạng: chờ tới 10 giây, kết quả phụ thuộc môi trường mạng"]
    fn connect_timeout_gives_open_failed_within_about_ten_seconds(s: &Server) {
        let t0 = Instant::now();
        let r = call(
            "open",
            s.params_with("disable", json!({"host": "10.255.255.1", "port": 3306})),
        );
        let took = t0.elapsed();
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(took < Duration::from_secs(15), "{took:?}");
    }

    // ---- execute ----

    fn select_returns_columns_rows_and_done(s: &Server) {
        let c = s.conn();
        let r = c.exec("select 1 as a, 'x' as b, null as n");
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["index"], 0);
        assert_eq!(x["done"], true);
        assert!(x["cursorId"].is_null());
        assert!(x["error"].is_null());
        assert_eq!(x["columns"][0]["name"], "a");
        assert_eq!(x["columns"][1], json!({"name": "b", "type": "varchar"}));
        assert_eq!(x["columns"][2], json!({"name": "n", "type": "null"}));
        assert_eq!(x["rows"], json!([["1", "x", null]]));
        assert!(x["firstRowMs"].is_u64(), "{x}");
    }

    fn query_without_rows_still_has_columns_and_is_done(s: &Server) {
        let c = s.conn();
        let r = c.exec("select 1 as a from dual where false");
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["rows"], json!([]));
        assert_eq!(x["done"], true);
        assert_eq!(x["columns"][0]["name"], "a");
    }

    fn empty_string_and_null_are_different_cells(s: &Server) {
        let c = s.conn();
        let r = c.exec("select '' as e, null as n, ' ' as sp");
        assert_eq!(st(&r, 0)["rows"], json!([["", null, " "]]));
    }

    fn dml_and_ddl_report_rows_affected(s: &Server) {
        let c = s.conn();
        let r = c.exec("create temporary table t_aff(a int)");
        assert_eq!(st(&r, 0)["kind"], "affected");
        assert_eq!(st(&r, 0)["rowsAffected"], 0);
        let r = c.exec("insert into t_aff values (1),(2),(3),(4),(5)");
        assert_eq!(st(&r, 0)["rowsAffected"], 5);
        let r = c.exec("update t_aff set a = a + 10 where a <= 2");
        assert_eq!(st(&r, 0)["rowsAffected"], 2);
        let r = c.exec("delete from t_aff where a > 3");
        assert_eq!(st(&r, 0)["rowsAffected"], 4);
        let r = c.exec("delete from t_aff where false");
        assert_eq!(st(&r, 0)["rowsAffected"], 0);
        assert_eq!(c.first("select count(*) from t_aff"), "1");
    }

    fn sql_error_is_in_the_statement_not_the_request(s: &Server) {
        let c = s.conn();
        let r = c.exec("select * from no_such_table_zz");
        let x = st(&r, 0);
        assert_eq!(code_of(x), "sqlError");
        assert!(message_of(x).starts_with("ERROR 1146 (42S02)"), "{x}");
        assert!(message_of(x).contains("no_such_table_zz"), "{x}");
        assert_eq!(x["index"], 0);
        // Connection vẫn dùng được sau lỗi.
        assert_eq!(c.first("select 1"), "1");
        // Cú pháp sai: 1064.
        let r = c.exec("selec 1");
        assert!(message_of(st(&r, 0)).starts_with("ERROR 1064"), "{r}");
    }

    fn constraint_error_is_a_statement_error(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "create temporary table t_dup(a int primary key); insert into t_dup values (1),(1)",
        );
        assert_eq!(statements(&r).len(), 2);
        assert!(message_of(st(&r, 1)).starts_with("ERROR 1062"), "{r}");
    }

    fn script_runs_in_order_and_stops_at_the_first_error(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "create temporary table z(a int); insert into z values (1),(2); \
             select * from z order by a; select * from no_such_table_zz; select 99",
        );
        let all = statements(&r);
        assert_eq!(all.len(), 4, "câu sau lỗi không được chạy: {r}");
        assert_eq!(all[0]["kind"], "affected");
        assert_eq!(all[1]["rowsAffected"], 2);
        assert_eq!(all[2]["rows"], json!([["1"], ["2"]]));
        assert_eq!(code_of(&all[3]), "sqlError");
        for (i, x) in all.iter().enumerate() {
            assert_eq!(x["index"], i);
        }
    }

    fn empty_or_comment_only_script_has_no_statements(s: &Server) {
        let c = s.conn();
        for sql in [
            "",
            "   ",
            "-- only a comment",
            "# hash comment",
            "/* block */",
            ";",
            " ; ; ",
        ] {
            let r = c.exec(sql);
            assert_eq!(ok(&r)["statements"], json!([]), "{sql:?}");
        }
        assert_eq!(c.first("select 1"), "1");
    }

    fn empty_statements_between_semicolons_are_skipped(s: &Server) {
        let c = s.conn();
        let r = c.exec(";; select 1 ;; select 2;");
        assert_eq!(statements(&r).len(), 2);
        assert_eq!(st(&r, 1)["rows"], json!([["2"]]));
    }

    fn splitter_respects_quotes_backticks_and_comments(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "select 'a;b' as x; select \"c;d\" as y; select 1 as `e;f`; /* ; */ select 2 -- ;\n; select 3",
        );
        let all = statements(&r);
        assert_eq!(all.len(), 5, "{r}");
        assert_eq!(all[0]["rows"], json!([["a;b"]]));
        assert_eq!(all[1]["rows"], json!([["c;d"]]));
        assert_eq!(all[2]["columns"][0]["name"], "e;f");
        assert_eq!(all[4]["rows"], json!([["3"]]));
    }

    fn show_describe_and_explain_are_rows(s: &Server) {
        let c = s.conn();
        let r = c.exec("show variables like 'net_write_timeout'");
        assert_eq!(st(&r, 0)["rows"], json!([["net_write_timeout", "3600"]]));
        ok(&c.exec("create temporary table t_desc(a int, b varchar(5))"));
        let r = c.exec("describe t_desc");
        assert_eq!(st(&r, 0)["kind"], "rows");
        assert_eq!(row_count(&r, 0), 2);
        let r = c.exec("explain select 1");
        assert_eq!(st(&r, 0)["kind"], "rows");
    }

    fn use_set_and_transaction_commands_are_affected_with_zero(s: &Server) {
        let c = s.conn();
        for sql in [
            "use s3b",
            "set @v = 5",
            "set session sql_mode = ''",
            "start transaction",
            "commit",
            "begin",
            "rollback",
        ] {
            let r = c.exec(sql);
            assert_eq!(st(&r, 0)["kind"], "affected", "{sql}: {r}");
            assert_eq!(st(&r, 0)["rowsAffected"], 0, "{sql}");
        }
        assert_eq!(c.first("select @v"), "5");
    }

    fn delimiter_script_with_a_stored_procedure_and_several_result_sets(s: &Server) {
        let c = s.conn();
        let name = marker("p_multi");
        let r = c.exec(&format!(
            "DELIMITER $$\n\
             create procedure s3b.{name}() begin select 1 as a; select 'x' as b, 2 as c; end$$\n\
             DELIMITER ;\n\
             call s3b.{name}();\n\
             call s3b.{name}(); select 9"
        ));
        let all = statements(&r);
        // create, call (2 set), call (2 set), select.
        assert_eq!(all.len(), 6, "{r}");
        assert_eq!(all[0]["kind"], "affected");
        assert!(all[0]["sql"].as_str().unwrap().ends_with("end"), "{}", all[0]);
        // Nhiều result set của cùng một câu CALL có cùng `index`.
        let indexes: Vec<u64> = all.iter().map(|x| x["index"].as_u64().unwrap()).collect();
        assert_eq!(indexes, [0, 1, 1, 2, 2, 3]);
        assert_eq!(all[1]["columns"][0]["name"], "a");
        assert_eq!(all[1]["rows"], json!([["1"]]));
        assert_eq!(all[2]["columns"][0]["name"], "b");
        assert_eq!(all[2]["rows"], json!([["x", "2"]]));
        assert_eq!(all[3]["rows"], json!([["1"]]));
        assert_eq!(all[4]["rows"], json!([["x", "2"]]));
        assert_eq!(all[5]["rows"], json!([["9"]]));
        ok(&c.exec(&format!("drop procedure s3b.{name}")));
        assert_eq!(c.first("select 1"), "1");
    }

    fn call_without_result_sets_is_only_an_ok_packet(s: &Server) {
        let c = s.conn();
        let name = marker("p_ok");
        let r = c.exec(&format!(
            "DELIMITER $$\ncreate procedure s3b.{name}() begin set @z = 41 + 1; end$$\nDELIMITER ;\ncall s3b.{name}()"
        ));
        let all = statements(&r);
        assert_eq!(all.len(), 2, "{r}");
        assert_eq!(all[1]["kind"], "affected");
        assert_eq!(all[1]["index"], 1);
        assert_eq!(c.first("select @z"), "42");
        ok(&c.exec(&format!("drop procedure s3b.{name}")));
    }

    fn call_of_a_missing_procedure_is_a_statement_error(s: &Server) {
        let c = s.conn();
        let r = c.exec("call s3b.no_such_proc_zz(); select 2");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert!(message_of(st(&r, 0)).starts_with("ERROR 1305"), "{r}");
        assert_eq!(c.first("select 1"), "1");
    }

    // ---- phân trang ----

    fn paging_fetches_every_row_exactly_once(s: &Server) {
        let c = s.conn();
        allow_deep_recursion(s, &c);
        let r = c.exec_page(&series_my(1200), 500, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(x["rows"].as_array().unwrap().len(), 500);
        assert_eq!(x["done"], false);
        assert!(x["truncated"].is_null());
        let cursor = x["cursorId"].as_u64().unwrap();
        assert_eq!(x["rows"][0], json!(["1", "row 1"]));

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

    fn exact_page_size_result_gives_a_cursor_then_an_empty_done_page(s: &Server) {
        let c = s.conn();
        // Trang vừa đầy thì chưa biết hết dòng, trang kế rỗng và `done`.
        let r = c.exec_page(&series_my(10), 10, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(x["rows"].as_array().unwrap().len(), 10);
        assert_eq!(x["done"], false, "{x}");
        let cursor = x["cursorId"].as_u64().unwrap();
        let f = c.fetch_page(cursor, 10, MAX_BYTES);
        assert_eq!(ok(&f)["rows"], json!([]));
        assert_eq!(ok(&f)["done"], true);
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.first("select 1"), "1");
    }

    fn page_size_larger_than_the_result_is_done(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_my(3), 500, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], true);
        assert_eq!(row_count(&r, 0), 3);
        assert!(st(&r, 0)["cursorId"].is_null());
    }

    fn max_page_bytes_limits_the_page(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_my(1000), 1000, 2000);
        let x = st(&r, 0);
        let n = x["rows"].as_array().unwrap().len();
        assert!(n > 0 && n < 1000, "{n}");
        assert_eq!(x["done"], false);
        let cursor = x["cursorId"].as_u64().unwrap();
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

    fn non_last_statement_with_more_rows_is_truncated_and_the_last_keeps_the_cursor(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(
            &format!("{}; {}", series_my(900), series_my(700)),
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
        assert_eq!(ok(&c.fetch_page(cursor, 100, MAX_BYTES))["rows"][0][0], "101");
        // Connection còn đồng bộ sau khi bỏ dở result set của câu đầu.
        assert_eq!(c.first("select 5"), "5");
    }

    fn fetch_with_unknown_cursor_or_connection_has_stable_codes(s: &Server) {
        let c = s.conn();
        assert_eq!(err_code(&c.fetch(987_654_321)), "cursorNotFound");
        assert_eq!(err_code(&fetch(987_654_321, 1)), "connNotFound");
        assert_eq!(err_code(&exec(987_654_321, "select 1")), "connNotFound");
        assert_eq!(c.first("select 1"), "1");
    }

    fn a_new_execute_drops_the_previous_cursor(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_my(100), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        assert_eq!(c.first("select 2"), "2");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
    }

    fn error_in_the_middle_of_a_fetch_is_reported_and_the_connection_survives(s: &Server) {
        let c = s.conn();
        // Dòng x = 700 làm subquery trả 2 dòng (lỗi 1242), phát hiện khi server tính dòng đó.
        let r = c.exec_page(
            &format!(
                "select if(x = 700, (select 1 union all select 2), x) as v from ({}) q",
                series_my(1000)
            ),
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
            assert_eq!(f["result"]["done"], false, "lỗi phải tới trước khi hết dòng");
        }
        let f = failure.expect("fetch phải gặp lỗi subquery");
        assert_eq!(err_code(&f), "sqlError");
        assert!(
            f["error"]["message"].as_str().unwrap().starts_with("ERROR 1242"),
            "{f}"
        );
        // Cursor đã bị bỏ, connection dùng tiếp được.
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.first("select 1"), "1");
    }

    fn close_with_an_open_cursor_succeeds(s: &Server) {
        let r = s.open("disable");
        let id = ok(&r)["connId"].as_u64().unwrap();
        let r = exec_page(id, &endless_rows("closing"), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": id})));
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
        assert_eq!(err_code(&exec(id, "select 1")), "connNotFound");
    }

    // ---- kiểu dữ liệu ----

    fn integer_types_keep_their_exact_extremes_and_unsigned_names(s: &Server) {
        let c = s.conn();
        ok(&c.exec(
            "create temporary table t_int(a tinyint, b smallint, c mediumint, d int, e bigint, \
             f tinyint unsigned, g smallint unsigned, h mediumint unsigned, i int unsigned, \
             j bigint unsigned)",
        ));
        let min = "-128,-32768,-8388608,-2147483648,-9223372036854775808,0,0,0,0,0";
        let max = "127,32767,8388607,2147483647,9223372036854775807,255,65535,16777215,4294967295,\
                   18446744073709551615";
        ok(&c.exec(&format!("insert into t_int values ({min}),({max})")));
        let r = c.exec("select * from t_int order by a");
        let x = st(&r, 0);
        assert_eq!(
            types(x),
            [
                "tinyint",
                "smallint",
                "mediumint",
                "int",
                "bigint",
                "tinyint unsigned",
                "smallint unsigned",
                "mediumint unsigned",
                "int unsigned",
                "bigint unsigned",
            ]
        );
        let low: Vec<&str> = min.split(',').collect();
        let high: Vec<&str> = max.split(',').collect();
        assert_eq!(x["rows"], json!([low, high]));
    }

    fn decimal_float_and_double_are_text_as_the_server_formats_them(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_num(d decimal(20,6), f float, g double, z decimal(5,2))"));
        ok(&c.exec(
            "insert into t_num values (-12345678901234.123456, 1.5, 2.25, 0), \
             (99999999999999.999999, -0.5, 1e100, -0.01)",
        ));
        let r = c.exec("select * from t_num order by g");
        let x = st(&r, 0);
        assert_eq!(types(x), ["decimal", "float", "double", "decimal"]);
        assert_eq!(
            x["rows"],
            json!([
                ["-12345678901234.123456", "1.5", "2.25", "0.00"],
                ["99999999999999.999999", "-0.5", "1e100", "-0.01"],
            ])
        );
    }

    fn date_and_time_types_keep_the_server_text(s: &Server) {
        let c = s.conn();
        ok(&c.exec(
            "create temporary table t_dt(d date, t0 time, t3 time(3), t6 time(6), dt datetime(6), \
             ts timestamp null, y year)",
        ));
        ok(&c.exec(
            "insert into t_dt values ('2024-02-29', '-838:59:59', '-123:45:56.789', \
             '25:34:56.123456', '2024-02-29 23:59:59.999999', '2024-02-29 01:02:03', 2155)",
        ));
        let r = c.exec("select * from t_dt");
        let x = st(&r, 0);
        assert_eq!(
            types(x),
            ["date", "time", "time", "time", "datetime", "timestamp", "year"]
        );
        assert_eq!(
            x["rows"],
            json!([[
                "2024-02-29",
                "-838:59:59",
                "-123:45:56.789",
                "25:34:56.123456",
                "2024-02-29 23:59:59.999999",
                "2024-02-29 01:02:03",
                "2155"
            ]])
        );
    }

    /// `TIME` không có phần thập phân: MySQL làm tròn giây, MariaDB cắt bỏ. Driver giữ nguyên chữ
    /// server gửi nên hai server cho hai kết quả khác nhau.
    fn time_without_fraction_differs_between_mysql_and_mariadb(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "select cast('12:34:56.789' as time) as a, cast('-12:34:56.789' as time) as b",
        );
        let expected = if s.is_mariadb() {
            json!([["12:34:56", "-12:34:56"]])
        } else {
            json!([["12:34:57", "-12:34:57"]])
        };
        assert_eq!(st(&r, 0)["rows"], expected);
        // Cột có phần thập phân giữ nguyên ở cả hai.
        ok(&c.exec("create temporary table t_tm(a time(3))"));
        ok(&c.exec("insert into t_tm values ('-12:34:56.123')"));
        assert_eq!(c.first("select a from t_tm"), "-12:34:56.123");
    }

    fn zero_dates_are_shown_as_zeros_not_as_null_in_a_table(s: &Server) {
        let c = s.conn();
        // CAST('0000-00-00' AS DATE) ở sql_mode mặc định: MySQL trả NULL, MariaDB giữ nguyên số không.
        let expected = if s.is_mariadb() { json!("0000-00-00") } else { Value::Null };
        assert_eq!(c.first("select cast('0000-00-00' as date)"), expected);
        ok(&c.exec("set session sql_mode = ''"));
        ok(&c.exec("create temporary table t_zero(d date, dt datetime(6), ts timestamp null)"));
        ok(&c.exec(
            "insert into t_zero values ('0000-00-00', '0000-00-00 00:00:00', '0000-00-00 00:00:00')",
        ));
        let r = c.exec("select * from t_zero");
        assert_eq!(
            st(&r, 0)["rows"],
            json!([["0000-00-00", "0000-00-00 00:00:00.000000", "0000-00-00 00:00:00"]])
        );
    }

    fn bit_values_are_zero_one_strings_as_wide_as_the_column(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_bit(a bit(10), b bit(1), c bit(64), d bit(3))"));
        ok(&c.exec(
            "insert into t_bit values (b'1010101010', b'1', b'1', b'0'), (0, 0, 0xFFFFFFFFFFFFFFFF, 5)",
        ));
        let r = c.exec("select * from t_bit order by b");
        let x = st(&r, 0);
        assert_eq!(types(x), ["bit", "bit", "bit", "bit"]);
        let ones64 = "1".repeat(64);
        let one64 = format!("{}1", "0".repeat(63));
        assert_eq!(
            x["rows"],
            json!([
                ["0000000000", "0", ones64, "101"],
                ["1010101010", "1", one64, "000"],
            ])
        );
    }

    fn binary_types_are_hex_including_nul_bytes(s: &Server) {
        let c = s.conn();
        ok(&c.exec(
            "create temporary table t_bin(o binary(4), p varbinary(8), q blob, tb tinyblob, \
             mb mediumblob, lb longblob, e blob)",
        ));
        ok(&c.exec(
            "insert into t_bin values (x'00ff', x'00ff', x'00ff00', x'00', x'01', x'02', x'')",
        ));
        let r = c.exec("select * from t_bin");
        let x = st(&r, 0);
        assert_eq!(
            types(x),
            ["binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob", "blob"]
        );
        // BINARY(4) được độn bằng 0x00 phía bên phải.
        assert_eq!(
            x["rows"],
            json!([["0x00ff0000", "0x00ff", "0x00ff00", "0x00", "0x01", "0x02", "0x"]])
        );
        let r = c.exec("select x'00' as a, x'' as b, 0x4142 as c, cast('A' as binary) as d");
        assert_eq!(st(&r, 0)["rows"], json!([["0x00", "0x", "0x4142", "0x41"]]));
    }

    fn text_types_are_named_by_their_maximum_length(s: &Server) {
        let c = s.conn();
        ok(&c.exec(
            "create temporary table t_txt(u char(3), v varchar(9), w tinytext, x text, \
             y mediumtext, z longtext, s enum('a','b'), t set('x','y'))",
        ));
        ok(&c.exec("insert into t_txt values ('abc','xin','t','x','y','z','b','x,y')"));
        let r = c.exec("select * from t_txt");
        let x = st(&r, 0);
        assert_eq!(
            types(x),
            ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]
        );
        assert_eq!(x["rows"], json!([["abc", "xin", "t", "x", "y", "z", "b", "x,y"]]));
    }

    fn json_is_json_on_mysql_and_longtext_on_mariadb(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_json(j json)"));
        ok(&c.exec(r#"insert into t_json values ('{"a": [1, 2], "b": null}')"#));
        let r = c.exec("select j from t_json");
        let x = st(&r, 0);
        let expected = if s.is_mariadb() { "longtext" } else { "json" };
        assert_eq!(types(x), [expected]);
        assert_eq!(x["rows"], json!([[r#"{"a": [1, 2], "b": null}"#]]));
    }

    fn unicode_text_round_trips(s: &Server) {
        let c = s.conn();
        let text = "Xin chào 日本語 🎉";
        let r = c.exec(&format!("select '{text}' as u, char_length('{text}') as n"));
        assert_eq!(st(&r, 0)["rows"], json!([[text, "14"]]));
        ok(&c.exec("create temporary table t_u(a varchar(40) character set utf8mb4)"));
        ok(&c.exec(&format!("insert into t_u values ('{text}')")));
        assert_eq!(c.first("select a from t_u"), text);
    }

    fn invalid_utf8_in_a_text_column_does_not_fail_the_query(s: &Server) {
        let c = s.conn();
        // latin1 `é` (0xE9) gửi nguyên ra giao thức dưới dạng utf8mb4 hợp lệ nhờ server đổi bộ
        // ký tự; chuỗi nhị phân ép sang kiểu chữ không đổi byte nên là UTF-8 hỏng.
        let r = c.exec("select convert(x'4120e9' using binary) as raw, convert(x'e9' using latin1) as l");
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows", "{x}");
        assert_eq!(x["rows"][0][0], "0x4120e9");
        assert_eq!(x["rows"][0][1], "é");
    }

    fn null_in_every_column_type_is_json_null(s: &Server) {
        let c = s.conn();
        ok(&c.exec(
            "create temporary table t_null(a tinyint, b int unsigned, c bigint, d decimal(10,2), \
             e float, f double, g date, h time(3), i datetime(6), j timestamp null, k year, \
             l bit(10), m binary(4), n varbinary(8), o blob, p json, q enum('a'), r set('x'), \
             s char(3), t varchar(9), u text, v longtext, w tinyblob)",
        ));
        ok(&c.exec("insert into t_null(a) values (null)"));
        let r = c.exec("select * from t_null");
        let x = st(&r, 0);
        let cols = x["columns"].as_array().unwrap().len();
        assert_eq!(cols, 23);
        assert_eq!(x["rows"][0].as_array().unwrap().len(), 23);
        assert!(
            x["rows"][0].as_array().unwrap().iter().all(Value::is_null),
            "{x}"
        );
    }

    fn large_text_and_many_columns_round_trip(s: &Server) {
        let c = s.conn();
        let r = c.exec("select repeat('é', 500000) as big, 7 as n");
        let x = st(&r, 0);
        assert_eq!(x["rows"][0][0].as_str().unwrap().chars().count(), 500_000);
        assert_eq!(x["rows"][0][1], "7");
        let cols: Vec<String> = (1..=200).map(|i| format!("{i} as c{i}")).collect();
        let r = c.exec(&format!("select {}", cols.join(", ")));
        let x = st(&r, 0);
        assert_eq!(x["columns"].as_array().unwrap().len(), 200);
        assert_eq!(x["rows"][0][199], "200");
    }

    fn duplicate_and_unnamed_columns_are_kept(s: &Server) {
        let c = s.conn();
        let r = c.exec("select 1 as a, 2 as a, 3, 'x'");
        let x = st(&r, 0);
        let names: Vec<&str> = x["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["a", "a", "3", "x"]);
        assert_eq!(x["rows"], json!([["1", "2", "3", "x"]]));
    }

    // ---- huỷ ----

    fn cancel_a_running_select_returns_cancelled_and_the_next_statement_runs(s: &Server) {
        let c = s.conn();
        let m = marker("c1");
        assert_cancelled_quickly_and_usable(s, &c, &format!("select sleep(30), '{m}' as m"), &m);
    }

    fn cancel_in_a_script_stops_the_whole_request(s: &Server) {
        let c = s.conn();
        let m = marker("cscript");
        let sql = format!("select 1; select sleep(30), '{m}' as m; select 3");
        assert_cancelled_quickly_and_usable(s, &c, &sql, &m);
    }

    fn cancel_a_write_blocked_on_a_row_lock_returns_cancelled(s: &Server) {
        // `sleep()` trong INSERT bị KILL vẫn trả 1 mà không lỗi nên dùng khoá dòng để chặn ghi.
        let table = marker("t_lock");
        let holder = s.conn();
        ok(&holder.exec(&format!("create table s3b.{table}(a int primary key, b int) engine = innodb")));
        ok(&holder.exec(&format!("insert into s3b.{table} values (1, 0)")));
        ok(&holder.exec("begin"));
        ok(&holder.exec(&format!("update s3b.{table} set b = 1 where a = 1")));
        let c = s.conn();
        let m = marker("cw");
        let sql = format!("update s3b.{table} set b = 2 where a = 1 and '{m}' = '{m}'");
        assert_cancelled_quickly_and_usable(s, &c, &sql, &m);
        ok(&holder.exec("rollback"));
        assert_eq!(c.first(&format!("select b from s3b.{table}")), "0");
        ok(&c.exec(&format!("drop table s3b.{table}")));
    }

    fn cancel_repeatedly_never_leaves_the_connection_broken(s: &Server) {
        let c = s.conn();
        for i in 0..6 {
            let m = marker(&format!("loop{i}"));
            assert_cancelled_quickly_and_usable(s, &c, &format!("select sleep(30), '{m}' as m"), &m);
        }
        // Lần huỷ nào cũng không để sót yêu cầu huỷ làm hỏng câu sau.
        for i in 0..20 {
            assert_eq!(c.first(&format!("select {i}")), i.to_string());
        }
    }

    fn cancel_after_the_request_finished_does_not_touch_the_next_one(s: &Server) {
        let c = s.conn();
        for _ in 0..10 {
            let id = next_id();
            let r = call_with_id(
                id,
                "execute",
                json!({"connId": c.id, "sql": "select 1", "pageSize": 10, "maxPageBytes": MAX_BYTES}),
            );
            assert_eq!(first_cell(&r), "1");
            // Huỷ muộn: request đã xong nên không được KILL câu kế tiếp.
            cancel(id);
            let r = c.exec("select sleep(0.05), 7");
            assert_eq!(st(&r, 0)["rows"][0][1], "7", "{r}");
        }
    }

    fn cancel_of_an_unknown_request_id_is_harmless(s: &Server) {
        let c = s.conn();
        cancel(next_id());
        assert_eq!(c.first("select 1"), "1");
    }

    fn cancel_inside_a_transaction_keeps_the_transaction(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_tx(a int) engine = innodb"));
        ok(&c.exec("begin"));
        ok(&c.exec("insert into t_tx values (1)"));
        let m = marker("ctx");
        let monitor = s.conn();
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("select sleep(30), '{m}' as m"));
        wait_until_active(&monitor, &m);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        // KILL QUERY chỉ dừng câu, transaction và dữ liệu đã ghi vẫn còn.
        assert_eq!(c.first("select count(*) from t_tx"), "1");
        ok(&c.exec("rollback"));
        assert_eq!(c.first("select count(*) from t_tx"), "0");
    }

    // ---- bỏ cursor ----

    fn abandoning_a_small_cursor_lets_the_next_statement_run_at_once(s: &Server) {
        let c = s.conn();
        for i in 0..5 {
            let r = c.exec_page(&series_my(300), 10, MAX_BYTES);
            assert_eq!(st(&r, 0)["done"], false);
            let t0 = Instant::now();
            assert_eq!(c.first(&format!("select {i}")), i.to_string());
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        }
    }

    fn abandoning_a_big_read_cursor_kills_it_and_the_next_statement_works(s: &Server) {
        let c = s.conn();
        let monitor = s.conn();
        let tid = c.thread_id();
        for i in 0..3 {
            let m = marker(&format!("big{i}"));
            let r = c.exec_page(&endless_rows(&m), 10, MAX_BYTES);
            assert_eq!(st(&r, 0)["done"], false, "{r}");
            let t0 = Instant::now();
            let r = c.exec(&format!("select {i}"));
            assert_eq!(first_cell(&r), i.to_string(), "{r}");
            assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
            // Câu cũ không còn chạy ở server và connection vẫn là connection cũ.
            wait_until_gone(&monitor, &m);
            assert_eq!(c.thread_id(), tid);
        }
    }

    fn abandoning_a_slow_cursor_does_not_read_every_row(s: &Server) {
        let c = s.conn();
        // 1.000.000 dòng x 10 ms: chỉ nhanh khi câu bị KILL phía server.
        let m = marker("slow");
        let r = c.exec_page(&slow_rows(&m), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false, "{r}");
        let t0 = Instant::now();
        assert_eq!(c.first("select 11"), "11");
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    }

    fn abandoning_a_cursor_inside_a_transaction_only_drains_it(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_ab(a int) engine = innodb"));
        ok(&c.exec("begin"));
        ok(&c.exec("insert into t_ab values (1)"));
        // 20.000 dòng nhỏ: đọc bỏ nhanh, nếu bị KILL thì cũng không mất transaction nhưng
        // `select 42` phải chạy được và dữ liệu còn nguyên.
        let r = c.exec_page(&format!("select * from ({}) q", series_my(1000)), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        assert_eq!(c.first("select 42"), "42");
        assert_eq!(c.first("select count(*) from t_ab"), "1");
        ok(&c.exec("rollback"));
        assert_eq!(c.first("select count(*) from t_ab"), "0");
    }

    fn transaction_commit_persists_after_an_abandoned_cursor(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_c(a int) engine = innodb"));
        ok(&c.exec("begin"));
        ok(&c.exec("insert into t_c values (1)"));
        let r = c.exec_page(&series_my(300), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        assert_eq!(c.first("select count(*) from t_c"), "1");
        ok(&c.exec("commit"));
        assert_eq!(c.first("select count(*) from t_c"), "1");
    }

    fn abandoning_a_cursor_with_more_result_sets_leaves_the_connection_in_sync(s: &Server) {
        let c = s.conn();
        let name = marker("p_cur");
        ok(&c.exec(&format!(
            "DELIMITER $$\ncreate procedure s3b.{name}() begin \
             select x from ({}) q; select 2 as two; end$$\nDELIMITER ;",
            series_my(500)
        )));
        let r = c.exec_page(&format!("call s3b.{name}()"), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false, "{r}");
        assert_eq!(c.first("select 5"), "5");
        ok(&c.exec(&format!("drop procedure s3b.{name}")));
    }

    // ---- LOAD DATA LOCAL ----

    /// Server nhận yêu cầu `LOAD DATA LOCAL` nhưng driver không có handler đọc file. MySQL từ chối
    /// ngay vì `local_infile=OFF` (3948), connection dùng tiếp; MariaDB đòi file nên driver báo lỗi
    /// và connection bị đánh dấu hỏng: lệnh sau trả `connNotFound` cho tới khi mở lại.
    fn load_data_local_is_refused_without_reading_any_file(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_ld(a int)"));
        let r = c.exec("load data local infile 'C:/khong/ton/tai.csv' into table t_ld");
        let x = st(&r, 0);
        assert_eq!(code_of(x), "sqlError", "{r}");
        if s.is_mariadb() {
            assert!(message_of(x).starts_with("Driver error"), "{x}");
            assert!(message_of(x).contains("LOCAL INFILE"), "{x}");
            let r = c.exec("select 1");
            assert_eq!(err_code(&r), "connNotFound", "{r}");
            assert!(r["error"]["message"].as_str().unwrap().contains("broken"));
            // Mở lại connection mới thì dùng bình thường.
            assert_eq!(s.conn().first("select 1"), "1");
        } else {
            assert!(message_of(x).starts_with("ERROR 3948"), "{x}");
            assert_eq!(c.first("select 1"), "1");
        }
    }

    // ---- method chỉ SQLite có ----

    fn schema_methods_are_invalid_request_for_mysql_and_mariadb(s: &Server) {
        let c = s.conn();
        for (method, params) in [
            ("schemaTree", json!({"connId": c.id})),
            ("tableInfo", json!({"connId": c.id, "table": "t"})),
            ("tableRows", json!({"connId": c.id, "table": "t"})),
        ] {
            let r = call(method, params);
            assert_eq!(err_code(&r), "invalidRequest", "{method}: {r}");
        }
        assert_eq!(c.first("select 1"), "1");
    }

    // ---- nhiều connection ----

    fn connections_are_isolated_from_each_other(s: &Server) {
        let a = s.conn();
        let b = s.conn();
        ok(&a.exec("create temporary table t_iso(a int)"));
        ok(&a.exec("insert into t_iso values (1)"));
        let r = b.exec("select * from t_iso");
        assert_eq!(code_of(st(&r, 0)), "sqlError");
        assert_ne!(a.thread_id(), b.thread_id());
        ok(&a.exec("set @who = 'a'"));
        assert_eq!(b.first("select @who"), Value::Null);
        assert_eq!(a.first("select @who"), "a");
    }

    fn many_connections_can_run_concurrently(s: &Server) {
        let conns: Vec<Conn> = (0..8).map(|_| s.conn()).collect();
        let handles: Vec<_> = conns
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (id, sql) = (c.id, format!("select {i} as i, sleep(0.1)"));
                std::thread::spawn(move || first_cell(&exec(id, &sql)))
            })
            .collect();
        for (i, h) in handles.into_iter().enumerate() {
            assert_eq!(h.join().unwrap(), i.to_string());
        }
    }

    // ---- giới hạn đã biết (mô tả hành vi HIỆN TẠI, không phải hành vi mong muốn) ----

    /// `SET autocommit = 0` mở transaction ngầm nhưng `track_tx` chỉ nhận `BEGIN`/`START`, nên bỏ
    /// cursor lớn vẫn bị KILL như khi không có transaction. KILL QUERY chỉ dừng câu, dữ liệu đã ghi
    /// trong transaction ngầm không mất.
    fn known_limit_set_autocommit_zero_is_not_tracked_as_a_transaction(s: &Server) {
        let c = s.conn();
        ok(&c.exec("create temporary table t_ac(a int) engine = innodb"));
        ok(&c.exec("set autocommit = 0"));
        ok(&c.exec("insert into t_ac values (1)"));
        let m = marker("ac");
        let r = c.exec_page(&endless_rows(&m), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        let t0 = Instant::now();
        // Nếu coi là transaction thì phải đọc bỏ cả tỷ dòng; thực tế câu bị KILL nên về ngay.
        assert_eq!(c.first("select 3"), "3");
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
        assert_eq!(c.first("select count(*) from t_ac"), "1");
        ok(&c.exec("rollback"));
        assert_eq!(c.first("select count(*) from t_ac"), "0");
    }
}
