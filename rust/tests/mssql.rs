//! Test tích hợp driver SQL Server qua 4 hàm FFI, với server thật (`s3b-test-mssql`, SQL Server
//! 2022 trong `test-env/`). Không có server thì mỗi test in `SKIP ...` rồi đạt (xem
//! `mssql_common`).
//!
//! Mỗi test tự mở connection riêng (và đóng khi kết thúc) nên độc lập thứ tự chạy; bảng và
//! procedure tạo ra đều là đối tượng tạm (`#t`, `#p`) của chính session đó.
//!
//! TLS (6 mode, `encrypt_option`, chứng chỉ) nằm ở `mssql_tls.rs`.

mod common;
mod mssql_common;

use common::*;
use mssql_common::*;
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

/// `net_packet_size` của session hiện tại (số nguyên).
fn packet_size(c: &Conn) -> u32 {
    c.first("SELECT net_packet_size FROM sys.dm_exec_connections WHERE session_id = @@SPID")
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

/// Chạy `sql` một statement rồi trả hàng đầu tiên (mỗi ô là chuỗi hoặc null).
fn first_row(c: &Conn, sql: &str) -> Value {
    let r = c.exec(sql);
    let x = st(&r, 0);
    assert_eq!(x["kind"], "rows", "{x}");
    x["rows"][0].clone()
}

mssql! {
    // ---- open ----

    fn open_runs_a_query_and_close_makes_the_connection_unknown(s: &Server) {
        let r = s.open("disable");
        let id = ok(&r)["connId"].as_u64().unwrap();
        assert_eq!(first_cell(&exec(id, "SELECT 1")), "1");
        ok(&call("close", json!({"connId": id})));
        let r = exec(id, "SELECT 1");
        assert_eq!(err_code(&r), "connNotFound");
        // Đóng lần hai vẫn trả mã ổn định (không panic).
        let again = call("close", json!({"connId": id}));
        assert!(again["ok"] == true || err_code(&again) == "connNotFound", "{again}");
    }

    fn open_uses_the_requested_database_login_and_application_name(s: &Server) {
        let c = s.conn();
        assert_eq!(
            first_row(&c, "SELECT DB_NAME(), APP_NAME(), SUSER_NAME()"),
            json!(["master", "S3Browser", "sa"])
        );
        let c = s.conn_with("disable", json!({"database": "tempdb"}));
        assert_eq!(c.first("SELECT DB_NAME()"), "tempdb");
        // Thiếu hoặc rỗng `database` thì dùng database mặc định của login.
        for over in [json!({"database": null}), json!({"database": ""})] {
            let c = s.conn_with("disable", over);
            assert_eq!(c.first("SELECT DB_NAME()"), "master");
        }
    }

    /// Packet size TDS xin tối đa (32767). Server không nhất thiết cấp đúng số đó: SQL Server 2022
    /// cấp 32576, nên chỉ kiểm "gần mức tối đa và không vượt giá trị xin", xa mặc định 4096.
    fn open_negotiates_a_large_tds_packet_size(s: &Server) {
        let c = s.conn();
        let size = packet_size(&c);
        assert!((32_000..=32_767).contains(&size), "net_packet_size = {size}");
    }

    fn close_removes_the_session_from_the_server(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let link = c.link();
        assert!(link_exists(&monitor, &link));
        drop(c);
        wait_for(Duration::from_secs(10), "session đóng", || {
            !link_exists(&monitor, &link)
        });
    }

    fn wrong_password_is_open_failed_login_failed_without_leaking_it(s: &Server) {
        let wrong = s.wrong_password();
        let r = call("open", s.params_with("disable", json!({"password": wrong})));
        assert_eq!(err_code(&r), "openFailed");
        assert!(message_of_err(&r).contains("Login failed for user"), "{r}");
        assert!(!r.to_string().contains(&wrong), "{r}");
        assert!(!s.password_leaks_in(&r), "{r}");
    }

    fn wrong_user_and_wrong_database_are_open_failed(s: &Server) {
        let r = call("open", s.params_with("disable", json!({"username": "no_such_user_zz"})));
        assert_eq!(err_code(&r), "openFailed");
        assert!(message_of_err(&r).contains("Login failed"), "{r}");
        assert!(!s.password_leaks_in(&r));

        let r = call("open", s.params_with("disable", json!({"database": "no_such_db_zz"})));
        assert_eq!(err_code(&r), "openFailed");
        assert!(message_of_err(&r).contains("no_such_db_zz"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    /// Địa chỉ không định tuyến được: `open` phải trả `openFailed` sau khoảng 10 giây (không treo).
    /// Ignore vì chạy ~10 giây và phụ thuộc cách mạng của máy trả lời.
    #[ignore = "cần mạng: chờ tới 10 giây, kết quả phụ thuộc môi trường mạng"]
    fn connect_timeout_gives_open_failed_within_about_ten_seconds(s: &Server) {
        let t0 = Instant::now();
        let r = call(
            "open",
            s.params_with("disable", json!({"host": "10.255.255.1", "port": 1433})),
        );
        let took = t0.elapsed();
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(took < Duration::from_secs(15), "{took:?}");
    }

    // ---- execute ----

    fn select_returns_columns_rows_and_done(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1 AS a, N'x' AS b, NULL AS n, CAST(NULL AS varchar(5)) AS v");
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["index"], 0);
        assert_eq!(x["done"], true);
        assert!(x["cursorId"].is_null());
        assert!(x["error"].is_null());
        assert_eq!(x["columns"][0], json!({"name": "a", "type": "int"}));
        assert_eq!(x["columns"][1], json!({"name": "b", "type": "nvarchar"}));
        // `NULL` trần của T-SQL có kiểu `int`.
        assert_eq!(x["columns"][2], json!({"name": "n", "type": "int"}));
        assert_eq!(x["columns"][3], json!({"name": "v", "type": "varchar"}));
        assert_eq!(x["rows"], json!([["1", "x", null, null]]));
        assert!(x["firstRowMs"].is_u64(), "{x}");
        assert!(x["elapsedMs"].is_u64(), "{x}");
    }

    fn query_without_rows_still_has_columns_and_is_done(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1 AS a WHERE 1 = 0");
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["rows"], json!([]));
        assert_eq!(x["done"], true);
        assert_eq!(x["columns"][0]["name"], "a");
    }

    fn empty_string_and_null_are_different_cells(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT '' AS e, NULL AS n, ' ' AS sp, N'' AS ne");
        assert_eq!(st(&r, 0)["rows"], json!([["", null, " ", ""]]));
    }

    fn dml_and_ddl_report_rows_affected(s: &Server) {
        let c = s.conn();
        let r = c.exec("CREATE TABLE #aff(a int)");
        assert_eq!(st(&r, 0)["kind"], "affected");
        assert_eq!(st(&r, 0)["rowsAffected"], 0);
        let r = c.exec("INSERT #aff VALUES (1),(2),(3),(4),(5)");
        assert_eq!(st(&r, 0)["rowsAffected"], 5);
        let r = c.exec("UPDATE #aff SET a = a + 10 WHERE a <= 2");
        assert_eq!(st(&r, 0)["rowsAffected"], 2);
        let r = c.exec("DELETE #aff WHERE a > 3");
        assert_eq!(st(&r, 0)["rowsAffected"], 4);
        let r = c.exec("DELETE #aff WHERE 1 = 0");
        assert_eq!(st(&r, 0)["rowsAffected"], 0);
        assert_eq!(c.first("SELECT COUNT(*) FROM #aff"), "1");
        // `SET`, `PRINT`, `USE` không có result set và không có dòng bị ảnh hưởng.
        for sql in ["SET NOCOUNT ON", "PRINT 'hi'", "USE tempdb"] {
            let r = c.exec(sql);
            assert_eq!(st(&r, 0)["kind"], "affected", "{sql}");
            assert_eq!(st(&r, 0)["rowsAffected"], 0, "{sql}");
        }
    }

    /// `rowsAffected` là của câu CUỐI trong batch (giới hạn đã biết: số dòng lấy bằng
    /// `SELECT @@ROWCOUNT` sau batch).
    fn rows_affected_of_a_batch_is_that_of_its_last_statement(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #last(a int)"));
        let r = c.exec("INSERT #last VALUES (1),(2),(3); UPDATE #last SET a = a + 1 WHERE a = 1");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert_eq!(st(&r, 0)["rowsAffected"], 1, "{r}");
    }

    fn sql_error_is_in_the_statement_not_the_request_and_keeps_the_session(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #keep(a int)"));
        let spid = c.spid();
        let r = c.exec("SELECT * FROM no_such_table_zz");
        let x = st(&r, 0);
        assert_eq!(code_of(x), "sqlError");
        assert_eq!(
            message_of(x),
            "Msg 208, Level 16, State 1, Line 1: Invalid object name 'no_such_table_zz'."
        );
        assert_eq!(x["index"], 0);
        assert_eq!(x["kind"], "affected");
        // Lỗi của server không làm mất session: cùng SPID và bảng tạm còn.
        assert_eq!(c.spid(), spid);
        assert_eq!(c.first("SELECT COUNT(*) FROM #keep"), "0");
        // Cú pháp sai: Msg 102.
        let r = c.exec("SELECT )");
        assert!(message_of(st(&r, 0)).starts_with("Msg 102, Level 15"), "{r}");
        // Chia cho 0 ở dòng đầu (chưa có dòng nào): Msg 8134.
        let r = c.exec("SELECT 1/0 AS x");
        assert!(message_of(st(&r, 0)).starts_with("Msg 8134"), "{r}");
        assert_eq!(c.spid(), spid);
    }

    fn constraint_error_is_a_statement_error(s: &Server) {
        let c = s.conn();
        let r = c.exec("CREATE TABLE #dup(a int PRIMARY KEY); INSERT #dup VALUES (1),(1)");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert!(message_of(st(&r, 0)).starts_with("Msg 2627"), "{r}");
        // Batch lỗi giữa chừng: bảng đã tạo (không có transaction ngầm nào).
        assert_eq!(c.first("SELECT COUNT(*) FROM #dup"), "0");
    }

    fn script_runs_batches_in_order_and_stops_at_the_first_error(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "CREATE TABLE #z(a int)\nGO\nINSERT #z VALUES (1),(2)\nGO\nSELECT * FROM #z ORDER BY a\n\
             GO\nSELECT * FROM no_such_table_zz\nGO\nSELECT 99",
        );
        let all = statements(&r);
        assert_eq!(all.len(), 4, "batch sau lỗi không được chạy: {r}");
        assert_eq!(all[0]["kind"], "affected");
        assert_eq!(all[1]["rowsAffected"], 2);
        assert_eq!(all[2]["rows"], json!([["1"], ["2"]]));
        assert_eq!(code_of(&all[3]), "sqlError");
        for (i, x) in all.iter().enumerate() {
            assert_eq!(x["index"], i);
        }
        // Mỗi statement giữ đúng text batch của nó (không có dòng `GO`).
        assert_eq!(all[0]["sql"], "CREATE TABLE #z(a int)");
        assert_eq!(all[3]["sql"], "SELECT * FROM no_such_table_zz");
    }

    /// Plan N7: batch có `GO` gồm INSERT + SELECT cho hai Result.
    fn two_go_batches_give_two_results_and_the_insert_batch_gives_the_select(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1 AS a\nGO\nSELECT 2 AS b");
        let all = statements(&r);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["columns"][0]["name"], "a");
        assert_eq!(all[0]["rows"], json!([["1"]]));
        assert_eq!(all[1]["columns"][0]["name"], "b");
        assert_eq!(all[1]["rows"], json!([["2"]]));
        assert_eq!((all[0]["index"].clone(), all[1]["index"].clone()), (json!(0), json!(1)));

        let r = c.exec(
            "CREATE TABLE #g(a int)\nGO\nINSERT #g VALUES (1),(2)\nSELECT a FROM #g ORDER BY a\n\
             GO\nSELECT COUNT(*) AS n FROM #g",
        );
        let all = statements(&r);
        assert_eq!(all.len(), 3, "{r}");
        assert_eq!(all[0]["kind"], "affected");
        assert_eq!(all[1]["rows"], json!([["1"], ["2"]]));
        assert_eq!(all[2]["rows"], json!([["2"]]));
    }

    /// Nhiều result set trong MỘT batch (không có `GO`) thành nhiều Result cùng `index`.
    fn several_result_sets_in_one_batch_share_the_index(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c");
        let all = statements(&r);
        assert_eq!(all.len(), 3);
        for (i, name) in ["a", "b", "c"].into_iter().enumerate() {
            assert_eq!(all[i]["columns"][0]["name"], name);
            assert_eq!(all[i]["rows"], json!([[(i + 1).to_string()]]));
            assert_eq!(all[i]["index"], 0);
        }
    }

    /// `GO 5` (lặp batch) KHÔNG hỗ trợ: dòng đó được gửi nguyên cho server nên server báo cú pháp.
    /// Giới hạn đã biết, ghi nhận để khi hỗ trợ thì đổi test này.
    fn known_limit_go_with_a_count_is_sent_to_the_server_and_fails(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1\nGO 5\nSELECT 2");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert!(message_of(st(&r, 0)).starts_with("Msg 102"), "{r}");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn empty_or_go_only_script_has_no_statements(s: &Server) {
        let c = s.conn();
        for sql in ["", "   \n  ", "GO", "GO\nGO\n  go  ", "-- chỉ có comment"] {
            let r = c.exec(sql);
            if sql.starts_with("--") {
                // Comment trần vẫn được gửi cho server: không có gì để chạy nên không lỗi.
                assert!(r["ok"] == true, "{sql:?}: {r}");
            } else {
                assert_eq!(statements(&r).len(), 0, "{sql:?}: {r}");
            }
        }
        assert_eq!(c.first("SELECT 1"), "1");
    }

    /// Plan N7: procedure tạo được (`CREATE PROCEDURE` phải đứng một mình trong batch nên cần `GO`).
    fn procedures_can_be_created_and_called(s: &Server) {
        let c = s.conn();
        let r = c.exec("CREATE PROCEDURE #p_rows AS BEGIN SELECT 41 + 1 AS answer END\nGO\nEXEC #p_rows");
        let all = statements(&r);
        assert_eq!(all.len(), 2, "{r}");
        assert_eq!(all[0]["kind"], "affected");
        assert_eq!(all[1]["rows"], json!([["42"]]));
        assert_eq!(all[1]["index"], 1);
        // Procedure không có result set chỉ trả `affected`; biến phiên không tồn tại giữa các batch
        // nhưng bảng tạm thì có.
        let r = c.exec(
            "CREATE TABLE #pt(a int)\nGO\nCREATE PROCEDURE #p_ins AS BEGIN INSERT #pt VALUES (7) END\nGO\nEXEC #p_ins",
        );
        assert_eq!(statements(&r).len(), 3, "{r}");
        assert_eq!(st(&r, 2)["kind"], "affected");
        assert_eq!(c.first("SELECT a FROM #pt"), "7");
    }

    fn calling_a_missing_procedure_is_a_statement_error(s: &Server) {
        let c = s.conn();
        let r = c.exec("EXEC no_such_proc_zz\nGO\nSELECT 2");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert!(message_of(st(&r, 0)).starts_with("Msg 2812"), "{r}");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn session_state_and_transactions_persist_between_executes(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #tx(a int)"));
        ok(&c.exec("BEGIN TRAN"));
        ok(&c.exec("INSERT #tx VALUES (1),(2)"));
        assert_eq!(c.first("SELECT COUNT(*) FROM #tx"), "2");
        assert_eq!(c.first("SELECT @@TRANCOUNT"), "1");
        ok(&c.exec("ROLLBACK"));
        assert_eq!(c.first("SELECT COUNT(*) FROM #tx"), "0");
        assert_eq!(c.first("SELECT @@TRANCOUNT"), "0");
        ok(&c.exec("USE tempdb"));
        assert_eq!(c.first("SELECT DB_NAME()"), "tempdb");
    }

    // ---- phân trang ----

    /// Plan: 1.234 dòng, trang 500 -> 500 / 500 / 234 + `done`.
    fn paging_fetches_every_row_exactly_once(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_ms(1234), 500, MAX_BYTES);
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
        assert_eq!(p3["rows"].as_array().unwrap().len(), 234);
        assert_eq!(p3["done"], true);
        assert_eq!(p3["rows"][233], json!(["1234", "row 1234"]));

        // Cursor hết dòng thì bị bỏ.
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn exact_page_size_result_gives_a_cursor_then_an_empty_done_page(s: &Server) {
        let c = s.conn();
        // Trang vừa đầy thì chưa biết hết dòng, trang kế rỗng và `done`.
        let r = c.exec_page(&series_ms(10), 10, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(x["rows"].as_array().unwrap().len(), 10);
        assert_eq!(x["done"], false, "{x}");
        let cursor = x["cursorId"].as_u64().unwrap();
        let f = c.fetch_page(cursor, 10, MAX_BYTES);
        assert_eq!(ok(&f)["rows"], json!([]));
        assert_eq!(ok(&f)["done"], true);
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn page_size_larger_than_the_result_is_done(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_ms(3), 500, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], true);
        assert_eq!(row_count(&r, 0), 3);
        assert!(st(&r, 0)["cursorId"].is_null());
    }

    fn max_page_bytes_limits_the_page(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_ms(1000), 1000, 2000);
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

    fn a_single_row_larger_than_max_page_bytes_is_still_returned(s: &Server) {
        let c = s.conn();
        let r = c.exec_page("SELECT REPLICATE(CAST('x' AS varchar(max)), 100000) AS big", 10, 100);
        let x = st(&r, 0);
        assert_eq!(x["rows"].as_array().unwrap().len(), 1);
        assert_eq!(x["rows"][0][0].as_str().unwrap().len(), 100_000);
        // Trang đầy theo byte nên chưa biết hết dòng; trang kế rỗng và `done` (như trang đầy theo số dòng).
        assert_eq!(x["done"], false);
        let cursor = x["cursorId"].as_u64().unwrap();
        let f = c.fetch_page(cursor, 10, 100);
        assert_eq!(ok(&f)["rows"], json!([]));
        assert_eq!(ok(&f)["done"], true);
    }

    fn non_last_batch_with_more_rows_is_truncated_and_the_last_keeps_the_cursor(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(
            &format!("{}\nGO\n{}", series_ms(900), series_ms(700)),
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
        // Connection còn đồng bộ sau khi bỏ dở result set của batch đầu.
        drop_cursor_by_running(&c);
        assert_eq!(c.first("SELECT 5"), "5");
    }

    /// Result set đầu của MỘT batch nhiều result set mà còn dòng: chỉ lấy trang đầu và bỏ các set sau.
    fn truncated_first_result_set_of_a_batch_skips_the_later_sets(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&format!("{}; SELECT 7 AS z", series_ms(300)), 50, MAX_BYTES);
        let all = statements(&r);
        assert_eq!(all.len(), 1, "set sau không được đọc khi set trước còn dòng: {r}");
        assert_eq!(all[0]["done"], false);
        // Connection còn đồng bộ.
        assert_eq!(c.first("SELECT 5"), "5");
    }

    fn fetch_with_unknown_cursor_or_connection_has_stable_codes(s: &Server) {
        let c = s.conn();
        assert_eq!(err_code(&c.fetch(987_654_321)), "cursorNotFound");
        assert_eq!(err_code(&fetch(987_654_321, 1)), "connNotFound");
        assert_eq!(err_code(&exec(987_654_321, "SELECT 1")), "connNotFound");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn a_new_execute_drops_the_previous_cursor(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_ms(100), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        assert_eq!(c.first("SELECT 2"), "2");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
    }

    /// Lỗi giữa trang đầu (sau vài dòng): trả các dòng trước, rồi một Result lỗi cùng `index`.
    fn error_after_some_rows_in_the_first_page_gives_rows_then_an_error_statement(s: &Server) {
        let c = s.conn();
        let spid = c.spid();
        let r = c.exec_page(
            &format!("SELECT 1/(x - 3) AS v FROM ({}) q", series_ms(10)),
            100,
            MAX_BYTES,
        );
        let all = statements(&r);
        assert_eq!(all.len(), 2, "{r}");
        assert_eq!(all[0]["kind"], "rows");
        assert_eq!(all[0]["rows"], json!([["0"], ["-1"]]));
        assert_eq!(all[0]["done"], true);
        assert!(all[0]["cursorId"].is_null());
        assert_eq!(all[1]["index"], 0);
        assert!(message_of(&all[1]).starts_with("Msg 8134"), "{r}");
        // Server báo lỗi trọn vẹn nên connection còn nguyên session.
        assert_eq!(c.spid(), spid);
    }

    fn error_in_the_middle_of_a_fetch_is_reported_and_the_connection_survives(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #keep(a int)"));
        let spid = c.spid();
        // Dòng x = 700 chia cho 0; các dòng trước đó phải tới đủ (699 dòng).
        let r = c.exec_page(
            &format!("SELECT 1/(x - 700) AS v FROM ({}) q", series_ms(1000)),
            100,
            MAX_BYTES,
        );
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        let mut rows = st(&r, 0)["rows"].as_array().unwrap().len();
        let mut failure = None;
        for _ in 0..20 {
            let f = c.fetch_page(cursor, 100, MAX_BYTES);
            if f["ok"] != true {
                failure = Some(f);
                break;
            }
            assert_eq!(f["result"]["done"], false, "lỗi phải tới trước khi hết dòng");
            rows += f["result"]["rows"].as_array().unwrap().len();
        }
        let f = failure.expect("fetch phải gặp lỗi chia cho 0");
        assert_eq!(err_code(&f), "sqlError");
        assert!(
            f["error"]["message"].as_str().unwrap().starts_with("Msg 8134"),
            "{f}"
        );
        assert_eq!(rows, 699, "đủ các dòng trước dòng lỗi, không mất không trùng");
        // Cursor đã bị bỏ, connection dùng tiếp được và vẫn là session cũ.
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.spid(), spid);
        assert_eq!(c.first("SELECT COUNT(*) FROM #keep"), "0");
    }

    fn close_with_an_open_cursor_succeeds(s: &Server) {
        let r = s.open("disable");
        let id = ok(&r)["connId"].as_u64().unwrap();
        let r = exec_page(id, &endless_rows("closing"), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": id})));
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
        assert_eq!(err_code(&exec(id, "SELECT 1")), "connNotFound");
    }

    // ---- bỏ cursor ----

    /// Plan: bỏ cursor 100.000 dòng thì lệnh kế không treo (< 1 giây). Server đọc bỏ kịp thì chạy
    /// luôn; không kịp thì connection bị thay và lệnh kế báo reset, chạy lại mới ra kết quả.
    fn abandoning_a_big_cursor_makes_the_next_command_fast(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&series_ms(100_000), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        let t0 = Instant::now();
        let mut r = c.exec("SELECT 5");
        if is_reset_notice(&r) {
            r = c.exec("SELECT 5");
        }
        assert_eq!(first_cell(&r), "5");
        assert!(t0.elapsed() < Duration::from_secs(1), "{:?}", t0.elapsed());
    }

    /// Cursor vô tận (không bao giờ đọc hết): vẫn không treo, nhưng session cũ bị bỏ (đóng TCP,
    /// nối lại) nên bảng tạm mất; lệnh kế báo reset (B1), chạy lại mới ra kết quả.
    fn abandoning_an_endless_cursor_replaces_the_connection(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #gone(a int)"));
        let old_link = c.link();
        let m = marker("ab_endless");
        let r = c.exec_page(&endless_rows(&m), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        assert!(is_reset_notice(&c.exec("SELECT 5")));
        assert_eq!(c.first("SELECT 5"), "5");
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        assert_ne!(c.link(), old_link, "connection phải được thay");
        let r = c.exec("SELECT COUNT(*) FROM #gone");
        assert!(message_of(st(&r, 0)).starts_with("Msg 208"), "{r}");
        // Server dừng câu vô tận sau khi TCP đóng.
        wait_until_gone(&monitor, &m);
        wait_for(Duration::from_secs(10), "session cũ đóng", || {
            !link_exists(&monitor, &old_link)
        });
    }

    /// B1 (a), theo B5: phiên đã có trạng thái (`USE`) mà bị bỏ cursor thì câu kế báo notice
    /// (lỗi `sqlError`) đúng một lần, câu thứ ba chạy bình thường.
    fn abandoning_a_cursor_reports_the_reset_once_then_runs_normally(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        ok(&c.exec("USE tempdb"));
        let m = marker("b1_once");
        ok(&c.exec_page(&endless_rows(&m), 10, MAX_BYTES));
        wait_until_active(&monitor, &m);
        let r = c.exec("SELECT 2");
        assert!(is_reset_notice(&r), "{r}");
        assert_eq!(code_of(st(&r, 0)), "sqlError", "{r}");
        assert!(message_of(st(&r, 0)).contains("run again"), "{r}");
        assert_eq!(c.first("SELECT 3"), "3");
        assert_eq!(c.first("SELECT 4"), "4");
    }

    /// B5: phiên sạch (chỉ `SELECT`) bị bỏ cursor thì connection vẫn được thay nhưng KHÔNG có
    /// notice: câu kế chạy bình thường ngay lần đầu (trước B5 luôn có notice).
    fn abandoning_a_cursor_in_a_clean_session_runs_the_next_command_without_notice(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        assert_eq!(c.first("SELECT 1"), "1");
        let old_link = c.link();
        let m = marker("b5_clean");
        ok(&c.exec_page(&endless_rows(&m), 10, MAX_BYTES));
        wait_until_active(&monitor, &m);
        let r = c.exec("SELECT 2");
        assert!(!is_reset_notice(&r), "{r}");
        assert_eq!(first_cell(&r), "2");
        assert_eq!(c.first("SELECT 3"), "3");
        assert_ne!(c.link(), old_link, "connection vẫn phải được thay");
        wait_until_gone(&monitor, &m);
    }

    /// B5: mỗi kiểu thay đổi trạng thái phiên đều làm notice xuất hiện (đúng một lần), và sau
    /// notice phiên mới là phiên sạch nên lần bỏ cursor kế tiếp không còn notice.
    fn each_session_state_change_makes_the_notice_appear_and_the_new_session_is_clean(s: &Server) {
        let monitor = s.conn();
        let dirties = [
            "USE tempdb",
            "SET NOCOUNT ON",
            "CREATE TABLE #b5_t(a int)",
            "EXEC sp_executesql N'SELECT 1'",
            "BEGIN TRAN
GO
COMMIT",
        ];
        for dirty in dirties {
            let c = s.conn();
            ok(&c.exec(dirty));
            let m = marker("b5_dirty");
            ok(&c.exec_page(&endless_rows(&m), 10, MAX_BYTES));
            wait_until_active(&monitor, &m);
            assert!(is_reset_notice(&c.exec("SELECT 2")), "{dirty}");
            assert_eq!(c.first("SELECT 3"), "3", "{dirty}");
            // Phiên mới sạch: bỏ cursor lần nữa thì không còn notice.
            let m2 = marker("b5_again");
            ok(&c.exec_page(&endless_rows(&m2), 10, MAX_BYTES));
            wait_until_active(&monitor, &m2);
            assert!(!is_reset_notice(&c.exec("SELECT 4")), "{dirty}: lần hai");
            wait_until_gone(&monitor, &m);
            wait_until_gone(&monitor, &m2);
        }
    }

    /// B1 (b): notice chặn các câu sau trong cùng request (không câu nào chạy), kể cả câu ghi.
    /// (Theo B5, phiên phải có trạng thái thì mới có notice nên chạy `USE` trước.)
    fn the_reset_notice_stops_the_later_statements_of_the_same_request(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        ok(&c.exec("USE tempdb"));
        let m = marker("b1_stop");
        ok(&c.exec_page(&endless_rows(&m), 10, MAX_BYTES));
        wait_until_active(&monitor, &m);
        let r = c.exec("SELECT 1
GO
CREATE TABLE #blocked(a int)
GO
SELECT 3");
        assert!(is_reset_notice(&r), "{r}");
        assert_eq!(statements(&r).len(), 1, "{r}");
        assert_eq!(c.first("SELECT OBJECT_ID('tempdb..#blocked')"), Value::Null);
        // Chạy lại thì cả ba câu chạy.
        let r = c.exec("SELECT 1
GO
CREATE TABLE #blocked(a int)
GO
SELECT 3");
        assert_eq!(statements(&r).len(), 3, "{r}");
        assert_eq!(st(&r, 2)["rows"][0][0], "3");
    }

    /// B1 (c): huỷ do người dùng thì KHÔNG có notice (Q23 = A): lệnh kế chạy ngay trên connection mới.
    fn a_user_cancel_does_not_produce_the_reset_notice(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let m = marker("b1_cancel");
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("WAITFOR DELAY '00:00:30'; SELECT '{m}' AS m"));
        wait_until_active(&monitor, &m);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        let r = c.exec("SELECT 1
GO
SELECT 2");
        assert!(!is_reset_notice(&r), "{r}");
        assert_eq!(statements(&r).len(), 2, "{r}");
        assert_eq!(st(&r, 1)["rows"][0][0], "2");
    }

    /// B1 (d): `USE tempdb` rồi `SELECT` lớn (pageSize 500), bỏ cursor: câu kế (`SELECT DB_NAME()`
    /// hoặc `DELETE`) KHÔNG chạy trên database mặc định mà báo reset; chạy lại thì DB_NAME là database
    /// của profile (`master`) và `DELETE` mới có hiệu lực.
    fn after_use_tempdb_and_an_abandoned_cursor_nothing_runs_on_the_default_database(s: &Server) {
        let monitor = s.conn();
        let probe = s.conn();
        let c = s.conn();
        let table = format!("##b1_probe_{}", next_id());
        ok(&probe.exec(&format!("CREATE TABLE {table}(a int); INSERT {table} VALUES (1)")));
        let count = || probe.first(&format!("SELECT COUNT(*) FROM {table}"));
        let delete = format!("DELETE FROM {table}");
        for next in ["SELECT DB_NAME()", delete.as_str()] {
            let m = marker("b1_use");
            let sql = format!("USE tempdb
GO
{}", endless_rows(&m));
            let r = c.exec_page(&sql, 500, MAX_BYTES);
            assert_eq!(st(&r, 1)["done"], false, "{r}");
            wait_until_active(&monitor, &m);

            assert!(is_reset_notice(&c.exec(next)), "{next}");
            assert_eq!(count(), "1", "{next} không được chạy");
            let r = c.exec(next);
            assert!(!is_reset_notice(&r), "{next}: {r}");
            assert_eq!(c.first("SELECT DB_NAME()"), "master", "{next}");
        }
        assert_eq!(count(), "0");
    }

    /// B3: batch `SELECT` lớn kèm `; UPDATE` phía sau không được coi là cancel-an-toàn: bỏ cursor
    /// thì phải đọc bỏ để `UPDATE` chạy nốt (không huỷ giữa chừng làm mất ghi), và không đổi
    /// connection nên không có notice.
    fn abandoning_a_select_followed_by_an_update_still_runs_the_update(s: &Server) {
        let probe = s.conn();
        let c = s.conn();
        let table = format!("##b3_probe_{}", next_id());
        ok(&probe.exec(&format!("CREATE TABLE {table}(a int); INSERT {table} VALUES (1)")));
        let spid = c.spid();
        let r = c.exec_page(
            &format!("{}; UPDATE {table} SET a = 2", series_ms(100_000)),
            10,
            MAX_BYTES,
        );
        assert_eq!(st(&r, 0)["done"], false, "{r}");
        let r = c.exec("SELECT 1");
        assert!(!is_reset_notice(&r), "{r}");
        assert_eq!(first_cell(&r), "1");
        assert_eq!(probe.first(&format!("SELECT a FROM {table}")), "2");
        assert_eq!(c.spid(), spid, "đọc bỏ, không thay connection");
    }

    /// Cursor nhỏ đã nằm hết trong buffer: đọc bỏ nhanh nên KHÔNG đổi connection (bảng tạm còn).
    fn abandoning_a_small_cursor_keeps_the_session(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #stay(a int)"));
        let spid = c.spid();
        let r = c.exec_page(&series_ms(30), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        assert_eq!(c.first("SELECT COUNT(*) FROM #stay"), "0");
        assert_eq!(c.spid(), spid);
    }

    /// Trong transaction tự mở thì bỏ cursor chỉ đọc bỏ chứ không đổi connection, để không mất
    /// transaction (và bảng tạm).
    fn abandoning_a_cursor_inside_a_transaction_keeps_the_transaction(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #intx(a int)"));
        ok(&c.exec("BEGIN TRAN"));
        ok(&c.exec("INSERT #intx VALUES (1)"));
        let spid = c.spid();
        let r = c.exec_page(&series_ms(200_000), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        assert_eq!(c.first("SELECT COUNT(*) FROM #intx"), "1");
        assert_eq!(c.spid(), spid);
        assert_eq!(c.first("SELECT @@TRANCOUNT"), "1");
        ok(&c.exec("ROLLBACK"));
        assert_eq!(c.first("SELECT COUNT(*) FROM #intx"), "0");
    }

    /// B9: `BEGIN TRAN` lồng trong `BEGIN TRY` vẫn là transaction tự mở: bỏ cursor lớn chỉ đọc bỏ
    /// (không đổi connection, không notice) nên `@@TRANCOUNT` vẫn là 1 trên cùng connection.
    fn begin_tran_inside_try_keeps_the_transaction_when_a_cursor_is_abandoned(s: &Server) {
        let probe = s.conn();
        let c = s.conn();
        let table = format!("##b9_probe_{}", next_id());
        ok(&probe.exec(&format!("CREATE TABLE {table}(a int); INSERT {table} VALUES (1)")));
        let spid = c.spid();
        let link = c.link();
        ok(&c.exec(&format!(
            "BEGIN TRY BEGIN TRAN; UPDATE {table} SET a=2; END TRY BEGIN CATCH ROLLBACK END CATCH"
        )));
        let r = c.exec_page(&series_ms(200_000), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false, "{r}");
        // Bỏ cursor bằng câu kế: phải đọc bỏ chứ không thay connection.
        let r = c.exec("SELECT @@TRANCOUNT");
        assert!(!is_reset_notice(&r), "{r}");
        assert_eq!(first_cell(&r), "1");
        assert_eq!(c.spid(), spid);
        assert_eq!(c.link(), link, "không được thay connection");
        ok(&c.exec("ROLLBACK"));
        assert_eq!(probe.first(&format!("SELECT a FROM {table}")), "1");
    }

    /// B13: batch TRY/CATCH đã `COMMIT` thì `@@TRANCOUNT` = 0 nên `in_tx` không còn kẹt `true`:
    /// bỏ cursor vô tận phải thay connection (không đọc bỏ mãi), lệnh kế nhanh, và dữ liệu đã
    /// commit vẫn còn. Batch chứa `BEGIN TRAN`/`##` nên phiên bị coi là có trạng thái: lệnh kế
    /// báo notice reset một lần rồi chạy bình thường (như B5). Bảng `##` do `monitor` tạo (không
    /// phải `c`) nên còn sau khi `c` đổi connection; `##` đã bị xoá cùng session tạo ra nó.
    fn begin_tran_inside_try_then_commit_does_not_leave_the_session_in_a_transaction(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let table = format!("##b13_probe_{}", next_id());
        ok(&monitor.exec(&format!("CREATE TABLE {table}(a int); INSERT {table} VALUES (1)")));
        ok(&c.exec(&format!(
            "BEGIN TRY BEGIN TRAN; UPDATE {table} SET a=2; COMMIT; END TRY BEGIN CATCH ROLLBACK END CATCH"
        )));
        assert_eq!(c.first("SELECT @@TRANCOUNT"), "0");
        let old_link = c.link();
        let m = marker("b13_commit");
        ok(&c.exec_page(&endless_rows(&m), 10, MAX_BYTES));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        let mut r = c.exec("SELECT 1");
        if is_reset_notice(&r) {
            r = c.exec("SELECT 1");
        }
        assert_eq!(first_cell(&r), "1", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
        assert_ne!(c.link(), old_link, "không còn transaction nên phải thay connection");
        assert_eq!(monitor.first(&format!("SELECT a FROM {table}")), "2");
        wait_until_gone(&monitor, &m);
    }

    /// P2 + T2: đang trong transaction tự mở và còn cursor VÔ TẬN: `close` không được treo vì đọc
    /// bỏ (code cũ `abandon` khi close sẽ đọc bỏ tới DRAIN_TIMEOUT 30 s), và câu ở server dừng.
    fn close_inside_a_transaction_with_a_big_cursor_is_fast(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        ok(&c.exec("BEGIN TRAN"));
        let m = marker("p2_close");
        let r = c.exec_page(&endless_rows(&m), 10, MAX_BYTES);
        assert_eq!(st(&r, 0)["done"], false);
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": c.id})));
        assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
        assert_eq!(err_code(&c.exec("SELECT 1")), "connNotFound");
        wait_until_gone(&monitor, &m);
    }

    /// B1: `close` khi đang có câu chạy dài: câu đó nhận `cancelled`, close xong < 2 giây, connection
    /// biến mất khỏi registry.
    fn close_cancels_a_running_waitfor_and_returns_fast(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let m = marker("b1_close");
        let t = c.exec_in_thread(next_id(), &format!("WAITFOR DELAY '00:00:30'; SELECT '{m}' AS m"));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": c.id})));
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        assert_eq!(err_code(&c.exec("SELECT 1")), "connNotFound");
        wait_until_gone(&monitor, &m);
    }

    // ---- huỷ ----

    /// Plan: huỷ `WAITFOR DELAY '00:00:30'` -> `cancelled` trong < 2 giây; connection dùng được sau
    /// đó nhưng là connection MỚI cùng cấu hình (Q23 = A): bảng `#temp`, `USE`, `SET` mất.
    fn cancel_waitfor_returns_cancelled_fast_and_reconnects_with_a_fresh_session(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #temp_lost(a int)"));
        ok(&c.exec("USE tempdb"));
        let old_link = c.link();
        assert_eq!(c.first("SELECT DB_NAME()"), "tempdb");

        let m = marker("cancel_wait");
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("WAITFOR DELAY '00:00:30'; SELECT '{m}' AS m"));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());

        // Lệnh kế nối lại: session mới, mất trạng thái của session cũ.
        assert_eq!(c.first("SELECT 1"), "1");
        assert_ne!(c.link(), old_link);
        assert_eq!(c.first("SELECT DB_NAME()"), "master");
        let r = c.exec("SELECT COUNT(*) FROM #temp_lost");
        assert!(message_of(st(&r, 0)).starts_with("Msg 208"), "{r}");
        // Connection mới giữ packet size đã xin, và server đã dừng câu cũ.
        assert!(packet_size(&c) >= 32_000, "{}", packet_size(&c));
        wait_until_gone(&monitor, &m);
        wait_for(Duration::from_secs(10), "session cũ đóng", || {
            !link_exists(&monitor, &old_link)
        });
    }

    /// Huỷ lúc đang `fetch` một cursor vô tận (trang khổng lồ nên fetch chạy tới khi bị huỷ):
    /// `cancelled`, cursor mất, connection mới dùng được.
    fn cancel_during_fetch_returns_cancelled_and_the_connection_recovers(s: &Server) {
        let c = s.conn();
        let r = c.exec_page(&endless_rows("cancel_fetch"), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        let id = next_id();
        let conn = c.id;
        let t = std::thread::spawn(move || {
            call_with_id(
                id,
                "fetch",
                json!({
                    "connId": conn, "cursorId": cursor,
                    "pageSize": 1_000_000_000u64, "maxPageBytes": 1u64 << 32
                }),
            )
        });
        // `cancel` bị bỏ qua nếu tới trước lúc request được đăng ký: lặp tới khi fetch kết thúc.
        let t0 = Instant::now();
        while !t.is_finished() {
            cancel(id);
            assert!(t0.elapsed() < Duration::from_secs(10), "fetch không chịu dừng");
            std::thread::yield_now();
        }
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.first("SELECT 7"), "7");
    }

    fn cancelling_an_unknown_or_finished_request_changes_nothing(s: &Server) {
        let c = s.conn();
        cancel(987_654_321);
        let id = next_id();
        let r = call_with_id(id, "execute", json!({"connId": c.id, "sql": "SELECT 1", "pageSize": 10, "maxPageBytes": MAX_BYTES}));
        assert_eq!(first_cell(&r), "1");
        let spid = c.spid();
        let link = c.link();
        cancel(id);
        assert_eq!(c.first("SELECT 2"), "2");
        assert_eq!(c.spid(), spid);
        assert_eq!(c.link(), link, "huỷ request đã xong không được đổi connection");
    }

    /// Huỷ một connection không ảnh hưởng connection khác (kể cả cursor đang mở của nó).
    fn cancelling_one_connection_leaves_the_others_untouched(s: &Server) {
        let monitor = s.conn();
        let a = s.conn();
        let b = s.conn();
        let r = b.exec_page(&series_ms(100), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        let m = marker("iso_cancel");
        let id = next_id();
        let t = a.exec_in_thread(id, &format!("WAITFOR DELAY '00:00:30'; SELECT '{m}'"));
        wait_until_active(&monitor, &m);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        let f = b.fetch_page(cursor, 100, MAX_BYTES);
        assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 90);
        assert_eq!(ok(&f)["done"], true);
    }

    // ---- mất kết nối ----

    /// Server đóng session giữa chừng (`KILL`): lệnh kế lỗi, lệnh sau đó nối lại tự động.
    fn a_killed_session_fails_once_then_reconnects(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let old = c.spid();
        let old_link = c.link();
        ok(&monitor.exec(&format!("KILL {old}")));
        wait_for(Duration::from_secs(10), "session bị kill", || {
            !link_exists(&monitor, &old_link)
        });
        let r = c.exec("SELECT 1");
        let failed = r["ok"] == false || !st(&r, 0)["error"].is_null();
        assert!(failed, "lệnh trên session đã chết không được thành công: {r}");
        assert!(!s.password_leaks_in(&r));
        // Lệnh sau đó tự nối lại connection mới.
        assert_eq!(c.first("SELECT 2"), "2");
        assert_ne!(c.link(), old_link);
    }

    // ---- method chỉ SQLite có ----

    fn schema_methods_are_invalid_request_for_sqlserver(s: &Server) {
        let c = s.conn();
        for (method, params) in [
            ("schemaTree", json!({"connId": c.id})),
            ("tableInfo", json!({"connId": c.id, "table": "t"})),
            ("tableRows", json!({"connId": c.id, "table": "t"})),
        ] {
            let r = call(method, params);
            assert_eq!(err_code(&r), "invalidRequest", "{method}: {r}");
        }
        assert_eq!(c.first("SELECT 1"), "1");
    }

    // ---- nhiều connection ----

    fn connections_are_isolated_from_each_other(s: &Server) {
        let a = s.conn();
        let b = s.conn();
        ok(&a.exec("CREATE TABLE #iso(a int)"));
        ok(&a.exec("INSERT #iso VALUES (1)"));
        let r = b.exec("SELECT * FROM #iso");
        assert_eq!(code_of(st(&r, 0)), "sqlError");
        assert_ne!(a.spid(), b.spid());
        ok(&a.exec("USE tempdb"));
        assert_eq!(b.first("SELECT DB_NAME()"), "master");
        assert_eq!(a.first("SELECT DB_NAME()"), "tempdb");
    }

    fn many_connections_can_run_concurrently(s: &Server) {
        let conns: Vec<Conn> = (0..6).map(|_| s.conn()).collect();
        let handles: Vec<_> = conns
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (id, sql) = (c.id, format!("WAITFOR DELAY '00:00:00.100'; SELECT {i} AS i"));
                std::thread::spawn(move || first_cell(&exec(id, &sql)))
            })
            .collect();
        for (i, h) in handles.into_iter().enumerate() {
            assert_eq!(h.join().unwrap(), i.to_string());
        }
    }

    // ---- kiểu dữ liệu ----

    fn integer_types_keep_their_exact_extremes(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #int(a tinyint, b smallint, c int, d bigint)"));
        ok(&c.exec(
            "INSERT #int VALUES (0, -32768, -2147483648, -9223372036854775808), \
             (255, 32767, 2147483647, 9223372036854775807), (NULL, NULL, NULL, NULL)",
        ));
        let r = c.exec("SELECT * FROM #int ORDER BY d");
        let x = st(&r, 0);
        assert_eq!(types(x), ["tinyint", "smallint", "int", "bigint"]);
        assert_eq!(
            x["rows"],
            json!([
                [null, null, null, null],
                ["0", "-32768", "-2147483648", "-9223372036854775808"],
                ["255", "32767", "2147483647", "9223372036854775807"],
            ])
        );
    }

    fn bit_is_zero_one_or_null(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT CAST(1 AS bit) AS a, CAST(0 AS bit) AS b, CAST(NULL AS bit) AS c");
        let x = st(&r, 0);
        assert_eq!(types(x), ["bit", "bit", "bit"]);
        assert_eq!(x["rows"], json!([["1", "0", null]]));
    }

    fn real_and_float_use_the_shortest_round_trip_text(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #fl(r real, f float)"));
        ok(&c.exec(
            "INSERT #fl VALUES (1.5, 2.25), (0.1, 1e100), (3.4E+38, -1.7976931348623157E+308), \
             (1.18E-38, 2.2250738585072014E-308), (0, 0), (NULL, NULL)",
        ));
        let r = c.exec("SELECT r, f FROM #fl ORDER BY f");
        let x = st(&r, 0);
        assert_eq!(types(x), ["real", "float"]);
        assert_eq!(
            x["rows"],
            json!([
                [null, null],
                ["3.4E+38", "-1.7976931348623157E+308"],
                ["0", "0"],
                ["1.18E-38", "2.2250738585072014E-308"],
                ["1.5", "2.25"],
                ["0.1", "1E+100"],
            ])
        );
        // Giới hạn đã biết: số thực in chữ số ngắn nhất mà đọc lại đúng, không làm tròn 15 chữ số
        // như SSMS (`0.1 + 0.2` ra `0.30000000000000004`, SSMS hiện `0.3`).
        assert_eq!(c.first("SELECT CAST(0.1 AS float) + 0.2"), "0.30000000000000004");
        // Ngưỡng ký hiệu khoa học: 1E-5 còn dạng thường, nhỏ hơn thì dạng E.
        assert_eq!(c.first("SELECT CAST(0.00001 AS float)"), "0.00001");
        assert_eq!(c.first("SELECT CAST(0.000001 AS float)"), "1E-6");
        // `-0.0` (bit dấu của 0) hiện `0`.
        assert_eq!(c.first("SELECT CAST(-0.0 AS float)"), "0");
    }

    fn money_and_smallmoney_keep_four_decimals_and_the_extremes(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #mn(m money, sm smallmoney)"));
        ok(&c.exec(
            "INSERT #mn VALUES (922337203685477.5807, 214748.3647), \
             (-922337203685477.5808, -214748.3648), (0, 0), (1234.5, 12.3), (NULL, NULL)",
        ));
        let r = c.exec("SELECT m, sm FROM #mn ORDER BY m");
        let x = st(&r, 0);
        // Giới hạn đã biết: `smallmoney` có thể hiện tên `money` (cột cho phép NULL dùng chung một
        // kiểu giao thức); chỉ kiểm giá trị.
        assert_eq!(types(x)[0], "money");
        assert_eq!(
            x["rows"],
            json!([
                [null, null],
                ["-922337203685477.5808", "-214748.3648"],
                ["0.0000", "0.0000"],
                ["1234.5000", "12.3000"],
                ["922337203685477.5807", "214748.3647"],
            ])
        );
    }

    fn decimal_and_numeric_keep_scale_sign_and_38_digits(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "SELECT CAST(3 AS decimal(10,2)) AS a, CAST(-0.0000000001 AS decimal(38,10)) AS b, \
             CAST(99999999999999999999999999999999999999 AS numeric(38,0)) AS c, \
             CAST(-99999999999999999999999999999999999999 AS numeric(38,0)) AS d, \
             CAST(0.5 AS decimal(38,38)) AS e, CAST(NULL AS decimal(5,2)) AS f, \
             CAST(12345678901234567890.1234567890 AS decimal(30,10)) AS g",
        );
        let x = st(&r, 0);
        assert_eq!(types(x), ["decimal", "decimal", "numeric", "numeric", "decimal", "decimal", "decimal"]);
        assert_eq!(
            x["rows"],
            json!([[
                "3.00",
                "-0.0000000001",
                "99999999999999999999999999999999999999",
                "-99999999999999999999999999999999999999",
                "0.50000000000000000000000000000000000000",
                null,
                "12345678901234567890.1234567890"
            ]])
        );
    }

    fn character_types_keep_unicode_padding_and_the_empty_string(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #str(a varchar(10), b nvarchar(20), c char(5), d nchar(5), e nvarchar(max))"));
        ok(&c.exec(
            "INSERT #str VALUES ('abc', N'日本語🙂é', 'ab', N'ab', N'x'), ('', N'', '', N'', N''), \
             (NULL, NULL, NULL, NULL, NULL)",
        ));
        let r = c.exec("SELECT * FROM #str ORDER BY a");
        let x = st(&r, 0);
        assert_eq!(types(x), ["varchar", "nvarchar", "char", "nchar", "nvarchar"]);
        assert_eq!(
            x["rows"],
            json!([
                [null, null, null, null, null],
                ["", "", "     ", "     ", ""],
                ["abc", "日本語🙂é", "ab   ", "ab   ", "x"],
            ])
        );
    }

    fn very_long_strings_arrive_whole(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "SELECT REPLICATE(CAST(N'é' AS nvarchar(max)), 500000) AS big, \
             REPLICATE(CAST('x' AS varchar(max)), 200000) AS v, 3 AS x",
        );
        let x = st(&r, 0);
        assert_eq!(x["rows"][0][0].as_str().unwrap().chars().count(), 500_000);
        assert_eq!(x["rows"][0][1].as_str().unwrap().len(), 200_000);
        assert_eq!(x["rows"][0][2], "3");
    }

    fn binary_types_are_lowercase_hex_with_a_0x_prefix(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #bin(a varbinary(10), b binary(4), c varbinary(max))"));
        ok(&c.exec(
            "INSERT #bin VALUES (0x00FF10, 0xAB, 0xDEADBEEF), (0x, 0x, 0x), (NULL, NULL, NULL)",
        ));
        let r = c.exec("SELECT * FROM #bin ORDER BY a");
        let x = st(&r, 0);
        assert_eq!(types(x), ["varbinary", "binary", "varbinary"]);
        assert_eq!(
            x["rows"],
            json!([
                [null, null, null],
                ["0x", "0x00000000", "0x"],
                ["0x00ff10", "0xab000000", "0xdeadbeef"],
            ])
        );
    }

    fn guid_is_uppercase_and_xml_is_text(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "SELECT CAST('6f9619ff-8b86-d011-b42d-00c04fc964ff' AS uniqueidentifier) AS g, \
             CAST(NULL AS uniqueidentifier) AS gn, CAST('<a b=\"1\">t</a>' AS xml) AS x, \
             CAST(NULL AS xml) AS xn",
        );
        let x = st(&r, 0);
        assert_eq!(types(x), ["uniqueidentifier", "uniqueidentifier", "xml", "xml"]);
        assert_eq!(
            x["rows"],
            json!([["6F9619FF-8B86-D011-B42D-00C04FC964FF", null, "<a b=\"1\">t</a>", null]])
        );
    }

    fn date_and_time_types_keep_their_scale_and_range(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "SELECT CAST('0001-01-01' AS date) AS d1, CAST('9999-12-31' AS date) AS d2, \
             CAST('2024-02-29' AS date) AS d3, \
             CAST('00:00:00' AS time(0)) AS t0, CAST('23:59:59.9' AS time(1)) AS t1, \
             CAST('01:02:03.456' AS time(3)) AS t3, CAST('23:59:59.1234567' AS time(7)) AS t7, \
             CAST('2024-02-29 23:59:59' AS datetime2(0)) AS s0, \
             CAST('9999-12-31 23:59:59.9999999' AS datetime2(7)) AS s7, \
             CAST('0001-01-01 00:00:00.000' AS datetime2(3)) AS s3, \
             CAST(NULL AS date) AS dn, CAST(NULL AS time) AS tn, CAST(NULL AS datetime2) AS sn",
        );
        let x = st(&r, 0);
        assert_eq!(
            types(x),
            [
                "date", "date", "date", "time", "time", "time", "time", "datetime2", "datetime2",
                "datetime2", "date", "time", "datetime2"
            ]
        );
        assert_eq!(
            x["rows"],
            json!([[
                "0001-01-01",
                "9999-12-31",
                "2024-02-29",
                "00:00:00",
                "23:59:59.9",
                "01:02:03.456",
                "23:59:59.1234567",
                "2024-02-29 23:59:59",
                "9999-12-31 23:59:59.9999999",
                "0001-01-01 00:00:00.000",
                null,
                null,
                null
            ]])
        );
    }

    fn datetime_rounds_to_one_third_of_a_millisecond_like_the_server(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #dt(d datetime, sd smalldatetime)"));
        ok(&c.exec(
            "INSERT #dt VALUES ('1753-01-01', '1900-01-01'), ('2024-01-01 00:00:00.003', '2024-01-01 12:34'), \
             ('2024-01-01 00:00:00.007', '2024-01-01 12:34:29'), \
             ('2024-01-01 00:00:00.010', '2024-01-01 12:34:30'), \
             ('9999-12-31 23:59:59.997', '2079-06-06 23:59'), (NULL, NULL)",
        ));
        let r = c.exec("SELECT d, sd FROM #dt ORDER BY d");
        let x = st(&r, 0);
        // Giới hạn đã biết: cột `smalldatetime` cho phép NULL có thể hiện tên `datetime`.
        assert_eq!(types(x)[0], "datetime");
        assert!(["smalldatetime", "datetime"].contains(&types(x)[1].as_str()), "{x}");
        assert_eq!(
            x["rows"],
            json!([
                [null, null],
                ["1753-01-01 00:00:00.000", "1900-01-01 00:00:00"],
                ["2024-01-01 00:00:00.003", "2024-01-01 12:34:00"],
                ["2024-01-01 00:00:00.007", "2024-01-01 12:34:00"],
                ["2024-01-01 00:00:00.010", "2024-01-01 12:35:00"],
                ["9999-12-31 23:59:59.997", "2079-06-06 23:59:00"],
            ])
        );
    }

    fn datetimeoffset_shows_local_time_with_its_offset(s: &Server) {
        let c = s.conn();
        let r = c.exec(
            "SELECT CAST('2024-02-29 23:59:59.9999999 +05:30' AS datetimeoffset(7)) AS a, \
             TODATETIMEOFFSET(CAST('2024-01-01 00:00:00' AS datetime2(0)), '-05:30') AS b, \
             TODATETIMEOFFSET(CAST('2023-12-31 23:30:00' AS datetime2(0)), '+14:00') AS c, \
             TODATETIMEOFFSET(CAST('2024-01-01 00:00:00.123' AS datetime2(3)), '-14:00') AS d, \
             TODATETIMEOFFSET(CAST('2024-06-01 12:00:00' AS datetime2(0)), '+00:00') AS e, \
             CAST(NULL AS datetimeoffset) AS f",
        );
        let x = st(&r, 0);
        assert_eq!(types(x)[0], "datetimeoffset");
        assert_eq!(
            x["rows"],
            json!([[
                "2024-02-29 23:59:59.9999999 +05:30",
                "2024-01-01 00:00:00 -05:30",
                "2023-12-31 23:30:00 +14:00",
                "2024-01-01 00:00:00.123 -14:00",
                "2024-06-01 12:00:00 +00:00",
                null
            ]])
        );
    }

    fn legacy_text_ntext_image_and_rowversion_are_readable(s: &Server) {
        let c = s.conn();
        ok(&c.exec("CREATE TABLE #old(a text, b ntext, c image, v rowversion)"));
        ok(&c.exec("INSERT #old (a, b, c) VALUES ('text', N'ntext 日本', 0x0102), (NULL, NULL, NULL)"));
        let r = c.exec("SELECT a, b, c, v FROM #old ORDER BY v");
        let x = st(&r, 0);
        assert_eq!(&types(x)[..3], ["text", "ntext", "image"]);
        // ORDER BY rowversion: dòng chèn trước (có dữ liệu) đứng trước dòng NULL.
        assert_eq!(x["rows"][0].as_array().unwrap()[..3], [json!("text"), json!("ntext 日本"), json!("0x0102")]);
        assert_eq!(x["rows"][1].as_array().unwrap()[..3], [json!(null), json!(null), json!(null)]);
        // rowversion là 8 byte nhị phân.
        let v = x["rows"][0][3].as_str().unwrap();
        assert!(v.starts_with("0x") && v.len() == 2 + 16, "{v}");
    }

    /// `sql_variant` và kiểu CLR (`hierarchyid`, `geography`) đọc được: variant hiện giá trị, kiểu
    /// CLR hiện bytes dạng hex (không có `ToString()` của server).
    fn sql_variant_and_clr_types_do_not_break_the_connection(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT CAST(1 AS sql_variant) AS v, CAST(N'x' AS sql_variant) AS w");
        assert_eq!(st(&r, 0)["rows"], json!([["1", "x"]]), "{r}");
        assert_eq!(types(st(&r, 0)), ["sql_variant", "sql_variant"]);
        let r = c.exec("SELECT CAST('/1/' AS hierarchyid) AS h");
        assert_eq!(st(&r, 0)["rows"], json!([["0x58"]]), "{r}");
        assert_eq!(types(st(&r, 0)), ["udt"]);
        let r = c.exec("SELECT geography::Point(1, 2, 4326) AS g");
        let g = st(&r, 0)["rows"][0][0].as_str().unwrap().to_owned();
        assert!(g.starts_with("0xe6100000"), "{g}");
        assert_eq!(c.first("SELECT 1"), "1");
    }

    fn column_names_can_be_empty_duplicated_or_unicode(s: &Server) {
        let c = s.conn();
        let r = c.exec("SELECT 1, 2 AS x, 3 AS x, 4 AS [cột có dấu], 5 AS [a;b]");
        let names: Vec<&str> = st(&r, 0)["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["", "x", "x", "cột có dấu", "a;b"]);
        assert_eq!(st(&r, 0)["rows"], json!([["1", "2", "3", "4", "5"]]));
    }

    // ---- bảo mật ----

    fn error_messages_never_contain_the_password(s: &Server) {
        let c = s.conn();
        for sql in ["SELECT * FROM no_such_table_zz", "SELECT )", "SELECT 1/0"] {
            let r = c.exec(sql);
            assert!(!s.password_leaks_in(&r), "{sql}");
        }
    }
}

/// Lỗi cấp request: `error.message`.
fn message_of_err(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

/// Bỏ cursor còn lại của `c` bằng một lệnh không liên quan (cho test không muốn để cursor mở).
fn drop_cursor_by_running(c: &Conn) {
    let _ = c.first("SELECT 0");
}
