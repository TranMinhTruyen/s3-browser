//! Test tích hợp driver MongoDB qua 4 hàm FFI, với server thật (`s3b-test-mongo`, MongoDB 8 trong
//! `test-env/`). Không có server thì mỗi test in `SKIP ...` rồi đạt (xem `mongo_common`).
//!
//! Mỗi test tự mở connection riêng và dùng database tạm riêng (xoá khi `Conn` bị drop) nên độc
//! lập thứ tự chạy. Trạng thái phía server (cursor còn mở, thao tác đang chạy) được quan sát bằng
//! một connection `monitor` khác qua `$currentOp`, và chờ theo điều kiện chứ không ngủ cố định.
//!
//! TLS (6 mode, CA, hostname) nằm ở `mongo_tls.rs`.

mod common;
mod mongo_common;

use common::*;
use mongo_common::*;
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

fn rows_len(statement: &Value) -> usize {
    statement["rows"].as_array().unwrap().len()
}

/// `{"find": coll, ...extra, "$db": db}`.
fn find(db: &str, coll: &str, extra: Value) -> String {
    cmd("find", json!(coll), extra, Some(db))
}

/// `{"find": coll, "sort": {"_id": 1}, ...extra, "$db": db}`: thứ tự cố định theo `_id`.
fn find_sorted(db: &str, coll: &str, mut extra: Value) -> String {
    extra["sort"] = json!({"_id": 1});
    find(db, coll, extra)
}

/// Mọi document của `db.coll` (một trang lớn).
fn all_ids(c: &Conn, db: &str, coll: &str) -> Vec<i64> {
    let r = c.exec_page(&find_sorted(db, coll, json!({})), 100_000, MAX_BYTES);
    ids(&st(&r, 0)["rows"])
}

/// Số document của `db.coll`.
fn count(c: &Conn, db: &str, coll: &str) -> i64 {
    c.doc(&cmd("count", json!(coll), json!({}), Some(db)))["n"]
        .as_i64()
        .unwrap()
}

/// Lệnh `find` chậm: mỗi document khớp `$where` ngủ 6 giây. `comment` để nhận ra ở `$currentOp`.
fn slow_find(db: &str, coll: &str, marker: &str) -> String {
    find(
        db,
        coll,
        json!({"filter": {"$where": "sleep(6000) || true"}, "comment": marker}),
    )
}

