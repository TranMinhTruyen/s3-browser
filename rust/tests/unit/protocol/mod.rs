use super::*;
use serde_json::{Value, json};
use std::fmt::Debug;
use std::marker::PhantomData;

/// Mẹo kiểm lúc biên dịch: `Probe::<T>::new().is_debug()` trả `true` chỉ khi `T: Debug`
/// (phương thức riêng có ràng buộc thắng phương thức của trait khi ràng buộc thoả mãn).
struct Probe<T>(PhantomData<T>);

trait NotDebug {
    fn is_debug(&self) -> bool {
        false
    }
}

impl<T> NotDebug for Probe<T> {}

impl<T: Debug> Probe<T> {
    fn is_debug(&self) -> bool {
        true
    }
}

fn open(v: Value) -> Result<OpenParams, serde_json::Error> {
    serde_json::from_value(v)
}

fn tls(v: Value) -> Result<TlsParams, serde_json::Error> {
    serde_json::from_value(v)
}

// ---- TlsMode ----

#[test]
fn all_six_tls_modes_parse() {
    for (text, mode) in [
        ("disable", TlsMode::Disable),
        ("allow", TlsMode::Allow),
        ("prefer", TlsMode::Prefer),
        ("require", TlsMode::Require),
        ("verify-ca", TlsMode::VerifyCa),
        ("verify-full", TlsMode::VerifyFull),
    ] {
        let got: TlsMode = serde_json::from_value(json!(text)).unwrap();
        assert_eq!(got, mode, "{text}");
    }
}

#[test]
fn unknown_or_misspelled_tls_modes_are_rejected() {
    for text in [
        "",
        "on",
        "off",
        "ssl",
        "verify_ca",
        "verifyCa",
        "VerifyCa",
        "verify-full ",
        "Disable",
        "REQUIRE",
        "verify",
    ] {
        assert!(
            serde_json::from_value::<TlsMode>(json!(text)).is_err(),
            "{text:?} phải bị từ chối"
        );
    }
    for not_a_string in [json!(null), json!(1), json!(true), json!(["require"])] {
        assert!(serde_json::from_value::<TlsMode>(not_a_string).is_err());
    }
}

#[test]
fn tls_mode_default_is_disable() {
    assert_eq!(TlsMode::default(), TlsMode::Disable);
}

// ---- TlsParams ----

#[test]
fn tls_params_defaults_when_fields_are_missing() {
    let p = tls(json!({})).unwrap();
    assert_eq!(p.mode, TlsMode::Disable);
    assert_eq!(p.ca_file, None);
    assert_eq!(p, TlsParams::default());
}

#[test]
fn tls_params_reads_mode_and_camel_case_ca_file() {
    let p = tls(json!({"mode": "verify-full", "caFile": "C:\\certs\\ca.pem"})).unwrap();
    assert_eq!(p.mode, TlsMode::VerifyFull);
    assert_eq!(p.ca_file.as_deref(), Some("C:\\certs\\ca.pem"));
}

#[test]
fn tls_params_ca_file_alone_keeps_mode_disable() {
    let p = tls(json!({"caFile": "x.pem"})).unwrap();
    assert_eq!(p.mode, TlsMode::Disable);
    assert_eq!(p.ca_file.as_deref(), Some("x.pem"));
}

#[test]
fn tls_params_null_ca_file_is_none() {
    let p = tls(json!({"mode": "require", "caFile": null})).unwrap();
    assert_eq!(p.ca_file, None);
}

#[test]
fn tls_params_bad_types_are_rejected() {
    assert!(tls(json!({"mode": "bogus"})).is_err());
    assert!(tls(json!({"mode": 3})).is_err());
    assert!(tls(json!({"caFile": 3})).is_err());
    assert!(tls(json!({"caFile": ["a"]})).is_err());
}

#[test]
fn tls_params_snake_case_ca_file_is_not_read() {
    // Hợp đồng là camelCase; `ca_file` bị bỏ qua như field lạ, không thành đường dẫn CA.
    let p = tls(json!({"mode": "require", "ca_file": "x.pem"})).unwrap();
    assert_eq!(p.ca_file, None);
}

// ---- OpenParams ----

#[test]
fn old_sqlite_open_json_still_parses() {
    let p = open(json!({"driver": "sqlite", "path": "C:\\data\\a.db"})).unwrap();
    assert_eq!(p.driver, "sqlite");
    assert_eq!(p.path.as_deref(), Some("C:\\data\\a.db"));
    assert!(!p.read_only);
    assert_eq!(p.host, None);
    assert_eq!(p.port, None);
    assert_eq!(p.database, None);
    assert_eq!(p.username, None);
    assert_eq!(p.password, None);
    assert_eq!(p.tls, TlsParams::default());

    let p = open(json!({"driver": "sqlite", "path": "a.db", "readOnly": true})).unwrap();
    assert!(p.read_only);
}

#[test]
fn only_driver_is_required() {
    let p = open(json!({"driver": "postgres"})).unwrap();
    assert_eq!(p.driver, "postgres");
    assert_eq!(p.path, None);
    assert!(open(json!({})).is_err());
    assert!(open(json!({"path": "a.db"})).is_err());
    assert!(open(json!({"driver": null})).is_err());
    assert!(open(json!({"driver": 1})).is_err());
}

