//! N1: protocol, dispatch, FFI, registry.

mod common;

use common::*;
use s3b_db::ffi::{s3b_call, s3b_cancel, s3b_free, s3b_init};
use s3b_db::protocol::{DbError, error_response, ok_response};
use s3b_db::registry::Registry;
use serde_json::{Value, json};
use std::{ptr, slice};

#[test]
fn init_twice_is_ok() {
    assert_eq!(s3b_init(), 0);
    assert_eq!(s3b_init(), 0);
}

#[test]
fn invalid_json_is_invalid_request() {
    for bad in [&b"{not json"[..], b"", b"\xff\xfe\x00", b"[]", b"\"str\""] {
        assert_eq!(err_code(&call_raw(bad)), "invalidRequest");
    }
}

#[test]
fn missing_id_or_method_is_invalid_request() {
    for req in [
        json!({"method": "close", "params": {"connId": 1}}),
        json!({"id": 1, "params": {"connId": 1}}),
        json!({"id": "x", "method": "close", "params": {}}),
    ] {
        assert_eq!(
            err_code(&call_raw(req.to_string().as_bytes())),
            "invalidRequest"
        );
    }
}

#[test]
fn unknown_method_is_invalid_request() {
    let r = call("nope", json!({}));
    assert_eq!(err_code(&r), "invalidRequest");
}

#[test]
fn missing_or_wrong_params_is_invalid_request() {
    // thiếu params
    let r = call_raw(br#"{"id":1,"method":"execute"}"#);
    assert_eq!(err_code(&r), "invalidRequest");
    // params null
    let r = call_raw(br#"{"id":1,"method":"execute","params":null}"#);
    assert_eq!(err_code(&r), "invalidRequest");
    // thiếu field
    assert_eq!(
        err_code(&call("execute", json!({"connId": 1, "sql": "SELECT 1"}))),
        "invalidRequest"
    );
    // sai kiểu
    assert_eq!(
        err_code(&call("close", json!({"connId": "abc"}))),
        "invalidRequest"
    );
    assert_eq!(
        err_code(&call("fetch", json!({"connId": 1}))),
        "invalidRequest"
    );
    assert_eq!(
        err_code(&call("tableInfo", json!({"connId": 1, "schema": "main"}))),
        "invalidRequest"
    );
    assert_eq!(
        err_code(&call("open", json!({"driver": "sqlite"}))),
        "invalidRequest"
    );
}

#[test]
fn unsupported_driver_is_invalid_request() {
    let r = call("open", json!({"driver": "postgres", "path": "x"}));
    assert_eq!(err_code(&r), "invalidRequest");
}

#[test]
fn response_shapes_are_camel_case() {
    let ok = ok_response(&json!({"connId": 1}));
    let v: Value = serde_json::from_slice(&ok).unwrap();
    assert_eq!(v, json!({"ok": true, "result": {"connId": 1}}));

    let e = error_response(&DbError::new("sqlError", "boom"));
    let v: Value = serde_json::from_slice(&e).unwrap();
    assert_eq!(
        v,
        json!({"ok": false, "error": {"code": "sqlError", "message": "boom"}})
    );

    // field thật: connId, elapsedMs, rowsAffected, cursorId
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a); INSERT INTO t VALUES(1)");
    let st = statements(&r);
    assert!(st[1]["rowsAffected"].is_number());
    assert!(st[1]["elapsedMs"].is_number());
    assert!(st[1].get("rows_affected").is_none());
    let r = db.exec(&series(600));
    assert!(statements(&r)[0]["cursorId"].is_number());
}

#[test]
fn null_pointers_return_error_code_without_panic() {
    init();
    let req = br#"{"id":1,"method":"close","params":{"connId":1}}"#;
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    // SAFETY: các con trỏ null được hàm kiểm trước khi dùng; con trỏ còn lại hợp lệ.
    unsafe {
        assert_ne!(s3b_call(ptr::null(), 0, &mut out, &mut len), 0);
        assert_ne!(
            s3b_call(req.as_ptr(), req.len(), ptr::null_mut(), &mut len),
            0
        );
        assert_ne!(
            s3b_call(req.as_ptr(), req.len(), &mut out, ptr::null_mut()),
            0
        );
    }
    assert!(out.is_null());
}

#[test]
fn returned_buffer_matches_len_and_is_freed() {
    init();
    let req = br#"{"id":1,"method":"nope","params":{}}"#;
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    // SAFETY: tham số hợp lệ; (out, len) trả từ s3b_call được đọc rồi giải phóng đúng một lần.
    unsafe {
        assert_eq!(s3b_call(req.as_ptr(), req.len(), &mut out, &mut len), 0);
        assert!(!out.is_null());
        let v: Value = serde_json::from_slice(slice::from_raw_parts(out, len)).unwrap();
        assert_eq!(v["ok"], false);
        s3b_free(out, len);
        // null là no-op
        s3b_free(ptr::null_mut(), 0);
    }
}

#[test]
fn cancel_unknown_id_is_noop() {
    init();
    s3b_cancel(u64::MAX);
    s3b_cancel(0);
    cancel(123_456_789);
}

#[test]
fn many_calls_do_not_leak_or_crash() {
    for _ in 0..200 {
        assert_eq!(err_code(&call("nope", json!({}))), "invalidRequest");
    }
}

#[test]
fn registry_request_cancel_flag() {
    let reg: &'static Registry = Box::leak(Box::default());
    let g = reg.begin_request(7, 1);
    assert!(!g.flag.is_cancelled());
    reg.cancel(8); // id lạ
    assert!(!g.flag.is_cancelled());
    reg.cancel(7);
    assert!(g.flag.is_cancelled());
    let flag = g.flag.clone();
    drop(g);
    // đã xong: cancel sau đó bỏ qua, không panic
    reg.cancel(7);
    assert!(flag.is_cancelled());
}

#[test]
fn registry_conn_lookup() {
    let reg: &'static Registry = Box::leak(Box::default());
    assert!(reg.conn_tx(1).is_none());
    assert!(reg.remove_conn(1, true).is_none());
    let a = reg.next_conn_id();
    let b = reg.next_conn_id();
    assert!(b > a);
}

#[cfg(debug_assertions)]
#[test]
fn panic_in_task_is_internal_and_process_survives() {
    let r = call("__panic", json!({}));
    assert_eq!(err_code(&r), "internal");
    // runtime còn dùng được, request sau vẫn chạy bình thường
    assert_eq!(err_code(&call("nope", json!({}))), "invalidRequest");
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a); INSERT INTO t VALUES(1)"));
    let r = db.exec("SELECT a FROM t");
    assert_eq!(statements(&r)[0]["rows"], json!([["1"]]));
}

#[cfg(debug_assertions)]
#[test]
fn panic_outside_task_is_caught_by_ffi() {
    init();
    let req = br#"{"id":1,"method":"__panic_outer","params":{}}"#;
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    // SAFETY: tham số hợp lệ; catch_unwind của s3b_call bắt panic nên không unwind qua đây.
    let rc = unsafe { s3b_call(req.as_ptr(), req.len(), &mut out, &mut len) };
    assert_eq!(rc, -1);
    assert!(out.is_null());
    assert_eq!(len, 0);
    // process và runtime vẫn sống
    assert_eq!(err_code(&call("nope", json!({}))), "invalidRequest");
}
