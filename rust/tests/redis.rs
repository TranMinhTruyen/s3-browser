//! Test tích hợp driver Redis qua 4 hàm FFI, với server thật (`s3b-test-redis`, Redis 7.4 trong
//! `test-env/`, có mật khẩu, bật `DEBUG`). Không có server thì mỗi test in `SKIP ...` rồi đạt (xem
//! `redis_common`).
//!
//! Mỗi test tự mở connection riêng, dùng DB 11..=15 và key có tiền tố `s3b_test_` + pid + số thứ
//! tự (xoá khi `Conn` bị drop) nên độc lập thứ tự chạy. Trạng thái phía server (client đang bị
//! chặn) được quan sát bằng một connection `monitor` khác qua `CLIENT LIST`, chờ theo điều kiện
//! chứ không ngủ cố định.
//!
//! TLS (6 mode, CA, hostname) nằm ở `redis_tls.rs`.

mod common;
mod redis_common;

use common::*;
use redis_common::*;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

/// Số `n` phần tử `0..n` ngăn cách bằng dấu cách, để ghép vào một lệnh `RPUSH`.
fn numbers(n: usize) -> String {
    (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(" ")
}

/// Danh sách `0..n` dạng chuỗi.
fn expected(n: usize) -> Vec<String> {
    (0..n).map(|i| i.to_string()).collect()
}

redis! {
    // ---- mở / đóng ----

    fn open_pings_and_close_makes_the_connection_unknown(s: &Server) {
        let r = call("open", s.params());
        let id = ok(&r)["connId"].as_u64().unwrap();
        let r = exec(id, "PING");
        assert_eq!(stmt(&r, 0)["rows"], json!([["PONG"]]));
        ok(&call("close", json!({"connId": id})));
        assert_eq!(err_code(&exec(id, "PING")), "connNotFound");
        assert_eq!(err_code(&fetch(id, 1)), "connNotFound");
        // Đóng lần hai vẫn trả mã ổn định (không panic).
        let again = call("close", json!({"connId": id}));
        assert!(again["ok"] == true || err_code(&again) == "connNotFound", "{again}");
    }

    fn open_result_has_only_the_connection_id_and_never_the_password(s: &Server) {
        let r = call("open", s.params());
        let id = ok(&r)["connId"].as_u64().unwrap();
        assert_eq!(ok(&r).as_object().unwrap().len(), 1, "{r}");
        assert!(!s.password_leaks_in(&r));
        call("close", json!({"connId": id}));
    }

    fn missing_password_is_open_failed_without_leaking_anything(s: &Server) {
        let t0 = Instant::now();
        let r = call("open", s.params_with(json!({"password": null})));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(message(&r).contains("NOAUTH"), "{r}");
        assert!(!s.password_leaks_in(&r));
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        // Mật khẩu rỗng coi như không có mật khẩu.
        let r = call("open", s.params_with(json!({"password": ""})));
        assert_eq!(err_code(&r), "openFailed", "{r}");
    }

    fn wrong_password_or_user_is_open_failed_fast_without_leaking_either(s: &Server) {
        let wrong = s.wrong_password();
        for over in [
            json!({"password": wrong}),
            json!({"username": "no_such_user_zz", "password": wrong}),
            json!({"username": "no_such_user_zz"}),
        ] {
            let t0 = Instant::now();
            let r = call("open", s.params_with(over));
            assert_eq!(err_code(&r), "openFailed", "{r}");
            assert!(message(&r).contains("WRONGPASS"), "{r}");
            assert!(!r.to_string().contains(&wrong), "{r}");
            assert!(!s.password_leaks_in(&r), "{r}");
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        }
    }

    fn open_without_a_host_or_with_a_closed_port_fails_cleanly(s: &Server) {
        let r = call("open", s.params_with(json!({"host": null})));
        assert_eq!(err_code(&r), "invalidRequest", "{r}");
        let r = call("open", s.params_with(json!({"host": ""})));
        assert_eq!(err_code(&r), "invalidRequest", "{r}");
        // Cổng 1 không ai nghe: lỗi nối ngay (không chờ hết thời gian nối).
        let t0 = Instant::now();
        let r = call("open", s.params_with(json!({"port": 1})));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(!s.password_leaks_in(&r));
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    }

    // ---- cơ sở dữ liệu ----

    fn the_database_param_selects_the_db_and_empty_means_db_0(s: &Server) {
        let db_of = |c: &Conn| c.text("CLIENT INFO").split(' ').find_map(|f| f.strip_prefix("db=")).unwrap().to_owned();
        for db in [11, 13, 15] {
            let c = s.conn_with(json!({"database": db.to_string()}));
            assert_eq!(db_of(&c), db.to_string());
        }
        assert_eq!(db_of(&s.conn_with(json!({"database": ""}))), "0");
        assert_eq!(db_of(&s.conn_with(json!({"database": null}))), "0");
        assert_eq!(db_of(&s.conn_with(json!({"database": " 12 "}))), "12", "khoảng trắng hai đầu được cắt");
    }

    fn invalid_database_is_rejected_before_connecting(s: &Server) {
        for bad in ["abc", "-1", "1.5", "0x10", "12 13"] {
            let r = call("open", s.params_with(json!({"database": bad})));
            assert_eq!(err_code(&r), "invalidRequest", "{bad}: {r}");
            assert!(!s.password_leaks_in(&r));
        }
        // `database` là chuỗi: số JSON không đúng kiểu nên bị từ chối ngay khi đọc request.
        let r = call("open", s.params_with(json!({"database": 12})));
        assert_eq!(err_code(&r), "invalidRequest", "{r}");
    }

    fn a_database_number_beyond_the_servers_limit_is_open_failed(s: &Server) {
        let r = call("open", s.params_with(json!({"database": "999"})));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(message(&r).contains("DB index is out of range"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn databases_are_isolated_and_select_switches_the_connection(s: &Server) {
        let a = s.conn_with(json!({"database": "11"}));
        let b = s.conn_with(json!({"database": "12"}));
        let k = a.key("iso");
        a.exec(&format!("SET {k} in11"));
        assert_eq!(a.text(&format!("GET {k}")), "in11");
        assert_eq!(b.cell(&format!("GET {k}")), None, "DB khác không thấy key");
        // `SELECT` đổi DB của chính connection này; `b` tự xoá key bên DB 11 qua `SELECT`.
        b.exec("SELECT 11");
        assert_eq!(b.text(&format!("GET {k}")), "in11");
        assert_eq!(a.text(&format!("GET {k}")), "in11", "connection khác không bị ảnh hưởng");
    }

    // ---- hình dạng kết quả ----

    fn set_get_incr_del_exists_have_one_cell_each(s: &Server) {
        let c = s.conn();
        let k = c.key("scalar");
        let r = c.exec(&format!("SET {k} hello"));
        let st = stmt(&r, 0);
        assert_eq!(st["rows"], json!([["OK"]]));
        assert_eq!(st["done"], true);
        assert_eq!(st["kind"], "rows");
        assert_eq!(st["sql"], format!("SET {k} hello"));
        assert_eq!(c.text(&format!("GET {k}")), "hello");
        assert_eq!(c.cell(&format!("GET {k}_missing")), None, "nil là ô NULL");
        assert_eq!(c.text(&format!("INCR {k}_n")), "1");
        assert_eq!(c.text(&format!("INCRBY {k}_n 41")), "42");
        assert_eq!(c.text(&format!("EXISTS {k} {k}_n {k}_zz")), "2");
        assert_eq!(c.text(&format!("DEL {k}_n")), "1");
        assert_eq!(c.text(&format!("TYPE {k}")), "string");
        c.exec(&format!("DEL {k}"));
    }

    fn result_json_is_camel_case_with_columns_and_timings(s: &Server) {
        let c = s.conn();
        let r = c.exec("PING");
        let st = stmt(&r, 0);
        assert_eq!(st["index"], 0);
        assert_eq!(st["columns"][0]["name"], "value");
        assert!(st["elapsedMs"].is_u64(), "{st}");
        assert!(st["firstRowMs"].is_u64(), "{st}");
        for snake in ["elapsed_ms", "first_row_ms", "cursor_id", "rows_affected"] {
            assert!(st.get(snake).is_none(), "{snake} không được có trong {st}");
        }
        assert!(st.get("cursorId").is_none(), "câu đã hết dòng thì không có cursor: {st}");
        assert!(st.get("error").is_none() && st.get("rowsAffected").is_none(), "{st}");
    }

    fn hgetall_is_two_columns_key_and_value_in_resp3(s: &Server) {
        let c = s.conn();
        let k = c.key("hash");
        c.exec(&format!("HSET {k} f1 v1 f2 v2 f3 3"));
        let r = c.exec(&format!("HGETALL {k}"));
        let st = stmt(&r, 0);
        assert_eq!(st["columns"][0]["name"], "key");
        assert_eq!(st["columns"][1]["name"], "value");
        let mut rows: Vec<Vec<String>> = serde_json::from_value(st["rows"].clone()).unwrap();
        rows.sort();
        assert_eq!(rows, vec![vec!["f1", "v1"], vec!["f2", "v2"], vec!["f3", "3"]]);
        assert_eq!(c.text(&format!("HGET {k} f2")), "v2");
        assert_eq!(c.text(&format!("HLEN {k}")), "3");
    }

    fn list_set_and_keys_are_one_row_per_item(s: &Server) {
        let c = s.conn();
        let (l, st, hs) = (c.key("list"), c.key("set"), c.key("hash"));
        c.exec(&format!("RPUSH {l} a b c"));
        assert_eq!(c.col(&format!("LRANGE {l} 0 -1")), [Some("a".into()), Some("b".into()), Some("c".into())]);
        c.exec(&format!("SADD {st} x y z"));
        let mut members: Vec<_> = c.col(&format!("SMEMBERS {st}")).into_iter().flatten().collect();
        members.sort();
        assert_eq!(members, ["x", "y", "z"]);
        assert_eq!(c.col(&format!("LRANGE {l} 5 9")), Vec::<Option<String>>::new(), "mảng rỗng = 0 dòng");
        let r = c.exec(&format!("LRANGE {l} 5 9"));
        assert_eq!(stmt(&r, 0)["done"], true);
        assert_eq!(stmt(&r, 0)["rows"], json!([]));
        c.exec(&format!("HSET {hs} f v"));
        assert_eq!(c.col(&format!("KEYS {hs}")), [Some(hs.clone())]);
    }

    fn scan_gives_the_cursor_and_the_batch_of_keys(s: &Server) {
        let c = s.conn();
        let k = c.key("scan");
        c.exec(&format!("SET {k} 1"));
        // Phần tử đầu là cursor (chuỗi), phần tử hai là mảng key lồng nên thành một ô JSON.
        let cells = c.col(&format!("SCAN 0 MATCH {k} COUNT 100000"));
        assert_eq!(cells.len(), 2, "{cells:?}");
        let batch: Vec<String> = serde_json::from_str(cells[1].as_ref().unwrap()).unwrap();
        assert!(batch.is_empty() || batch == [k.clone()], "{batch:?}");
        // Duyệt cho tới cursor 0 phải gặp đúng key đó.
        let mut cursor = "0".to_owned();
        let mut found = Vec::new();
        for _ in 0..10_000 {
            let cells = c.col(&format!("SCAN {cursor} MATCH {k} COUNT 1000"));
            cursor = cells[0].clone().unwrap();
            found.extend(serde_json::from_str::<Vec<String>>(cells[1].as_ref().unwrap()).unwrap());
            if cursor == "0" {
                break;
            }
        }
        assert_eq!(found, std::slice::from_ref(&k));
    }

    fn zrange_withscores_is_a_member_and_score_grid(s: &Server) {
        let c = s.conn();
        let z = c.key("zset");
        c.exec(&format!("ZADD {z} 1 one 2.5 two 3 three"));
        let r = c.exec(&format!("ZRANGE {z} 0 -1 WITHSCORES"));
        let st = stmt(&r, 0);
        assert_eq!(st["columns"][0]["name"], "c1");
        assert_eq!(st["columns"][1]["name"], "c2");
        assert_eq!(st["rows"], json!([["one", "1.0"], ["two", "2.5"], ["three", "3.0"]]));
        assert_eq!(c.text(&format!("ZSCORE {z} two")), "2.5");
        assert_eq!(c.text(&format!("ZCARD {z}")), "3");
        // Không có WITHSCORES: một cột.
        assert_eq!(c.col(&format!("ZRANGE {z} 0 -1")), [Some("one".into()), Some("two".into()), Some("three".into())]);
    }

    fn nested_replies_are_one_json_cell(s: &Server) {
        let c = s.conn();
        let st = c.key("stream");
        c.exec(&format!("XADD {st} 1-1 f v"));
        let r = c.exec(&format!("XRANGE {st} - +"));
        let row = &stmt(&r, 0)["rows"][0];
        // `XRANGE`: [id, [field, value]] là mảng chứ không phải lưới (phần tử đầu là chuỗi).
        assert_eq!(row[0], "1-1", "{r}");
        let fields: Vec<String> = serde_json::from_str(row[1].as_str().unwrap()).unwrap();
        assert_eq!(fields, ["f", "v"]);
    }

    fn binary_values_are_hex_and_utf8_values_are_kept(s: &Server) {
        let c = s.conn();
        let k = c.key("bin");
        c.exec(&format!(r#"SET {k} "\xff\xfe\x00""#));
        assert_eq!(c.text(&format!("GET {k}")), "0xfffe00");
        c.exec(&format!(r#"SET {k} "tiếng Việt é 日本語""#));
        assert_eq!(c.text(&format!("GET {k}")), "tiếng Việt é 日本語");
        c.exec(&format!(r#"SET {k} "a\tb\nc""#));
        assert_eq!(c.text(&format!("GET {k}")), "a\tb\nc");
        c.exec(&format!(r#"SET {k} 'single \n quoted'"#));
        assert_eq!(c.text(&format!("GET {k}")), r"single \n quoted");
        assert_eq!(c.text(&format!("STRLEN {k}")), "16");
    }

    fn a_value_of_one_mebibyte_comes_back_whole(s: &Server) {
        let c = s.conn();
        let k = c.key("big");
        let value = "é".repeat(512 * 1024);
        c.exec(&format!("SET {k} {value}"));
        assert_eq!(c.text(&format!("STRLEN {k}")), (1024 * 1024).to_string());
        let back = c.text(&format!("GET {k}"));
        assert_eq!(back.chars().count(), 512 * 1024);
        assert_eq!(back, value);
    }

    fn info_and_multi_line_text_replies_stay_in_one_cell(s: &Server) {
        let c = s.conn();
        let info = c.text("INFO server");
        assert!(info.contains("redis_version:"), "{info}");
        assert!(info.lines().count() > 3);
    }

    // ---- nhiều lệnh trong một yêu cầu ----

    fn several_lines_run_in_order_one_statement_each(s: &Server) {
        let c = s.conn();
        let k = c.key("pipe");
        let text = format!("SET {k} 1\nINCR {k}\nINCR {k}\n\n   \nGET {k}\nDEL {k}");
        let r = c.exec(&text);
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 5, "dòng trống bị bỏ: {r}");
        let cells: Vec<_> = (0..5).map(|i| col_of(&r, i)[0].clone().unwrap()).collect();
        assert_eq!(cells, ["OK", "2", "3", "3", "1"]);
        for (i, st) in list.iter().enumerate() {
            assert_eq!(st["index"], i);
        }
        assert_eq!(list[1]["sql"], format!("INCR {k}"));
        assert_eq!(c.cell(&format!("GET {k}")), None);
    }

    fn crlf_line_endings_work_like_lf(s: &Server) {
        let c = s.conn();
        let k = c.key("crlf");
        let r = c.exec(&format!("SET {k} 1\r\nGET {k}\r\n"));
        assert_eq!(ok(&r)["statements"].as_array().unwrap().len(), 2);
        assert_eq!(col_of(&r, 1), [Some("1".into())]);
    }

    fn multi_exec_in_one_request_returns_each_reply(s: &Server) {
        let c = s.conn();
        let k = c.key("tx");
        let r = c.exec(&format!("MULTI\nSET {k} 5\nINCR {k}\nGET {k}\nEXEC"));
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 5, "{r}");
        assert_eq!(col_of(&r, 0), [Some("OK".into())]);
        for i in 1..=3 {
            assert_eq!(col_of(&r, i), [Some("QUEUED".into())]);
        }
        // EXEC: ["OK", 6, "6"], mỗi phần tử một dòng.
        assert_eq!(col_of(&r, 4), [Some("OK".into()), Some("6".into()), Some("6".into())]);
        assert_eq!(c.text(&format!("GET {k}")), "6");
    }

    fn discard_and_a_failing_exec_leave_the_connection_usable(s: &Server) {
        let c = s.conn();
        let k = c.key("txd");
        let r = c.exec(&format!("MULTI\nSET {k} 1\nDISCARD"));
        assert_eq!(col_of(&r, 2), [Some("OK".into())]);
        assert_eq!(c.cell(&format!("GET {k}")), None, "DISCARD bỏ SET");
        // Lệnh sai trong MULTI làm EXEC thất bại (EXECABORT); câu lỗi được báo và connection vẫn dùng được.
        let r = c.exec("MULTI\nNO_SUCH_COMMAND_ZZ\nEXEC");
        let st = &ok(&r)["statements"];
        assert!(st.as_array().unwrap().len() >= 2, "{r}");
        let last = st.as_array().unwrap().last().unwrap();
        assert_eq!(code_of(last), "sqlError", "{r}");
        c.exec("DISCARD");
        assert_eq!(c.text("PING"), "PONG");
    }

    // ---- lỗi của câu ----

    fn wrongtype_stops_the_request_and_the_next_one_still_runs(s: &Server) {
        let c = s.conn();
        let k = c.key("wt");
        let r = c.exec(&format!("SET {k} v\nLPUSH {k} x\nGET {k}"));
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 2, "dừng ở lệnh lỗi đầu tiên: {r}");
        assert_eq!(list[0]["kind"], "rows");
        let bad = &list[1];
        assert_eq!(bad["kind"], "affected");
        assert_eq!(bad["index"], 1);
        assert_eq!(bad["sql"], format!("LPUSH {k} x"));
        assert_eq!(code_of(bad), "sqlError");
        assert!(message_of(bad).starts_with("WRONGTYPE "), "{bad}");
        assert!(bad.get("rows").is_none() && bad.get("columns").is_none(), "{bad}");
        // Lỗi một câu không phá connection: câu kế tiếp chạy bình thường.
        assert_eq!(c.text(&format!("GET {k}")), "v");
        assert_eq!(c.text("PING"), "PONG");
    }

    fn unknown_command_and_wrong_arity_are_statement_errors(s: &Server) {
        let c = s.conn();
        let r = c.exec("NO_SUCH_COMMAND_ZZ 1 2");
        assert_eq!(code_of(stmt(&r, 0)), "sqlError");
        assert!(message_of(stmt(&r, 0)).starts_with("ERR "), "{r}");
        let r = c.exec("GET");
        assert!(message_of(stmt(&r, 0)).contains("wrong number of arguments"), "{r}");
        let r = c.exec("INCR s3b_test_not_a_number_zz\nPING");
        // INCR trên key chưa có là hợp lệ; chỉ kiểm không lỗi và dọn.
        assert_eq!(code_of(stmt(&r, 0)), "");
        c.exec("DEL s3b_test_not_a_number_zz");
    }

    fn a_syntax_error_midway_keeps_the_earlier_commands(s: &Server) {
        let c = s.conn();
        let k = c.key("syn");
        let r = c.exec(&format!("SET {k} 1\nGET \"unterminated\nSET {k} 2"));
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 2, "{r}");
        assert_eq!(list[0]["kind"], "rows");
        assert_eq!(list[1]["kind"], "affected");
        assert_eq!(list[1]["index"], 1);
        assert_eq!(code_of(&list[1]), "sqlError");
        assert!(message_of(&list[1]).starts_with("line 2: "), "{}", list[1]);
        assert_eq!(c.text(&format!("GET {k}")), "1", "lệnh sau lỗi cú pháp không chạy");
    }

    fn blocked_commands_are_refused_and_do_not_hang_the_connection(s: &Server) {
        let c = s.conn();
        for text in ["SUBSCRIBE news", "psubscribe n*", "SSUBSCRIBE n", "MONITOR", "SYNC", "PSYNC ? -1", "\"subscribe\" news"] {
            let t0 = Instant::now();
            let r = c.exec(text);
            let list = ok(&r)["statements"].as_array().unwrap();
            let bad = list.last().unwrap();
            assert_eq!(code_of(bad), "sqlError", "{text}: {r}");
            assert!(message_of(bad).contains("not supported"), "{text}: {r}");
            assert!(t0.elapsed() < Duration::from_secs(2), "{text}");
        }
        // Lệnh đứng trước vẫn chạy, lệnh đứng sau không.
        let k = c.key("blk");
        let r = c.exec(&format!("SET {k} 1\nMONITOR\nSET {k} 2"));
        assert_eq!(ok(&r)["statements"].as_array().unwrap().len(), 2, "{r}");
        assert_eq!(c.text(&format!("GET {k}")), "1");
        assert_eq!(c.text("PING"), "PONG");
    }

    fn empty_text_is_a_request_with_no_statements(s: &Server) {
        let c = s.conn();
        for text in ["", "   ", "\n\n", "\r\n \t \n"] {
            let r = c.exec(text);
            assert_eq!(ok(&r)["statements"], json!([]), "{text:?}: {r}");
        }
        assert_eq!(c.text("PING"), "PONG");
    }

    // ---- phân trang ----

    fn lrange_pages_through_a_cursor_completely_in_order_without_duplicates(s: &Server) {
        let c = s.conn();
        let k = c.key("page");
        let n = 2500;
        c.exec(&format!("RPUSH {k} {}", numbers(n)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 100, MAX_BYTES);
        let st = stmt(&r, 0);
        assert_eq!(st["done"], false);
        assert!(st["cursorId"].is_u64(), "{st}");
        assert_eq!(st["rows"].as_array().unwrap().len(), 100);
        let pages = walk(&c, st, 100, MAX_BYTES);
        assert_eq!(pages.len(), 25, "2500 dòng / 100 mỗi trang");
        assert!(pages.iter().all(|p| p.len() == 100));
        let flat: Vec<String> = pages.into_iter().flatten().collect();
        assert_eq!(flat, expected(n));
    }

    fn the_last_page_is_done_and_a_page_size_that_divides_evenly_ends_cleanly(s: &Server) {
        let c = s.conn();
        let k = c.key("even");
        c.exec(&format!("RPUSH {k} {}", numbers(30)));
        // Chia hết: 3 trang x 10; trang cuối báo `done`, không có trang rỗng thừa.
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let pages = walk(&c, stmt(&r, 0), 10, MAX_BYTES);
        assert_eq!(pages.iter().map(Vec::len).collect::<Vec<_>>(), [10, 10, 10]);
        // Không chia hết: 25 dòng, trang 10 -> 10, 10, 5.
        let r = c.exec_page(&format!("LRANGE {k} 0 24"), 10, MAX_BYTES);
        let pages = walk(&c, stmt(&r, 0), 10, MAX_BYTES);
        assert_eq!(pages.iter().map(Vec::len).collect::<Vec<_>>(), [10, 10, 5]);
        // Vừa một trang: done ngay, không có cursor.
        let r = c.exec_page(&format!("LRANGE {k} 0 9"), 10, MAX_BYTES);
        assert_eq!(stmt(&r, 0)["done"], true);
        assert!(stmt(&r, 0).get("cursorId").is_none());
    }

    fn a_different_page_size_on_fetch_applies_to_the_rest(s: &Server) {
        let c = s.conn();
        let k = c.key("resize");
        c.exec(&format!("RPUSH {k} {}", numbers(100)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let st = stmt(&r, 0);
        let cursor = st["cursorId"].as_u64().unwrap();
        let f = c.fetch_page(cursor, 50, MAX_BYTES);
        assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 50);
        assert_eq!(ok(&f)["rows"][0][0], "10", "tiếp ngay sau trang đầu");
        let f = c.fetch_page(cursor, 1000, MAX_BYTES);
        assert_eq!(ok(&f)["rows"].as_array().unwrap().len(), 40);
        assert_eq!(ok(&f)["done"], true);
    }

    fn max_page_bytes_cuts_pages_short_but_every_page_has_a_row_and_nothing_is_lost(s: &Server) {
        let c = s.conn();
        let k = c.key("bytes");
        let item = "x".repeat(1000);
        let n = 100;
        // Mỗi phần tử khác nhau ở đầu để kiểm thứ tự.
        let args: Vec<String> = (0..n).map(|i| format!("{i:03}{item}")).collect();
        c.exec(&format!("RPUSH {k} {}", args.join(" ")));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 1000, 10_000);
        let st = stmt(&r, 0);
        let first = st["rows"].as_array().unwrap().len();
        assert!((1..n).contains(&first), "trang đầu phải bị cắt theo byte: {first}");
        assert!(first <= 12, "10.000 byte chứa tối đa cỡ 10 phần tử 1 KB: {first}");
        assert_eq!(st["done"], false);
        let pages = walk(&c, st, 1000, 10_000);
        assert!(pages.len() > 5, "{}", pages.len());
        assert!(pages.iter().all(|p| !p.is_empty()));
        assert_eq!(pages.into_iter().flatten().collect::<Vec<_>>(), args);
        // Một dòng lớn hơn cả giới hạn vẫn được trả (mỗi trang ít nhất một dòng).
        let r = c.exec_page(&format!("LRANGE {k} 0 1"), 1000, 10);
        assert_eq!(stmt(&r, 0)["rows"].as_array().unwrap().len(), 1, "{r}");
        assert_eq!(stmt(&r, 0)["done"], false);
    }

    fn page_size_one_and_a_huge_page_size_both_work(s: &Server) {
        let c = s.conn();
        let k = c.key("sizes");
        c.exec(&format!("RPUSH {k} {}", numbers(20)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 1, MAX_BYTES);
        let pages = walk(&c, stmt(&r, 0), 1, MAX_BYTES);
        assert_eq!(pages.len(), 20);
        assert_eq!(pages.into_iter().flatten().collect::<Vec<_>>(), expected(20));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 1_000_000, MAX_BYTES);
        assert_eq!(stmt(&r, 0)["done"], true);
        assert_eq!(stmt(&r, 0)["rows"].as_array().unwrap().len(), 20);
        // pageSize 0 vẫn trả ít nhất một dòng mỗi trang, nên cursor vẫn đi hết.
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 0, MAX_BYTES);
        let pages = walk(&c, stmt(&r, 0), 0, MAX_BYTES);
        assert_eq!(pages.into_iter().flatten().collect::<Vec<_>>(), expected(20));
    }

    fn only_the_last_statement_keeps_a_cursor_the_others_are_truncated(s: &Server) {
        let c = s.conn();
        let k = c.key("trunc");
        c.exec(&format!("RPUSH {k} {}", numbers(30)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1\nLRANGE {k} 0 -1\nPING"), 10, MAX_BYTES);
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 3);
        for st in &list[..2] {
            assert_eq!(st["truncated"], true, "{st}");
            assert_eq!(st["done"], false);
            assert!(st.get("cursorId").is_none(), "{st}");
            assert_eq!(st["rows"].as_array().unwrap().len(), 10);
        }
        assert_eq!(list[2]["rows"], json!([["PONG"]]));
        // Cùng hai lệnh nhưng lệnh cuối giữ cursor.
        let r = c.exec_page(&format!("PING\nLRANGE {k} 0 -1"), 10, MAX_BYTES);
        let last = stmt(&r, 1);
        assert!(last["cursorId"].is_u64(), "{last}");
        assert!(last.get("truncated").is_none(), "{last}");
        // Lỗi cú pháp theo sau thì lệnh trước đó không giữ cursor (nó không còn là lệnh cuối).
        let r = c.exec_page(&format!("LRANGE {k} 0 -1\nGET \"x"), 10, MAX_BYTES);
        assert_eq!(stmt(&r, 0)["truncated"], true, "{r}");
        assert!(stmt(&r, 0).get("cursorId").is_none());
    }

    fn cursor_not_found_after_done_after_a_new_execute_and_for_a_made_up_id(s: &Server) {
        let c = s.conn();
        let k = c.key("curs");
        c.exec(&format!("RPUSH {k} {}", numbers(30)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let cursor = stmt(&r, 0)["cursorId"].as_u64().unwrap();
        // Id bịa.
        assert_eq!(err_code(&c.fetch(cursor + 1000)), "cursorNotFound");
        // Cursor thật vẫn dùng được sau lần fetch hỏng đó.
        let f = c.fetch_page(cursor, 10, MAX_BYTES);
        assert_eq!(ok(&f)["done"], false);
        // Execute mới bỏ cursor cũ.
        let r2 = c.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let cursor2 = stmt(&r2, 0)["cursorId"].as_u64().unwrap();
        assert_ne!(cursor, cursor2);
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        // Đọc hết cursor mới rồi fetch lại.
        assert_eq!(ok(&c.fetch_page(cursor2, 100, MAX_BYTES))["done"], true);
        assert_eq!(err_code(&c.fetch(cursor2)), "cursorNotFound");
        // Gọi Fetch khi chưa có cursor nào.
        assert_eq!(err_code(&c.fetch(1)), "cursorNotFound");
    }

    fn a_cursor_belongs_to_its_connection(s: &Server) {
        let a = s.conn();
        let b = s.conn();
        let k = a.key("own");
        a.exec(&format!("RPUSH {k} {}", numbers(30)));
        let r = a.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let cursor = stmt(&r, 0)["cursorId"].as_u64().unwrap();
        assert_eq!(err_code(&b.fetch(cursor)), "cursorNotFound");
        assert_eq!(ok(&a.fetch_page(cursor, 10, MAX_BYTES))["done"], false);
    }

    fn closing_with_an_open_cursor_leaves_the_server_clean(s: &Server) {
        let c = s.conn();
        let k = c.key("closecur");
        c.exec(&format!("RPUSH {k} {}", numbers(30)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 10, MAX_BYTES);
        let cursor = stmt(&r, 0)["cursorId"].as_u64().unwrap();
        let id = c.id;
        c.cleanup();
        ok(&call("close", json!({"connId": id})));
        assert_eq!(err_code(&fetch(id, cursor)), "connNotFound");
        // `Conn::drop` gọi lại `close` trên connection đã đóng: bỏ qua lỗi, không panic.
    }

    /// B1: `close` khi đang có `BLPOP` chặn vô hạn: close xong < 2 giây, câu đó nhận `cancelled`,
    /// `exec` sau đó là `connNotFound`, server không còn client bị chặn.
    fn close_cancels_a_blocked_blpop_and_returns_fast(s: &Server) {
        let monitor = s.conn();
        let c = s.conn_with(json!({"database": "14"}));
        let (name, k) = (client_name("s3b_test_close_blpop"), c.key("nokey"));
        let t = c.exec_in_thread(next_id(), &format!("CLIENT SETNAME {name}
BLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": c.id})));
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        assert_eq!(err_code(&c.exec("PING")), "connNotFound");
        wait_until_gone(&monitor, &name);
    }

    /// Q3: `CLIENT REPLY OFF|SKIP` bị chặn thành lỗi câu (không gửi tới server) nên connection vẫn
    /// trả lời bình thường; `CLIENT REPLY ON` được phép.
    fn client_reply_off_and_skip_are_statement_errors_and_the_connection_keeps_replying(s: &Server) {
        let c = s.conn();
        for text in ["CLIENT REPLY OFF", "client reply skip"] {
            let r = c.exec(text);
            let x = stmt(&r, 0);
            assert_eq!(code_of(x), "sqlError", "{text}: {r}");
            assert!(message_of(x).contains("CLIENT REPLY"), "{text}: {r}");
            assert_eq!(c.text("PING"), "PONG", "{text}");
        }
        let r = c.exec("CLIENT REPLY ON");
        assert_eq!(stmt(&r, 0)["kind"], "rows", "{r}");
        assert_eq!(c.text("PING"), "PONG");
    }

    // ---- huỷ ----

    fn cancel_a_blocked_blpop_returns_cancelled_fast_and_the_server_drops_the_client(s: &Server) {
        let monitor = s.conn();
        let c = s.conn_with(json!({"database": "14"}));
        let (name, k) = (client_name("s3b_test_blpop"), c.key("blpop"));
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        // Connection bị thả nên server không còn client bị chặn.
        wait_until_gone(&monitor, &name);
        assert!(!s.password_leaks_in(&r));
    }

    fn after_a_cancel_the_connection_reconnects_and_keeps_its_database(s: &Server) {
        // `monitor` ở DB 11 (khác DB 13 của `c`) để kiểm key không lọt sang DB khác.
        let monitor = s.conn_with(json!({"database": "11"}));
        let c = s.conn_with(json!({"database": "11"}));
        let (name, k, seen) = (client_name("s3b_test_resel"), c.key("blpop"), c.key("seen"));
        // Đổi DB bằng SELECT (được nhớ) rồi ghi một key để kiểm đúng DB sau khi nối lại.
        c.exec(&format!("SELECT 13\nSET {seen} in13"));
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        // Lệnh kế nối lại (client mới không còn tên) và vẫn ở DB 13, không phải DB lúc mở.
        assert!(c.text("CLIENT INFO").contains(" db=13 "));
        assert_eq!(c.text(&format!("GET {seen}")), "in13");
        // Connection khác (DB 11 lúc mở) không thấy key.
        assert_eq!(monitor.cell(&format!("GET {seen}")), None);
        // Dọn: `Conn::drop` chọn lại `db` lúc mở (11) nên xoá key ở DB 13 ngay đây.
        c.exec(&format!("DEL {seen}"));
    }

    fn cancel_while_the_server_is_busy_is_cancelled_and_the_next_command_waits_then_works(s: &Server) {
        let c = s.conn_with(json!({"database": "12"}));
        let (sig, k) = (c.key("sig"), c.key("after"));
        let id = next_id();
        // `SET sig` xong rồi mới tới `DEBUG SLEEP` (server đứng im 2 giây); đợi thấy `sig` rồi huỷ.
        let t = c.exec_in_thread(id, &format!("SET {sig} 1\nDEBUG SLEEP 2"));
        // Thăm dò bằng connection khác. Có thể bị kẹt tới khi DEBUG SLEEP xong; vẫn đúng.
        let monitor = s.conn_with(json!({"database": "12"}));
        wait_for(Duration::from_secs(20), "sig", || monitor.cell(&format!("GET {sig}")).is_some());
        let t0 = Instant::now();
        // `cancel` an toàn dù request đã xong (id lạ thì bỏ qua).
        cancel(id);
        let r = t.join().unwrap();
        let ok_or_cancelled = r["ok"] == true || err_code(&r) == "cancelled";
        assert!(ok_or_cancelled, "{r}");
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        // Dù kết thúc bằng cách nào, connection dùng lại được (có thể phải chờ server hết ngủ).
        assert_eq!(c.text("PING"), "PONG");
        assert_eq!(c.text(&format!("GET {sig}")), "1");
        c.exec(&format!("SET {k} 1"));
        assert!(c.text("CLIENT INFO").split(' ').any(|f| f == "db=12"));
    }

    fn cancel_of_an_unknown_or_finished_request_is_harmless(s: &Server) {
        let c = s.conn();
        cancel(u64::MAX);
        let id = next_id();
        let r = call_with_id(id, "execute", json!({"connId": c.id, "sql": "PING", "pageSize": 10, "maxPageBytes": MAX_BYTES}));
        assert_eq!(stmt(&r, 0)["rows"], json!([["PONG"]]));
        cancel(id);
        assert_eq!(c.text("PING"), "PONG");
    }

    fn a_cancelled_request_does_not_cancel_the_next_one_on_the_same_connection(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let (name, k) = (client_name("s3b_test_next"), c.key("blpop"));
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        // Request mới (id mới) không bị ảnh hưởng bởi cờ huỷ của request cũ.
        for _ in 0..3 {
            assert_eq!(c.text("PING"), "PONG");
        }
    }

    // ---- phương thức chỉ SQLite có ----

    fn schema_methods_are_invalid_request_for_redis(s: &Server) {
        let c = s.conn();
        for (method, params) in [
            ("schemaTree", json!({"connId": c.id})),
            ("tableInfo", json!({"connId": c.id, "schema": "s", "table": "t"})),
            ("tableRows", json!({"connId": c.id, "schema": "s", "table": "t", "pageSize": 10, "maxPageBytes": MAX_BYTES})),
        ] {
            let r = call(method, params);
            assert_eq!(err_code(&r), "invalidRequest", "{method}: {r}");
            assert_eq!(r["error"]["message"], "method not supported by driver", "{method}");
        }
        assert_eq!(c.text("PING"), "PONG");
    }

    // ---- nhiều kết nối ----

    fn connections_are_isolated_and_closing_one_does_not_affect_another(s: &Server) {
        let a = s.conn();
        let b = s.conn();
        assert_ne!(a.id, b.id);
        let k = a.key("shared");
        a.exec(&format!("SET {k} fromA"));
        // `a` và `b` có thể rơi cùng DB (xoay vòng) hoặc không; chỉ kiểm hai connection độc lập.
        a.cleanup();
        ok(&call("close", json!({"connId": a.id})));
        assert_eq!(b.text("PING"), "PONG");
        assert_eq!(err_code(&a.exec("PING")), "connNotFound");
    }

    fn many_connections_work_in_parallel_without_mixing_results(s: &Server) {
        let params = s.params();
        let handles: Vec<_> = (0..8)
            .map(|t| {
                let params = params.clone();
                std::thread::spawn(move || {
                    let r = call("open", params);
                    let id = ok(&r)["connId"].as_u64().unwrap();
                    let key = format!("s3b_test_par_{}_{}_{t}", std::process::id(), next_id());
                    for i in 0..30 {
                        let r = exec(id, &format!("SET {key} {t}-{i}\nGET {key}"));
                        assert_eq!(stmt(&r, 1)["rows"], json!([[format!("{t}-{i}")]]), "thread {t}");
                    }
                    exec(id, &format!("DEL {key}"));
                    call("close", json!({"connId": id}));
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    fn the_same_connection_used_from_many_threads_answers_every_request(s: &Server) {
        let c = s.conn();
        let id = c.id;
        let handles: Vec<_> = (0..8)
            .map(|t| {
                std::thread::spawn(move || {
                    for i in 0..20 {
                        let r = exec(id, &format!("ECHO v{t}_{i}"));
                        assert_eq!(stmt(&r, 0)["rows"], json!([[format!("v{t}_{i}")]]));
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    // ---- bench-timing ----

    fn timing_fields_exist_only_with_the_bench_timing_feature(s: &Server) {
        let c = s.conn();
        let k = c.key("timing");
        c.exec(&format!("RPUSH {k} {}", numbers(200)));
        let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 1000, MAX_BYTES);
        let st: &Value = stmt(&r, 0);
        #[cfg(feature = "bench-timing")]
        {
            assert!(st["readMs"].is_u64(), "{st}");
            assert!(st["convertMs"].is_u64(), "{st}");
        }
        #[cfg(not(feature = "bench-timing"))]
        {
            assert!(st.get("readMs").is_none() && st.get("convertMs").is_none(), "{st}");
        }
        assert_eq!(st["rows"].as_array().unwrap().len(), 200);
    }
}