#[test]
fn network_fields_are_read_in_camel_case() {
    let p = open(json!({
        "driver": "postgres",
        "host": "db.test",
        "port": 5432,
        "database": "app",
        "username": "u",
        "password": "p",
        "tls": {"mode": "verify-ca", "caFile": "ca.pem"},
        "readOnly": true,
    }))
    .unwrap();
    assert_eq!(p.host.as_deref(), Some("db.test"));
    assert_eq!(p.port, Some(5432));
    assert_eq!(p.database.as_deref(), Some("app"));
    assert_eq!(p.username.as_deref(), Some("u"));
    assert_eq!(p.password.as_deref(), Some("p"));
    assert_eq!(p.tls.mode, TlsMode::VerifyCa);
    assert_eq!(p.tls.ca_file.as_deref(), Some("ca.pem"));
    assert!(p.read_only);
}

#[test]
fn port_boundaries() {
    assert_eq!(
        open(json!({"driver": "x", "port": 0})).unwrap().port,
        Some(0)
    );
    assert_eq!(
        open(json!({"driver": "x", "port": 65535})).unwrap().port,
        Some(65535)
    );
    for bad in [
        json!(65536),
        json!(-1),
        json!("5432"),
        json!(1.5),
        json!(true),
    ] {
        assert!(open(json!({"driver": "x", "port": bad})).is_err());
    }
    assert_eq!(
        open(json!({"driver": "x", "port": null})).unwrap().port,
        None
    );
}

#[test]
fn unknown_tls_mode_inside_open_is_an_error() {
    assert!(open(json!({"driver": "postgres", "host": "h", "tls": {"mode": "yes"}})).is_err());
}

#[test]
fn open_params_without_tls_uses_disable() {
    let p = open(json!({"driver": "postgres", "host": "h"})).unwrap();
    assert_eq!(p.tls.mode, TlsMode::Disable);
}

#[test]
fn unknown_extra_fields_are_ignored() {
    let p = open(json!({"driver": "sqlite", "path": "a.db", "futureField": 1})).unwrap();
    assert_eq!(p.driver, "sqlite");
}

#[test]
fn open_params_has_no_debug_but_tls_types_do() {
    // `OpenParams` chứa mật khẩu: không được `Debug` để không in nhầm ra log.
    assert!(!Probe::<OpenParams>(PhantomData).is_debug());
    assert!(Probe::<TlsParams>(PhantomData).is_debug());
    assert!(Probe::<TlsMode>(PhantomData).is_debug());
    assert!(Probe::<DbError>(PhantomData).is_debug());
}

#[test]
fn debug_probe_detects_debug_types() {
    // Chứng minh mẹo kiểm tra không luôn trả `false`.
    assert!(Probe::<String>(PhantomData).is_debug());
}

// ---- Response ----

#[test]
fn error_response_has_stable_shape() {
    let v: Value =
        serde_json::from_slice(&error_response(&DbError::new(OPEN_FAILED, "boom"))).unwrap();
    assert_eq!(
        v,
        json!({"ok": false, "error": {"code": "openFailed", "message": "boom"}})
    );
}

#[test]
fn ok_response_wraps_result() {
    let v: Value = serde_json::from_slice(&ok_response(&OpenResult { conn_id: 7 })).unwrap();
    assert_eq!(v, json!({"ok": true, "result": {"connId": 7}}));
    let v: Value = serde_json::from_slice(&ok_response(&Empty {})).unwrap();
    assert_eq!(v, json!({"ok": true, "result": {}}));
}

#[test]
fn error_codes_are_the_documented_strings() {
    assert_eq!(
        [
            INVALID_REQUEST,
            OPEN_FAILED,
            NOT_A_DATABASE,
            CONN_NOT_FOUND,
            CURSOR_NOT_FOUND,
            SQL_ERROR,
            TABLE_NOT_FOUND,
            INTERNAL,
            CANCELLED,
        ],
        [
            "invalidRequest",
            "openFailed",
            "notADatabase",
            "connNotFound",
            "cursorNotFound",
            "sqlError",
            "tableNotFound",
            "internal",
            "cancelled",
        ]
    );
    assert_eq!(DbError::internal("x").code, INTERNAL);
}

#[test]
fn request_params_are_optional_and_borrowed() {
    let r: Request = serde_json::from_str(r#"{"id":3,"method":"open"}"#).unwrap();
    assert_eq!((r.id, r.method.as_str()), (3, "open"));
    assert!(r.params.is_none());
    let r: Request = serde_json::from_str(r#"{"id":3,"method":"open","params":{"a":1}}"#).unwrap();
    assert_eq!(r.params.unwrap().get(), r#"{"a":1}"#);
}

#[test]
fn statement_result_omits_first_row_ms_when_none() {
    let s = StatementResult {
        index: 0,
        sql: "SELECT 1".into(),
        kind: "rows",
        columns: None,
        rows: None,
        cursor_id: None,
        done: Some(true),
        truncated: None,
        rows_affected: None,
        elapsed_ms: 1,
        first_row_ms: None,
        #[cfg(feature = "bench-timing")]
        read_ms: None,
        #[cfg(feature = "bench-timing")]
        convert_ms: None,
        error: None,
    };
    let v = serde_json::to_value(&s).unwrap();
    assert!(v.get("firstRowMs").is_none());
    let s = StatementResult {
        first_row_ms: Some(0),
        ..s
    };
    // `Some(0)` vẫn xuất hiện (khác `None`).
    assert_eq!(serde_json::to_value(&s).unwrap()["firstRowMs"], json!(0));
}
