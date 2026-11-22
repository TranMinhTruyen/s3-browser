use super::*;
use serde::Deserialize;

/// Kiểu giả chỉ để chạm nhánh `unknown field` (kiểu thật không `deny_unknown_fields`).
#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct Strict {
    name: String,
}

fn parse(json: &str) -> DbResult<Strict> {
    let raw = RawValue::from_string(json.to_owned()).unwrap();
    parse_params(Some(&raw))
}

fn err_message(json: &str) -> String {
    parse(json).unwrap_err().message
}

#[test]
fn missing_params_is_invalid_request() {
    let e = parse_params::<Strict>(None).unwrap_err();
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "missing params");
}

#[test]
fn missing_field_message_has_field_name_line_and_column() {
    let msg = err_message("{}");
    assert_eq!(msg, "invalid params (Data: name) at line 1 column 2");
}

#[test]
fn unknown_field_names_the_field_but_never_the_value() {
    let msg = err_message(r#"{"name":"n","extra":"Zq9-secret-value"}"#);
    assert!(
        msg.starts_with("invalid params (Data: extra) at line 1 column"),
        "{msg}"
    );
    assert!(!msg.contains("Zq9-secret-value"), "{msg}");
}

#[test]
fn wrong_type_never_echoes_the_value() {
    let msg = err_message(r#"{"name": 123456789}"#);
    assert!(
        msg.starts_with("invalid params (Data) at line 1 column"),
        "{msg}"
    );
    assert!(!msg.contains("123456789"), "{msg}");
}

#[test]
fn field_name_filter_only_accepts_schema_like_names() {
    // `RawValue` đã hợp lệ cú pháp; dùng JSON hợp lệ nhưng kết thúc sớm là không thể, nên
    // kiểm hàm lọc tên field riêng.
    assert_eq!(missing_field("missing field `a_b1`"), Some("a_b1"));
    assert_eq!(missing_field("unknown field `x`, expected `y`"), Some("x"));
    assert_eq!(
        missing_field("invalid type: string \"s\", expected u16"),
        None
    );
    // Tên có ký tự lạ (có thể là giá trị người dùng) bị bỏ; thiếu backtick đóng cũng vậy.
    assert_eq!(missing_field("unknown field `a b`"), None);
    assert_eq!(missing_field("unknown field `pw\"`"), None);
    assert_eq!(missing_field("missing field `abc"), None);
}
