use super::*;
use mongodb::bson::{doc, oid::ObjectId};

// ---- written: số document bị ảnh hưởng ----

#[test]
fn written_reads_n_of_every_numeric_type() {
    assert_eq!(written(&doc! {"ok": 1.0, "n": 5_i32}), Ok(5));
    assert_eq!(written(&doc! {"ok": 1.0, "n": 5_i64}), Ok(5));
    assert_eq!(written(&doc! {"ok": 1.0, "n": 5.0_f64}), Ok(5));
    assert_eq!(written(&doc! {"ok": 1.0, "n": 5.9_f64}), Ok(5));
    assert_eq!(
        written(&doc! {"ok": 1.0, "n": i64::MAX}),
        Ok(i64::MAX),
        "n lớn giữ nguyên"
    );
    assert_eq!(written(&doc! {"n": i32::MAX}), Ok(i64::from(i32::MAX)));
    assert_eq!(written(&doc! {"n": 0}), Ok(0));
}

#[test]
fn written_saturates_a_huge_double() {
    assert_eq!(written(&doc! {"n": 1e30_f64}), Ok(i64::MAX));
    assert_eq!(written(&doc! {"n": f64::NAN}), Ok(0));
}

#[test]
fn written_treats_missing_or_odd_n_as_zero() {
    assert_eq!(written(&doc! {"ok": 1.0}), Ok(0));
    assert_eq!(written(&doc! {}), Ok(0));
    assert_eq!(written(&doc! {"n": "7"}), Ok(0));
    assert_eq!(written(&doc! {"n": Bson::Null}), Ok(0));
}

#[test]
fn written_reports_the_first_write_error_with_its_code_and_the_count_so_far() {
    let reply = doc! {
        "ok": 1.0, "n": 2,
        "writeErrors": [
            {"index": 2, "code": 11000, "errmsg": "E11000 duplicate key error"},
            {"index": 3, "code": 11000, "errmsg": "second one"},
        ]
    };
    assert_eq!(
        written(&reply),
        Err("write error: E11000 duplicate key error (code 11000); 2 succeeded".to_owned())
    );
}

#[test]
fn written_write_error_without_a_code_omits_it() {
    let reply = doc! {"n": 0, "writeErrors": [{"index": 0, "errmsg": "boom"}]};
    assert_eq!(
        written(&reply),
        Err("write error: boom; 0 succeeded".to_owned())
    );
    // Mã không phải Int32 (Int64) cũng không được in.
    let reply = doc! {"n": 1, "writeErrors": [{"code": 5_i64, "errmsg": "boom"}]};
    assert_eq!(
        written(&reply),
        Err("write error: boom; 1 succeeded".to_owned())
    );
}

#[test]
fn written_write_error_without_a_message_says_unknown_error() {
    let reply = doc! {"n": 0, "writeErrors": [{"code": 9}]};
    assert_eq!(
        written(&reply),
        Err("write error: unknown error (code 9); 0 succeeded".to_owned())
    );
}

#[test]
fn written_ignores_malformed_write_errors() {
    // Mảng rỗng, phần tử không phải document, giá trị không phải mảng/document: coi như không lỗi.
    assert_eq!(written(&doc! {"n": 3, "writeErrors": []}), Ok(3));
    assert_eq!(written(&doc! {"n": 3, "writeErrors": [1, 2]}), Ok(3));
    assert_eq!(written(&doc! {"n": 3, "writeErrors": "x"}), Ok(3));
    assert_eq!(written(&doc! {"n": 3, "writeErrors": Bson::Null}), Ok(3));
}

#[test]
fn written_accepts_a_single_document_instead_of_an_array() {
    // Hàm đọc cả dạng document đơn (phòng server khác) bằng cùng đường với phần tử đầu mảng.
    let reply = doc! {"n": 1, "writeErrors": {"code": 7, "errmsg": "single"}};
    assert_eq!(
        written(&reply),
        Err("write error: single (code 7); 1 succeeded".to_owned())
    );
}

#[test]
fn written_reports_a_write_concern_error() {
    let reply = doc! {
        "ok": 1.0, "n": 4,
        "writeConcernError": {"code": 64, "errmsg": "waiting for replication timed out"}
    };
    assert_eq!(
        written(&reply),
        Err(
            "write concern error: waiting for replication timed out (code 64); 4 written"
                .to_owned()
        )
    );
}

#[test]
fn written_prefers_write_errors_over_write_concern_error() {
    let reply = doc! {
        "n": 1,
        "writeErrors": [{"code": 1, "errmsg": "first"}],
        "writeConcernError": {"code": 2, "errmsg": "second"}
    };
    let err = written(&reply).unwrap_err();
    assert!(err.starts_with("write error: first"), "{err}");
}

// ---- reply_row: document trả lời thành một dòng JSON ----

#[test]
fn reply_row_is_compact_extended_json() {
    let oid = ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
    let text = reply_row(&doc! {"ok": 1.0, "id": oid, "n": 3_i64}).unwrap();
    assert_eq!(
        text,
        r#"{"ok":1.0,"id":{"$oid":"507f1f77bcf86cd799439011"},"n":3}"#
    );
}

#[test]
fn reply_row_of_an_empty_document() {
    assert_eq!(reply_row(&doc! {}).unwrap(), "{}");
}

#[test]
fn reply_row_keeps_unicode_and_escapes_strings() {
    let text = reply_row(&doc! {"s": "tiếng Việt \"q\"\n"}).unwrap();
    assert_eq!(text, "{\"s\":\"tiếng Việt \\\"q\\\"\\n\"}");
}

#[test]
fn reply_row_reports_a_too_deeply_nested_reply_as_an_error_string() {
    let mut d = doc! {"v": 1};
    for _ in 0..250 {
        d = doc! {"a": d};
    }
    // bson có thể từ chối trước khi tới `ejson`; cả hai cách đều phải ra `Err`, không panic.
    assert!(reply_row(&d).is_err());
}

// ---- các hàm hằng ----

#[test]
fn document_column_is_one_json_column_named_document() {
    let cols = document_column();
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].name, "document");
    assert_eq!(cols[0].ty, "json");
}

#[test]
fn unsupported_is_an_invalid_request() {
    let e = unsupported();
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "method not supported by driver");
}

#[test]
fn bad_reply_is_a_sql_error() {
    let e = bad_reply();
    assert_eq!(e.code, SQL_ERROR);
    assert_eq!(e.message, "unexpected reply from server");
}