mongo! {
    // ---- open ----

    fn open_pings_and_close_makes_the_connection_unknown(s: &Server) {
        let r = s.open("disable");
        let id = ok(&r)["connId"].as_u64().unwrap();
        let r = exec(id, r#"{"ping":1}"#);
        assert_eq!(st(&r, 0)["rows"], json!([["{\"ok\":1.0}"]]));
        ok(&call("close", json!({"connId": id})));
        assert_eq!(err_code(&exec(id, r#"{"ping":1}"#)), "connNotFound");
        // Đóng lần hai vẫn trả mã ổn định (không panic).
        let again = call("close", json!({"connId": id}));
        assert!(again["ok"] == true || err_code(&again) == "connNotFound", "{again}");
    }

    fn the_default_database_is_admin_and_the_database_param_selects_another(s: &Server) {
        let db_of = |c: &Conn| c.doc(r#"{"dbStats":1}"#)["db"].as_str().unwrap().to_owned();
        assert_eq!(db_of(&s.conn()), "admin");
        assert_eq!(db_of(&s.conn_with("disable", json!({"database": ""}))), "admin");
        let c = s.conn();
        let db = c.scratch_db("defdb");
        assert_eq!(db_of(&s.conn_with("disable", json!({"database": db}))), db);
    }

    fn dollar_db_overrides_the_default_database_for_that_command_only(s: &Server) {
        let c = s.conn();
        assert_eq!(c.doc(r#"{"dbStats":1,"$db":"local"}"#)["db"], "local");
        assert_eq!(c.doc(r#"{"$db":"config","dbStats":1}"#)["db"], "config", "$db đứng đầu cũng được");
        assert_eq!(c.doc(r#"{"dbStats":1}"#)["db"], "admin", "lệnh sau quay về database mặc định");
        // `$db` không được lọt vào lệnh gửi server (server từ chối key lạ ở vài lệnh) và `sql` giữ nguyên.
        let r = c.exec(r#"{"ping":1,"$db":"local"}"#);
        assert_eq!(st(&r, 0)["sql"], r#"{"ping":1,"$db":"local"}"#);
        assert_eq!(st(&r, 0)["rows"], json!([["{\"ok\":1.0}"]]));
    }

    fn without_a_username_the_connection_does_not_authenticate(s: &Server) {
        for over in [json!({"username": null, "password": null}), json!({"username": "", "password": s.wrong_password()})] {
            let c = s.conn_with("disable", over);
            // `ping` không cần quyền, lệnh đọc dữ liệu thì cần.
            assert_eq!(st(&c.exec(r#"{"ping":1}"#), 0)["rows"], json!([["{\"ok\":1.0}"]]));
            let r = c.exec(r#"{"listDatabases":1}"#);
            let x = st(&r, 0);
            assert_eq!(code_of(x), "sqlError", "{x}");
            assert!(message_of(x).starts_with("Unauthorized (13)"), "{x}");
            assert!(!s.password_leaks_in(&r));
        }
    }

    fn wrong_password_or_user_is_open_failed_fast_without_leaking_either(s: &Server) {
        let wrong = s.wrong_password();
        for over in [json!({"password": wrong}), json!({"username": "no_such_user_zz", "password": wrong})] {
            let t0 = Instant::now();
            let r = call("open", s.params_with("disable", over));
            assert_eq!(err_code(&r), "openFailed", "{r}");
            assert!(r["error"]["message"].as_str().unwrap().contains("Authentication failed"), "{r}");
            assert!(!r.to_string().contains(&wrong), "{r}");
            assert!(!s.password_leaks_in(&r), "{r}");
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        }
    }

    fn connections_to_the_same_server_are_isolated(s: &Server) {
        let a = s.conn_with("disable", json!({"database": "local"}));
        let b = s.conn_with("disable", json!({"database": "config"}));
        assert_eq!(a.doc(r#"{"dbStats":1}"#)["db"], "local");
        assert_eq!(b.doc(r#"{"dbStats":1}"#)["db"], "config");
        assert_ne!(a.id, b.id);
        ok(&call("close", json!({"connId": a.id})));
        assert_eq!(b.doc(r#"{"dbStats":1}"#)["db"], "config", "đóng a không ảnh hưởng b");
    }

    // ---- hình dạng kết quả ----

    /// Q1: mốc "có dòng đầu" lấy trước khi đổi cả trang sang JSON, nên không tính thời gian đổi:
    /// `firstRowMs <= elapsedMs - convertMs` (cho lệch làm tròn 1 ms). Chỉ có khi bật `bench-timing`.
    #[cfg(feature = "bench-timing")]
    fn first_row_is_measured_before_the_page_is_converted(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("first_row");
        c.seed(&db, "c", 10_000, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 10_000, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(rows_len(x), 10_000);
        let elapsed = x["elapsedMs"].as_u64().unwrap();
        let first = x["firstRowMs"].as_u64().unwrap();
        let convert = x["convertMs"].as_u64().unwrap();
        assert!(first + convert <= elapsed + 1, "first {first} convert {convert} elapsed {elapsed}");
    }

    fn result_json_is_camel_case_with_one_json_document_column(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("shape");
        c.seed(&db, "c", 5, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 2, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(x["index"], 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["columns"], json!([{"name": "document", "type": "json"}]));
        assert_eq!(x["done"], false);
        assert!(x["cursorId"].is_u64());
        assert!(x["elapsedMs"].is_u64() && x["firstRowMs"].is_u64(), "{x}");
        assert_eq!(x["rows"][0], json!(["{\"_id\":0,\"v\":0,\"pad\":\"\"}"]));
        for key in x.as_object().unwrap().keys() {
            assert!(!key.contains('_'), "key không camelCase: {key}");
        }
        // Thời gian từng pha chỉ có khi bật feature `bench-timing`.
        assert_eq!(x.get("readMs").is_some(), cfg!(feature = "bench-timing"), "{x}");
        assert_eq!(x.get("convertMs").is_some(), cfg!(feature = "bench-timing"), "{x}");
    }

    fn blank_text_has_no_statements_and_the_connection_still_works(s: &Server) {
        let c = s.conn();
        for text in ["", "   ", "\n\t ", ";", " ; ;; "] {
            let r = c.exec(text);
            assert_eq!(statements(&r).len(), 0, "{text:?}: {r}");
        }
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn statement_sql_is_the_trimmed_text_of_that_command(s: &Server) {
        let c = s.conn();
        let r = c.exec("  \n {\"ping\": 1}  ;\n\n  {\"ping\":1,\"$db\":\"admin\"}\r\n");
        assert_eq!(st(&r, 0)["sql"], "{\"ping\": 1}");
        assert_eq!(st(&r, 1)["sql"], "{\"ping\":1,\"$db\":\"admin\"}");
        assert_eq!(statements(&r).len(), 2);
    }

    fn plain_commands_return_one_row_holding_the_whole_reply(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("plain");
        c.seed(&db, "c", 4, 0);
        let r = c.exec(&cmd("count", json!("c"), json!({}), Some(&db)));
        let x = st(&r, 0);
        assert_eq!(x["kind"], "rows");
        assert_eq!(x["done"], true);
        assert!(x["cursorId"].is_null());
        assert_eq!(rows_len(x), 1);
        assert_eq!(parse_cell(&x["rows"][0][0]), json!({"n": 4, "ok": 1.0}));
        let build = c.doc(r#"{"buildInfo":1}"#);
        assert!(build["version"].as_str().unwrap().contains('.'));
        assert!(c.doc(r#"{"listDatabases":1}"#)["databases"].is_array());
        let hello = c.doc(r#"{"hello":1}"#);
        assert_eq!(hello["isWritablePrimary"], true);
        let fam = cmd(
            "findAndModify",
            json!("c"),
            json!({"query": {"_id": 1}, "update": {"$set": {"v": -1}}, "new": true}),
            Some(&db),
        );
        assert_eq!(c.doc(&fam)["value"]["v"], -1);
    }

    fn several_commands_run_in_order_and_each_has_its_own_statement(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("multi");
        let text = [
            cmd("insert", json!("c"), json!({"documents": [{"_id": 1}, {"_id": 2}, {"_id": 3}]}), Some(&db)),
            cmd("count", json!("c"), json!({}), Some(&db)),
            find_sorted(&db, "c", json!({})),
            cmd("delete", json!("c"), json!({"deletes": [{"q": {"_id": {"$gt": 1}}, "limit": 0}]}), Some(&db)),
            cmd("count", json!("c"), json!({}), Some(&db)),
        ];
        let r = c.exec(&text.join(";\n"));
        assert_eq!(statements(&r).len(), 5, "{r}");
        for (i, x) in statements(&r).iter().enumerate() {
            assert_eq!(x["index"], i);
            assert_eq!(x["sql"], text[i]);
        }
        assert_eq!(st(&r, 0)["rowsAffected"], 3);
        assert_eq!(docs_of(&r, 1)[0]["n"], 3);
        assert_eq!(ids(&st(&r, 2)["rows"]), vec![1, 2, 3]);
        assert_eq!(st(&r, 3)["rowsAffected"], 2);
        assert_eq!(docs_of(&r, 4)[0]["n"], 1);
    }

    // ---- lỗi ----

    fn server_errors_are_in_the_statement_with_code_name_and_message(s: &Server) {
        let c = s.conn();
        let r = c.exec(r#"{"nosuchcmd":1}"#);
        let x = st(&r, 0);
        assert_eq!(code_of(x), "sqlError");
        assert_eq!(message_of(x), "CommandNotFound (59): no such command: 'nosuchcmd'");
        assert_eq!(x["sql"], r#"{"nosuchcmd":1}"#);
        // Lỗi nằm trong statement, không làm hỏng response hay connection.
        assert_eq!(ok(&r)["statements"].as_array().unwrap().len(), 1);
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
        // Lỗi cú pháp lệnh server khác: lệnh sai tham số.
        let r = c.exec(r#"{"find":5}"#);
        assert_eq!(code_of(st(&r, 0)), "sqlError", "{r}");
        assert!(message_of(st(&r, 0)).contains("(2)") || message_of(st(&r, 0)).contains("("), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn a_command_after_an_error_does_not_run_but_the_ones_before_do(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("stop");
        let ins = |id: i64| cmd("insert", json!("c"), json!({"documents": [{"_id": id}]}), Some(&db));
        let text = format!("{}\n{{\"nosuchcmd\":1}}\n{}", ins(1), ins(2));
        let r = c.exec(&text);
        assert_eq!(statements(&r).len(), 2, "lệnh sau lỗi không được chạy: {r}");
        assert_eq!(st(&r, 0)["rowsAffected"], 1);
        assert_eq!(code_of(st(&r, 1)), "sqlError");
        assert_eq!(all_ids(&c, &db, "c"), vec![1]);
    }

    fn a_syntax_error_in_a_later_command_keeps_the_earlier_ones(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("syntax");
        let ins = cmd("insert", json!("c"), json!({"documents": [{"_id": 1}]}), Some(&db));
        let r = c.exec(&format!("{ins} {{\"find\": }}"));
        assert_eq!(statements(&r).len(), 2, "{r}");
        assert_eq!(st(&r, 0)["rowsAffected"], 1);
        let e = st(&r, 1);
        assert_eq!(code_of(e), "sqlError", "{e}");
        assert!(message_of(e).contains("line 1"), "{e}");
        assert_eq!(all_ids(&c, &db, "c"), vec![1], "lệnh trước lỗi cú pháp vẫn chạy");
    }

    fn duplicate_key_is_a_write_error_with_the_count_that_succeeded(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("dup");
        let dup = cmd("insert", json!("c"), json!({"documents": [{"_id": 1}, {"_id": 1}, {"_id": 2}]}), Some(&db));
        let r = c.exec(&dup);
        let x = st(&r, 0);
        assert_eq!(code_of(x), "sqlError", "{x}");
        let m = message_of(x);
        assert!(m.starts_with("write error: E11000 duplicate key error"), "{m}");
        assert!(m.ends_with("(code 11000); 1 succeeded"), "{m}");
        assert!(x["rowsAffected"].is_null());
        // `ordered` mặc định: dừng ở lỗi đầu, document 2 không được ghi.
        assert_eq!(all_ids(&c, &db, "c"), vec![1]);
        // `ordered: false`: ghi tiếp các document sau lỗi.
        let r = c.exec(&cmd(
            "insert",
            json!("u"),
            json!({"documents": [{"_id": 1}, {"_id": 1}, {"_id": 2}], "ordered": false}),
            Some(&db),
        ));
        assert!(message_of(st(&r, 0)).ends_with("(code 11000); 2 succeeded"), "{r}");
        assert_eq!(all_ids(&c, &db, "u"), vec![1, 2]);
    }

    fn a_write_error_stops_the_commands_after_it(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("wstop");
        let ins = |id: i64| cmd("insert", json!("c"), json!({"documents": [{"_id": id}]}), Some(&db));
        let r = c.exec(&format!("{} {} {}", ins(1), ins(1), ins(2)));
        assert_eq!(statements(&r).len(), 2, "{r}");
        assert_eq!(st(&r, 0)["rowsAffected"], 1);
        assert!(message_of(st(&r, 1)).contains("code 11000"));
        assert_eq!(all_ids(&c, &db, "c"), vec![1]);
    }

    // ---- affected ----

    fn insert_update_and_delete_report_rows_affected(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("aff");
        let docs: Vec<Value> = (0..6).map(|i| json!({"_id": i, "g": i % 2})).collect();
        let r = c.exec(&cmd("insert", json!("c"), json!({"documents": docs}), Some(&db)));
        let x = st(&r, 0);
        assert_eq!(x["kind"], "affected");
        assert_eq!(x["rowsAffected"], 6);
        assert!(x["columns"].is_null() && x["rows"].is_null() && x["cursorId"].is_null());

        let upd = |q: Value, multi: bool, upsert: bool| {
            cmd(
                "update",
                json!("c"),
                json!({"updates": [{"q": q, "u": {"$set": {"x": 1}}, "multi": multi, "upsert": upsert}]}),
                Some(&db),
            )
        };
        let n = |text: String| st(&c.exec(&text), 0)["rowsAffected"].clone();
        assert_eq!(n(upd(json!({"g": 1}), true, false)), 3, "multi: số document khớp");
        assert_eq!(n(upd(json!({"g": 0}), false, false)), 1, "một document");
        assert_eq!(n(upd(json!({"g": 7}), true, false)), 0, "không khớp");
        assert_eq!(n(upd(json!({"_id": 99}), false, true)), 1, "upsert tính là 1");
        assert_eq!(count(&c, &db, "c"), 7);

        let del = |q: Value, limit: u8| {
            cmd("delete", json!("c"), json!({"deletes": [{"q": q, "limit": limit}]}), Some(&db))
        };
        assert_eq!(n(del(json!({"g": 1}), 1)), 1);
        assert_eq!(n(del(json!({"g": 1}), 0)), 2);
        assert_eq!(n(del(json!({"g": 7}), 0)), 0);
        assert_eq!(n(del(json!({}), 0)), 4);
        assert_eq!(count(&c, &db, "c"), 0);
    }

    fn writes_to_a_missing_collection_create_it_and_deletes_on_it_affect_zero(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("miss");
        let r = c.exec(&cmd("delete", json!("nope"), json!({"deletes": [{"q": {}, "limit": 0}]}), Some(&db)));
        assert_eq!(st(&r, 0)["rowsAffected"], 0, "{r}");
        let r = c.exec(&cmd("update", json!("nope"), json!({"updates": [{"q": {}, "u": {"$set": {"a": 1}}}]}), Some(&db)));
        assert_eq!(st(&r, 0)["rowsAffected"], 0, "{r}");
    }

    // ---- find và phân trang ----

    fn find_over_many_pages_has_no_loss_no_duplicate_and_keeps_the_order(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("pages");
        c.seed(&db, "c", 2401, 0);
        // (cỡ trang, batchSize của người dùng, giới hạn số document): batch lệch trang, batch nhỏ hơn
        // trang (một trang gộp nhiều batch), trang lớn hơn cả kết quả, vừa tròn trang.
        let cases = [
            (7_u64, None, 2401_usize),
            (7, Some(100), 2401),
            (7, Some(3), 400),
            (100, Some(3), 1000),
            (1, None, 25),
            (1, Some(1000), 25),
            (500, None, 2401),
            (3000, None, 2401),
            (7, None, 14),
            (7, None, 7),
            (7, None, 1),
        ];
        for (page, batch, n) in cases {
            let mut extra = json!({"limit": n});
            if let Some(b) = batch {
                extra["batchSize"] = json!(b);
            }
            let r = c.exec_page(&find_sorted(&db, "c", extra), page, MAX_BYTES);
            let pages = walk(&c, st(&r, 0), page, MAX_BYTES);
            let label = format!("page={page} batch={batch:?} n={n}");
            let flat: Vec<i64> = pages.iter().flatten().copied().collect();
            assert_eq!(flat, (0..n as i64).collect::<Vec<_>>(), "{label}");
            // Mọi trang trừ trang cuối đầy đúng `page` dòng (kể cả khi ranh giới nằm giữa một batch).
            let (last, full) = pages.split_last().unwrap();
            for (i, p) in full.iter().enumerate() {
                assert_eq!(p.len() as u64, page, "{label}: trang {i}");
            }
            assert!(last.len() as u64 <= page, "{label}");
        }
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn a_result_that_fits_in_one_page_is_done_without_a_cursor(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("small");
        c.seed(&db, "c", 3, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 500, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(x["done"], true);
        assert!(x["cursorId"].is_null());
        assert!(x["truncated"].is_null());
        assert_eq!(rows_len(x), 3);
        // Collection không tồn tại hoặc filter không khớp: 0 dòng, done.
        for text in [find(&db, "missing", json!({})), find(&db, "c", json!({"filter": {"_id": -5}}))] {
            let r = c.exec(&text);
            assert_eq!(st(&r, 0)["done"], true, "{r}");
            assert_eq!(rows_len(st(&r, 0)), 0);
            assert!(st(&r, 0)["cursorId"].is_null());
        }
    }

    fn a_page_that_ends_exactly_at_the_last_document_finishes_cleanly(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("exact");
        c.seed(&db, "c", 14, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 7, MAX_BYTES);
        let x = st(&r, 0);
        assert_eq!(rows_len(x), 7);
        assert_eq!(x["done"], false);
        let cursor = x["cursorId"].as_u64().expect("còn dòng nên giữ cursor");
        let f = c.fetch_page(cursor, 7, MAX_BYTES);
        assert_eq!(ids(&ok(&f)["rows"]), (7..14).collect::<Vec<i64>>());
        // Trang vừa đầy thì chưa biết hết dòng chưa (như SQLite/SQL Server): trang kế rỗng và `done`.
        let last = if ok(&f)["done"] == true { f } else { c.fetch_page(cursor, 7, MAX_BYTES) };
        assert_eq!(ok(&last)["rows"].as_array().unwrap().len(), 0, "{last}");
        assert_eq!(ok(&last)["done"], true);
        // Cursor đã hết thì `fetch` tiếp là `cursorNotFound`, connection vẫn dùng được.
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn batch_size_zero_and_single_batch_do_not_loop_or_lose_documents(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("edge");
        c.seed(&db, "c", 10, 0);
        // `batchSize: 0` cho batch đầu rỗng; getMore sau đó phải lấy đủ.
        let r = c.exec_page(&find_sorted(&db, "c", json!({"batchSize": 0})), 4, MAX_BYTES);
        let pages = walk(&c, st(&r, 0), 4, MAX_BYTES);
        assert_eq!(pages.iter().flatten().count(), 10, "{pages:?}");
        // `singleBatch`: server không giữ cursor.
        let r = c.exec_page(&find_sorted(&db, "c", json!({"singleBatch": true, "batchSize": 10})), 4, MAX_BYTES);
        let pages = walk(&c, st(&r, 0), 4, MAX_BYTES);
        assert_eq!(pages.iter().flatten().count(), 10);
        // `limit: 0` = không giới hạn.
        let r = c.exec_page(&find_sorted(&db, "c", json!({"limit": 0})), 4, MAX_BYTES);
        assert_eq!(walk(&c, st(&r, 0), 4, MAX_BYTES).iter().flatten().count(), 10);
    }

    fn fetch_may_use_a_different_page_size_than_execute(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("fpage");
        c.seed(&db, "c", 100, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 5, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        let f = c.fetch_page(cursor, 60, MAX_BYTES);
        assert_eq!(ids(&ok(&f)["rows"]), (5..65).collect::<Vec<i64>>());
        assert_eq!(ok(&f)["done"], false);
        let f = c.fetch_page(cursor, 1000, MAX_BYTES);
        assert_eq!(ids(&ok(&f)["rows"]), (65..100).collect::<Vec<i64>>());
        assert_eq!(ok(&f)["done"], true);
    }

    fn max_page_bytes_stops_a_page_early_but_always_gives_one_row(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("bytes");
        // Mỗi document khoảng 1 KB.
        c.seed(&db, "c", 60, 1000);
        for batch in [None, Some(100)] {
            let mut extra = json!({});
            if let Some(b) = batch {
                extra["batchSize"] = json!(b);
            }
            let text = find_sorted(&db, "c", extra);
            let r = c.exec_page(&text, 50, 3000);
            let x = st(&r, 0);
            let n = rows_len(x);
            assert!((1..=4).contains(&n), "batch {batch:?}: dừng sớm quanh 3 KB, được {n} dòng");
            assert_eq!(x["done"], false);
            // Đi hết với mức byte nhỏ, không mất không trùng dù trang luôn bị cắt giữa batch.
            let pages = walk(&c, x, 50, 3000);
            let flat: Vec<i64> = pages.iter().flatten().copied().collect();
            assert_eq!(flat, (0..60).collect::<Vec<i64>>(), "batch {batch:?}");
            assert!(pages.iter().all(|p| p.len() <= 4), "{:?}", pages.iter().map(Vec::len).collect::<Vec<_>>());
            // 1 byte: mỗi trang đúng 1 dòng (luôn có ít nhất 1 dòng, không kẹt).
            let r = c.exec_page(&text, 50, 1);
            assert_eq!(rows_len(st(&r, 0)), 1);
            let pages = walk(&c, st(&r, 0), 50, 1);
            assert!(pages.iter().all(|p| p.len() <= 1));
            assert_eq!(pages.iter().flatten().count(), 60);
        }
    }

    fn a_document_larger_than_max_page_bytes_is_still_returned(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("big1");
        c.seed(&db, "c", 3, 20_000);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 10, 100);
        assert_eq!(rows_len(st(&r, 0)), 1);
        assert_eq!(st(&r, 0)["done"], false);
    }

    fn huge_page_sizes_and_zero_max_page_bytes_do_not_break_find_or_aggregate(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("huge");
        c.seed(&db, "c", 10, 0);
        let q = find_sorted(&db, "c", json!({}));
        let agg = cmd("aggregate", json!("c"), json!({"pipeline": [{"$sort": {"_id": 1}}]}), Some(&db));
        for page in [4_000_000_000_u64, u64::from(u32::MAX), 1 << 40, u64::MAX] {
            for text in [&q, &agg] {
                let r = c.exec_page(text, page, MAX_BYTES);
                let x = st(&r, 0);
                assert_eq!(ids(&x["rows"]), (0..10).collect::<Vec<i64>>(), "page {page}: {x}");
                assert_eq!(x["done"], true, "page {page}");
            }
        }
        // `maxPageBytes` 0 vẫn trả ít nhất 1 dòng mỗi trang và đi hết không mất dòng.
        let r = c.exec_page(&q, 10, 0);
        assert_eq!(rows_len(st(&r, 0)), 1);
        let pages = walk(&c, st(&r, 0), 10, 0);
        assert_eq!(pages.iter().flatten().copied().collect::<Vec<_>>(), (0..10).collect::<Vec<i64>>());
    }

    fn many_commands_in_one_request_all_run(s: &Server) {
        let c = s.conn();
        let text = vec![r#"{"ping":1}"#; 300].join(";");
        let r = c.exec(&text);
        assert_eq!(statements(&r).len(), 300);
        assert!(statements(&r).iter().all(|x| x["kind"] == "rows"));
    }

    fn invalid_database_names_are_statement_errors_not_crashes(s: &Server) {
        let c = s.conn();
        for name in ["a.b", "a b", "x/y", "a\"b"] {
            let text = cmd("ping", json!(1), json!({}), Some(name));
            let r = c.exec(&text);
            let x = st(&r, 0);
            assert_eq!(code_of(x), "sqlError", "{name}: {x}");
            assert!(message_of(x).starts_with("InvalidNamespace (73)"), "{name}: {x}");
        }
        let r = c.exec(r#"{"":1}"#);
        assert_eq!(message_of(st(&r, 0)), "CommandNotFound (59): no such command: ''");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn a_cursor_killed_on_the_server_gives_a_server_error_once_then_cursor_not_found(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("killed");
        c.seed(&db, "c", 10, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 3, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        // Lấy id cursor ở server (khác `cursorId` của ta) rồi `killCursors` từ connection khác.
        let pipeline = json!([
            {"$currentOp": {"allUsers": true, "idleCursors": true}},
            {"$match": {"type": "idleCursor", "ns": format!("{db}.c")}}
        ]);
        let ops = monitor.docs(&cmd("aggregate", json!(1), json!({"pipeline": pipeline, "cursor": {}}), Some("admin")));
        assert_eq!(ops.len(), 1);
        let server_id = ops[0]["cursor"]["cursorId"].clone();
        let r = monitor.exec(&cmd("killCursors", json!("c"), json!({"cursors": [server_id]}), Some(&db)));
        assert_eq!(docs_of(&r, 0)[0]["cursorsKilled"].as_array().unwrap().len(), 1);

        let f = c.fetch_page(cursor, 3, MAX_BYTES);
        assert_eq!(err_code(&f), "sqlError", "{f}");
        assert!(f["error"]["message"].as_str().unwrap().starts_with("CursorNotFound (43)"), "{f}");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
        assert_eq!(all_ids(&c, &db, "c").len(), 10);
    }

    // ---- truncated ----

    fn a_non_last_command_with_more_rows_is_truncated_and_the_last_keeps_the_cursor(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("trunc");
        c.seed(&db, "a", 10, 0);
        c.seed(&db, "b", 10, 0);
        let text = format!("{}\n{}", find_sorted(&db, "a", json!({})), find_sorted(&db, "b", json!({})));
        let r = c.exec_page(&text, 3, MAX_BYTES);
        let first = st(&r, 0);
        assert_eq!(first["truncated"], true, "{first}");
        assert_eq!(first["done"], false);
        assert!(first["cursorId"].is_null(), "câu không phải cuối không giữ cursor");
        assert_eq!(ids(&first["rows"]), vec![0, 1, 2]);
        let last = st(&r, 1);
        assert_eq!(last["done"], false);
        assert!(last["truncated"].is_null());
        let cursor = last["cursorId"].as_u64().unwrap();
        assert_eq!(ids(&ok(&c.fetch_page(cursor, 3, MAX_BYTES))["rows"]), vec![3, 4, 5]);
        // Cursor của câu đầu (bị bỏ) đã được server đóng; cursor của câu cuối vẫn mở.
        wait_until_no_cursors(&monitor, &db, "a");
        assert_eq!(monitor.idle_cursors(&db, "b"), 1);
    }

    fn a_non_last_command_with_fewer_rows_than_a_page_is_done_not_truncated(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("notrunc");
        c.seed(&db, "a", 2, 0);
        c.seed(&db, "b", 10, 0);
        let text = format!("{}
{}", find_sorted(&db, "a", json!({})), find_sorted(&db, "b", json!({})));
        let r = c.exec_page(&text, 3, MAX_BYTES);
        let first = st(&r, 0);
        assert!(first["truncated"].is_null(), "{first}");
        assert_eq!(first["done"], true);
        assert_eq!(rows_len(first), 2);
        assert!(first["cursorId"].is_null());
        assert_eq!(st(&r, 1)["done"], false);
        assert!(st(&r, 1)["cursorId"].is_u64());
    }

    /// Trang vừa đầy ở câu không phải cuối: chưa biết còn dòng hay không nên báo `truncated`
    /// (cùng quy ước với các driver khác, xem `rows_statement`); cursor ở server vẫn được đóng.
    fn a_non_last_command_with_exactly_a_page_of_rows_is_reported_truncated(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("exacttrunc");
        c.seed(&db, "a", 3, 0);
        c.seed(&db, "b", 4, 0);
        let text = format!("{}
{}", find_sorted(&db, "a", json!({})), find_sorted(&db, "b", json!({})));
        let r = c.exec_page(&text, 3, MAX_BYTES);
        assert_eq!(st(&r, 0)["truncated"], true, "{r}");
        assert_eq!(rows_len(st(&r, 0)), 3);
        assert!(st(&r, 0)["cursorId"].is_null());
        wait_until_no_cursors(&monitor, &db, "a");
    }

    fn a_syntax_error_after_the_last_command_means_it_cannot_keep_a_cursor(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("synk");
        c.seed(&db, "a", 10, 0);
        let r = c.exec_page(&format!("{} {{\"find\": }}", find_sorted(&db, "a", json!({}))), 3, MAX_BYTES);
        assert_eq!(statements(&r).len(), 2);
        assert_eq!(st(&r, 0)["truncated"], true, "{r}");
        assert!(st(&r, 0)["cursorId"].is_null());
        assert_eq!(code_of(st(&r, 1)), "sqlError");
        wait_until_no_cursors(&monitor, &db, "a");
    }

    // ---- cursor: bỏ, đóng, fetch sai ----

    fn fetch_with_unknown_cursor_or_connection_has_stable_codes(s: &Server) {
        let c = s.conn();
        let r = c.fetch(987_654_321);
        assert_eq!(err_code(&r), "cursorNotFound");
        assert_eq!(r["error"]["message"], "cursor is closed");
        assert_eq!(err_code(&fetch(987_654_321, 1)), "connNotFound");
        assert_eq!(err_code(&exec(987_654_321, r#"{"ping":1}"#)), "connNotFound");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn a_new_execute_abandons_the_previous_cursor_and_the_server_closes_it(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("abandon");
        c.seed(&db, "c", 100, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        assert_eq!(monitor.idle_cursors(&db, "c"), 1, "cursor phải đang mở ở server");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        wait_until_no_cursors(&monitor, &db, "c");
    }

    fn executing_a_command_that_returns_no_cursor_also_abandons_the_old_one(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("abandon2");
        c.seed(&db, "c", 100, 0);
        let r = c.exec_page(&find_sorted(&db, "c", json!({})), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        // Request chỉ có câu lỗi cú pháp cũng làm mất cursor cũ (lệnh mới thay thế hoàn toàn).
        let _ = c.exec("{");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        wait_until_no_cursors(&monitor, &db, "c");
    }

    fn close_with_an_open_cursor_succeeds_and_the_server_closes_it(s: &Server) {
        let monitor = s.conn();
        let db;
        let id;
        {
            let c = s.conn();
            db = c.scratch_db("closing");
            c.seed(&db, "c", 100, 0);
            id = c.id;
            let r = c.exec_page(&find_sorted(&db, "c", json!({})), 10, MAX_BYTES);
            let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
            assert_eq!(monitor.idle_cursors(&db, "c"), 1);
            let t0 = Instant::now();
            ok(&call("close", json!({"connId": id})));
            assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
            assert_eq!(err_code(&exec(id, r#"{"ping":1}"#)), "connNotFound");
            assert_eq!(err_code(&fetch(id, cursor)), "connNotFound");
            // `Conn::drop` sẽ xoá database tạm qua connection này nên mở lại connection khác để dọn.
            let cleaner = s.conn();
            cleaner.exec(&cmd("dropDatabase", json!(1), json!({}), Some(&db)));
        }
        wait_until_no_cursors(&monitor, &db, "c");
    }

    /// B1: `close` khi đang có `find` chạy dài (`$where` ngủ 30 giây): close xong < 2 giây, câu đó
    /// nhận `cancelled`, `exec` sau đó là `connNotFound`.
    fn close_cancels_a_running_find_and_returns_fast(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("close_running");
        c.seed(&db, "c", 2, 0);
        let m = marker("b1_close");
        let sql = find(
            &db,
            "c",
            json!({"filter": {"$where": "sleep(30000) || true"}, "comment": m}),
        );
        let t = c.exec_in_thread(next_id(), &sql);
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        ok(&call("close", json!({"connId": c.id})));
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        assert_eq!(err_code(&c.exec(r#"{"ping":1}"#)), "connNotFound");
        wait_until_gone(&monitor, &m);
        // `Conn::drop` dọn database tạm qua connection đã đóng nên dọn bằng connection khác.
        monitor.exec(&cmd("dropDatabase", json!(1), json!({}), Some(&db)));
    }

    // ---- huỷ ----

    fn cancel_a_slow_find_returns_cancelled_fast_and_the_connection_is_reusable(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("cancel");
        c.seed(&db, "c", 2, 0);
        let m = marker("cancel_find");
        let id = next_id();
        let t = c.exec_in_thread(id, &slow_find(&db, "c", &m));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        // Connection dùng được ngay sau đó, kể cả khi server còn đang chạy câu cũ.
        let t1 = Instant::now();
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
        assert!(t1.elapsed() < Duration::from_secs(5), "{:?}", t1.elapsed());
        assert_eq!(all_ids(&c, &db, "c"), vec![0, 1]);
    }

    fn cancel_in_the_middle_of_several_commands_cancels_the_whole_request(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("cancel_multi");
        c.seed(&db, "c", 2, 0);
        let m = marker("cancel_multi");
        let text = format!("{{\"ping\":1}}\n{}\n{{\"ping\":1}}", slow_find(&db, "c", &m));
        let id = next_id();
        let t = c.exec_in_thread(id, &text);
        wait_until_active(&monitor, &m);
        cancel(id);
        let r = t.join().unwrap();
        // Huỷ trả lỗi cho cả request, không trả kết quả riêng của lệnh `ping` đầu.
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn cancel_during_fetch_returns_cancelled_drops_the_cursor_and_the_server_closes_it(s: &Server) {
        let monitor = s.conn();
        let c = s.conn();
        let db = c.scratch_db("cancel_fetch");
        // Document 0 nhanh, document 1 ngủ 3 giây khi bị `$where` duyệt tới (ở getMore).
        c.exec(&cmd(
            "insert",
            json!("c"),
            json!({"documents": [{"_id": 0, "slow": false}, {"_id": 1, "slow": true}]}),
            Some(&db),
        ));
        let m = marker("cancel_fetch");
        let text = find_sorted(
            &db,
            "c",
            json!({"filter": {"$where": "this.slow ? (sleep(3000) || true) : true"}, "comment": m}),
        );
        let r = c.exec_page(&text, 1, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().expect("còn document 1");
        let id = next_id();
        let conn = c.id;
        let t = std::thread::spawn(move || {
            call_with_id(
                id,
                "fetch",
                json!({"connId": conn, "cursorId": cursor, "pageSize": 1, "maxPageBytes": MAX_BYTES}),
            )
        });
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        while !t.is_finished() {
            cancel(id);
            assert!(t0.elapsed() < Duration::from_secs(2), "fetch không chịu dừng");
            std::thread::yield_now();
        }
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert_eq!(err_code(&c.fetch(cursor)), "cursorNotFound");
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
        // Sau khi câu chậm ở server kết thúc, cursor không còn sót.
        wait_until_gone(&monitor, &m);
        wait_until_no_cursors(&monitor, &db, "c");
    }

    fn cancelling_an_unknown_or_finished_request_changes_nothing(s: &Server) {
        let c = s.conn();
        cancel(987_654_321);
        let id = next_id();
        let r = call_with_id(
            id,
            "execute",
            json!({"connId": c.id, "sql": "{\"ping\":1}", "pageSize": 10, "maxPageBytes": MAX_BYTES}),
        );
        assert_eq!(st(&r, 0)["rows"], json!([["{\"ok\":1.0}"]]));
        cancel(id);
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    fn cancelling_one_connection_leaves_the_others_and_their_cursors_untouched(s: &Server) {
        let monitor = s.conn();
        let a = s.conn();
        let b = s.conn();
        let db = a.scratch_db("iso");
        a.seed(&db, "c", 30, 0);
        a.seed(&db, "w", 2, 0);
        let r = b.exec_page(&find_sorted(&db, "c", json!({})), 10, MAX_BYTES);
        let cursor = st(&r, 0)["cursorId"].as_u64().unwrap();
        let m = marker("iso_cancel");
        let id = next_id();
        let t = a.exec_in_thread(id, &slow_find(&db, "w", &m));
        wait_until_active(&monitor, &m);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        let f = b.fetch_page(cursor, 10, MAX_BYTES);
        assert_eq!(ids(&ok(&f)["rows"]), (10..20).collect::<Vec<i64>>());
        assert_eq!(a.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    // ---- method chỉ SQLite có ----

    fn schema_methods_are_invalid_request_for_mongodb(s: &Server) {
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
        assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
    }

    // ---- aggregate, listCollections, listIndexes ----

    fn aggregate_pages_like_find_and_honours_the_users_cursor_option(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("agg");
        c.seed(&db, "c", 53, 0);
        let pipeline = json!([{"$sort": {"_id": 1}}, {"$match": {"_id": {"$lt": 50}}}]);
        for cursor_opt in [json!({}), json!({"batchSize": 3}), json!({"batchSize": 100})] {
            let text = cmd("aggregate", json!("c"), json!({"pipeline": pipeline, "cursor": cursor_opt}), Some(&db));
            let r = c.exec_page(&text, 7, MAX_BYTES);
            let pages = walk(&c, st(&r, 0), 7, MAX_BYTES);
            let flat: Vec<i64> = pages.iter().flatten().copied().collect();
            assert_eq!(flat, (0..50).collect::<Vec<i64>>(), "cursor {cursor_opt}");
            assert_eq!(pages[0].len(), 7, "cursor {cursor_opt}");
        }
        // Aggregate không `cursor`: driver thêm `cursor: {batchSize}` giúp, server không báo lỗi.
        let text = cmd("aggregate", json!("c"), json!({"pipeline": pipeline}), Some(&db));
        let r = c.exec_page(&text, 7, MAX_BYTES);
        assert_eq!(rows_len(st(&r, 0)), 7, "{r}");
        assert_eq!(st(&r, 0)["done"], false);
    }

    fn list_collections_and_list_indexes_return_documents(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("list");
        c.seed(&db, "alpha", 1, 0);
        c.seed(&db, "beta", 1, 0);
        let mut names: Vec<String> = c
            .docs(&cmd("listCollections", json!(1), json!({}), Some(&db)))
            .iter()
            .map(|d| d["name"].as_str().unwrap().to_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["alpha", "beta"]);
        // Phân trang listCollections: pageSize 1 qua cả hai.
        let r = c.exec_page(&cmd("listCollections", json!(1), json!({}), Some(&db)), 1, MAX_BYTES);
        assert_eq!(rows_len(st(&r, 0)), 1);
        let idx = c.docs(&cmd("listIndexes", json!("alpha"), json!({}), Some(&db)));
        assert_eq!(idx.len(), 1);
        assert_eq!(idx[0]["name"], "_id_");
        // listIndexes trên collection không tồn tại là lỗi của server nằm trong statement.
        let r = c.exec(&cmd("listIndexes", json!("nope"), json!({}), Some(&db)));
        assert!(message_of(st(&r, 0)).starts_with("NamespaceNotFound (26)"), "{r}");
    }

    // ---- kiểu dữ liệu và document lớn ----

    fn bson_types_round_trip_as_relaxed_extended_json(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("types");
        let doc = json!({
            "_id": {"$oid": "507f1f77bcf86cd799439011"},
            "i32": 5, "f64": 1.5, "whole": {"$numberDouble": "2"},
            "i64": {"$numberLong": "9007199254740993"},
            "neg": -7,
            "dec": {"$numberDecimal": "1.50"},
            "date": {"$date": "2020-01-02T03:04:05.678Z"},
            "old": {"$date": {"$numberLong": "-1000"}},
            "bin": {"$binary": {"base64": "AQID", "subType": "00"}},
            "uuid": {"$uuid": "123e4567-e89b-12d3-a456-426614174000"},
            "re": {"$regularExpression": {"pattern": "^a", "options": "i"}},
            "ts": {"$timestamp": {"t": 1, "i": 2}},
            "min": {"$minKey": 1}, "max": {"$maxKey": 1},
            "code": {"$code": "return 1"},
            "nan": {"$numberDouble": "NaN"}, "inf": {"$numberDouble": "Infinity"},
            "t": true, "f": false, "nul": null,
            "s": "tiếng Việt \"q\" \\ \n 日本語 😀",
            "arr": [1, "two", {"three": 3}, [4]],
            "obj": {"a": {"b": {"c": []}}},
        });
        let ins = cmd("insert", json!("c"), json!({"documents": [doc]}), Some(&db));
        assert_eq!(st(&c.exec(&ins), 0)["rowsAffected"], 1);
        let back = c.doc(&find(&db, "c", json!({})));
        let expected = json!({
            "_id": {"$oid": "507f1f77bcf86cd799439011"},
            "i32": 5, "f64": 1.5, "whole": 2.0,
            "i64": 9007199254740993_i64,
            "neg": -7,
            "dec": {"$numberDecimal": "1.50"},
            "date": {"$date": "2020-01-02T03:04:05.678Z"},
            "old": {"$date": {"$numberLong": "-1000"}},
            "bin": {"$binary": {"base64": "AQID", "subType": "00"}},
            "uuid": {"$binary": {"base64": "Ej5FZ+ibEtOkVkJmFBdAAA==", "subType": "04"}},
            "re": {"$regularExpression": {"pattern": "^a", "options": "i"}},
            "ts": {"$timestamp": {"t": 1, "i": 2}},
            "min": {"$minKey": 1}, "max": {"$maxKey": 1},
            "code": {"$code": "return 1"},
            "nan": {"$numberDouble": "NaN"}, "inf": {"$numberDouble": "Infinity"},
            "t": true, "f": false, "nul": null,
            "s": "tiếng Việt \"q\" \\ \n 日本語 😀",
            "arr": [1, "two", {"three": 3}, [4]],
            "obj": {"a": {"b": {"c": []}}},
        });
        assert_eq!(back, expected);
        // Văn bản thô là một dòng gọn: không xuống dòng, không khoảng trắng thừa ngoài chuỗi.
        let r = c.exec(&find(&db, "c", json!({})));
        let raw = st(&r, 0)["rows"][0][0].as_str().unwrap();
        assert!(!raw.contains('\n') && raw.starts_with("{\"_id\":{\"$oid\""), "{raw}");
    }

    fn a_float_with_a_fraction_keeps_its_point_and_integers_do_not_gain_one(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("nums");
        let docs = json!([{"_id": 1, "a": 1.0, "b": 1, "c": 0.1, "d": 1e21, "e": {"$numberLong": "5"}}]);
        c.exec(&cmd("insert", json!("c"), json!({"documents": docs}), Some(&db)));
        let r = c.exec(&find(&db, "c", json!({})));
        let raw = st(&r, 0)["rows"][0][0].as_str().unwrap();
        assert_eq!(raw, r#"{"_id":1,"a":1.0,"b":1,"c":0.1,"d":1e21,"e":5}"#);
    }

    fn a_multi_megabyte_document_round_trips(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("big");
        let text: String = "é".repeat(1_500_000);
        let ins = cmd("insert", json!("c"), json!({"documents": [{"_id": 1, "t": text}]}), Some(&db));
        assert_eq!(st(&c.exec(&ins), 0)["rowsAffected"], 1);
        let r = c.exec(&find(&db, "c", json!({})));
        let back = parse_cell(&st(&r, 0)["rows"][0][0]);
        assert_eq!(back["t"].as_str().unwrap().chars().count(), 1_500_000);
        assert_eq!(back["t"], text.as_str());
    }

    fn deeply_nested_documents_are_written_or_reported_not_crashed(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("deep");
        // Server giới hạn 100 mức lồng; dưới giới hạn đó phải ra đúng.
        let mut doc = json!({"leaf": 1});
        for _ in 0..90 {
            doc = json!({"n": doc});
        }
        let ins = cmd("insert", json!("c"), json!({"documents": [{"_id": 1, "d": doc}]}), Some(&db));
        assert_eq!(st(&c.exec(&ins), 0)["rowsAffected"], 1);
        let back = c.doc(&find(&db, "c", json!({})));
        let mut cur = &back["d"];
        for _ in 0..90 {
            cur = &cur["n"];
        }
        assert_eq!(cur["leaf"], 1);
    }

    // ---- mật khẩu không lọt vào lỗi ----

    fn the_password_never_appears_in_any_response(s: &Server) {
        let c = s.conn();
        let db = c.scratch_db("pw");
        let mut responses = vec![
            c.exec(r#"{"nosuchcmd":1}"#),
            c.exec(r#"{"find": }"#),
            c.exec(r#"{"buildInfo":1}"#),
            c.exec(r#"{"hello":1}"#),
            c.exec(r#"{"connectionStatus":1}"#),
            c.exec(&cmd("insert", json!("c"), json!({"documents": [{"_id": 1}, {"_id": 1}]}), Some(&db))),
            c.fetch(123),
            call("schemaTree", json!({"connId": c.id})),
            call("open", s.params_with("disable", json!({"password": s.wrong_password()}))),
            call("open", s.params_with("verify-full", json!({"tls": {"mode": "verify-full", "caFile": "Z:/khong/co.pem"}}))),
        ];
        responses.push(call("open", json!({"driver": "mongodb", "username": "root", "password": "x"})));
        for r in responses {
            assert!(!s.password_leaks_in(&r), "{r}");
        }
    }
}

/// Host không nối được: `open` chờ hết thời gian nối (10 giây) rồi `openFailed`, thông báo không
/// chứa mật khẩu. Hai trường hợp (cổng đóng, tên miền không tồn tại) chạy song song để chỉ tốn
/// một lần chờ. Không cần server thật nên không dùng macro `mongo!`.
#[test]
fn unreachable_hosts_fail_after_the_connect_timeout_without_leaking_the_password() {
    const SECRET: &str = "s3cr3t-pw-for-unreachable";
    let open = |host: &'static str, port: u16| {
        std::thread::spawn(move || {
            let t0 = Instant::now();
            let r = call(
                "open",
                json!({"driver": "mongodb", "host": host, "port": port, "username": "root", "password": SECRET}),
            );
            (r, t0.elapsed())
        })
    };
    // Cổng 1 trên loopback: bị từ chối ngay, nhưng driver vẫn thử lại tới hết thời gian chọn server.
    let closed = open("127.0.0.1", 1);
    let dns = open("nonexistent.invalid", 27017);
    for (name, handle) in [("closed port", closed), ("unknown host", dns)] {
        let (r, took) = handle.join().unwrap();
        assert_eq!(err_code(&r), "openFailed", "{name}: {r}");
        assert!(!r.to_string().contains(SECRET), "{name}: {r}");
        assert!(took < Duration::from_secs(20), "{name}: {took:?}");
        assert!(
            took >= Duration::from_secs(1),
            "{name}: {took:?} (phải chờ chứ không từ chối ngay)"
        );
    }
}

/// Thiếu host là `invalidRequest` ngay (không nối mạng) và không lộ mật khẩu.
#[test]
fn a_missing_host_is_invalid_request_and_never_echoes_the_password() {
    const SECRET: &str = "s3cr3t-pw-for-missing-host";
    for host in [json!(null), json!("")] {
        let r = call(
            "open",
            json!({"driver": "mongodb", "host": host, "username": "root", "password": SECRET}),
        );
        assert_eq!(err_code(&r), "invalidRequest", "{host}");
        assert_eq!(r["error"]["message"], "missing host");
        assert!(!r.to_string().contains(SECRET));
    }
    let r = call(
        "open",
        json!({"driver": "mongodb", "username": "root", "password": SECRET}),
    );
    assert_eq!(err_code(&r), "invalidRequest");
    assert_eq!(r["error"]["message"], "missing host");
}
