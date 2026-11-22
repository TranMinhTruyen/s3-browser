use super::*;
use mongodb::bson::spec::BinarySubtype;
use mongodb::bson::{
    Binary, Bson, DateTime, Decimal128, Document, JavaScriptCodeWithScope, RawDocumentBuf, Regex,
    Timestamp, doc, oid::ObjectId,
};
use serde_json::Value;

/// Document thành chuỗi Extended JSON bằng đường của driver (qua BSON thô).
fn render(d: &Document) -> String {
    let raw = RawDocumentBuf::try_from(d).unwrap();
    document_to_string(&raw).unwrap()
}

/// Chuỗi của document một khoá `v`.
fn one(v: impl Into<Bson>) -> String {
    render(&doc! { "v": v.into() })
}

/// Kết quả phải là JSON một dòng hợp lệ và trùng ngữ nghĩa với chuẩn của crate `bson`.
fn assert_matches_bson(d: Document) {
    let ours = render(&d);
    assert!(!ours.contains('\n') && !ours.contains('\r'), "{ours}");
    let parsed: Value = serde_json::from_str(&ours).unwrap_or_else(|e| panic!("{e}: {ours}"));
    assert_eq!(parsed, Bson::Document(d).into_relaxed_extjson(), "{ours}");
}

fn one_matches_bson(v: impl Into<Bson>) {
    assert_matches_bson(doc! { "v": v.into() });
}

/// BSON thô của một document `{ key: <phần tử đã mã hoá> }`, tự dựng byte để tạo được dữ
/// liệu mà API công khai của `bson` không cho dựng (DBPointer, BSON hỏng).
fn raw_doc(elements: &[u8]) -> RawDocumentBuf {
    let len = i32::try_from(4 + elements.len() + 1).unwrap();
    let mut bytes = len.to_le_bytes().to_vec();
    bytes.extend_from_slice(elements);
    bytes.push(0);
    RawDocumentBuf::from_bytes(bytes).unwrap()
}

/// `n` document lồng nhau trong document gốc: `{"a":{"a":...{}}}` (gốc ở tầng 0, document
/// trong cùng ở tầng `n`).
fn nested_docs(n: usize) -> Document {
    let mut d = Document::new();
    for _ in 0..n {
        d = doc! { "a": d };
    }
    d
}

fn nested_arrays(n: usize) -> Document {
    let mut v = Bson::Array(vec![]);
    for _ in 1..n {
        v = Bson::Array(vec![v]);
    }
    doc! { "a": v }
}

#[test]
fn empty_document_and_empty_containers() {
    assert_eq!(render(&Document::new()), "{}");
    assert_eq!(one(Document::new()), r#"{"v":{}}"#);
    assert_eq!(one(Vec::<Bson>::new()), r#"{"v":[]}"#);
    assert_eq!(
        one(vec![Bson::Array(vec![]), doc! {}.into()]),
        r#"{"v":[[],{}]}"#
    );
}

#[test]
fn output_is_compact_without_spaces_or_newlines() {
    let s = render(&doc! { "a": 1, "b": [1, 2, { "c": "x y" }], "d": { "e": null } });
    assert_eq!(s, r#"{"a":1,"b":[1,2,{"c":"x y"}],"d":{"e":null}}"#);
}

#[test]
fn keys_keep_document_order() {
    assert_eq!(
        render(&doc! { "z": 1, "a": 2, "m": 3 }),
        r#"{"z":1,"a":2,"m":3}"#
    );
}

#[test]
fn null_and_booleans() {
    assert_eq!(one(Bson::Null), r#"{"v":null}"#);
    assert_eq!(one(true), r#"{"v":true}"#);
    assert_eq!(one(false), r#"{"v":false}"#);
}

#[test]
fn int32_and_int64_extremes_are_plain_numbers() {
    for v in [0i32, 1, -1, i32::MAX, i32::MIN] {
        assert_eq!(one(v), format!(r#"{{"v":{v}}}"#));
        one_matches_bson(v);
    }
    for v in [0i64, 3_000_000_000, -3_000_000_000, i64::MAX, i64::MIN] {
        assert_eq!(one(v), format!(r#"{{"v":{v}}}"#));
        one_matches_bson(v);
    }
}

#[test]
fn finite_doubles_use_shortest_round_trip_text() {
    let cases = [
        (0.0, "0.0"),
        (-0.0, "-0.0"),
        (1.0, "1.0"),
        (-2.5, "-2.5"),
        (0.1, "0.1"),
        (1e21, "1e21"),
        (1e-7, "1e-7"),
        (5e-324, "5e-324"),
        (f64::MAX, "1.7976931348623157e308"),
        (f64::MIN, "-1.7976931348623157e308"),
        (f64::MIN_POSITIVE, "2.2250738585072014e-308"),
        (123_456_789.125, "123456789.125"),
    ];
    for (f, text) in cases {
        assert_eq!(one(f), format!(r#"{{"v":{text}}}"#), "{f:?}");
        // Đọc lại phải ra đúng từng bit (kể cả dấu của -0.0). Dùng `str::parse` thay vì
        // `serde_json` (mặc định của nó có thể lệch 1 ULP khi đọc số thực).
        assert_eq!(text.parse::<f64>().unwrap().to_bits(), f.to_bits(), "{f:?}");
        one_matches_bson(f);
    }
    // Số cần 17 chữ số có nghĩa: chỉ kiểm chuỗi và đọc lại bằng `str::parse`, không so với
    // `bson` qua `serde_json::Value` vì `serde_json` mặc định đọc số thực có thể lệch 1 ULP.
    let f = 123_456_789.123_456_79_f64;
    assert_eq!(one(f), r#"{"v":123456789.12345679}"#);
    assert_eq!(
        "123456789.12345679".parse::<f64>().unwrap().to_bits(),
        f.to_bits()
    );
}

#[test]
fn non_finite_doubles_are_number_double_objects() {
    assert_eq!(one(f64::NAN), r#"{"v":{"$numberDouble":"NaN"}}"#);
    assert_eq!(one(f64::INFINITY), r#"{"v":{"$numberDouble":"Infinity"}}"#);
    assert_eq!(
        one(f64::NEG_INFINITY),
        r#"{"v":{"$numberDouble":"-Infinity"}}"#
    );
    one_matches_bson(f64::NAN);
    one_matches_bson(f64::INFINITY);
    one_matches_bson(f64::NEG_INFINITY);
}

/// Khác `bson` có chủ ý (ghi ở đầu file): đặc tả không có `-NaN`.
#[test]
fn negative_nan_is_written_as_plain_nan() {
    let negative_nan = f64::from_bits(f64::NAN.to_bits() | (1 << 63));
    assert!(negative_nan.is_nan() && negative_nan.is_sign_negative());
    assert_eq!(one(negative_nan), r#"{"v":{"$numberDouble":"NaN"}}"#);
}

#[test]
fn every_ascii_character_escapes_like_serde_json() {
    for c in (0u8..=0x7f).map(char::from) {
        let s = c.to_string();
        assert_eq!(
            one(s.as_str()),
            format!(r#"{{"v":{}}}"#, serde_json::to_string(&s).unwrap()),
            "{c:?}"
        );
    }
}

#[test]
fn named_escapes_and_control_characters() {
    assert_eq!(
        one("\" \\ \n \r \t \u{8} \u{c} \u{1} \u{1f}"),
        r#"{"v":"\" \\ \n \r \t \b \f \u0001 \u001f"}"#
    );
    // 0x7f và ký tự Unicode đặc biệt không bị escape.
    assert_eq!(
        one("\u{7f}\u{2028}\u{feff}"),
        "{\"v\":\"\u{7f}\u{2028}\u{feff}\"}"
    );
}

#[test]
fn unicode_and_emoji_are_kept_verbatim() {
    for s in [
        "Tiếng Việt có dấu",
        "日本語 中文 한국어",
        "😀🎉 \u{1F468}\u{200D}\u{1F469}",
        "é",
    ] {
        assert_eq!(one(s), format!("{{\"v\":\"{s}\"}}"));
        one_matches_bson(s);
    }
}

#[test]
fn escapes_at_start_end_and_back_to_back() {
    for s in [
        "\"", "\n", "\"abc", "abc\"", "a\"\"b", "\n\n\n", "x\\", "\\\"\\\"", "",
    ] {
        assert_eq!(
            one(s),
            format!(r#"{{"v":{}}}"#, serde_json::to_string(s).unwrap()),
            "{s:?}"
        );
    }
}

#[test]
fn keys_are_escaped_and_may_be_empty_or_special() {
    let mut d = Document::new();
    d.insert("", 1);
    d.insert("with \"quote\" and \\", 2);
    d.insert("new\nline", 3);
    d.insert("$dollar.dot", 4);
    d.insert("tiếng 😀", 5);
    assert_eq!(
        render(&d),
        "{\"\":1,\"with \\\"quote\\\" and \\\\\":2,\"new\\nline\":3,\"$dollar.dot\":4,\"tiếng 😀\":5}"
    );
    assert_matches_bson(d);
}

#[test]
fn object_id_is_lowercase_hex_oid() {
    let oid = ObjectId::parse_str("507F1F77BCF86CD799439011").unwrap();
    assert_eq!(one(oid), r#"{"v":{"$oid":"507f1f77bcf86cd799439011"}}"#);
    one_matches_bson(oid);
    assert_eq!(
        one(ObjectId::from_bytes([0; 12])),
        r#"{"v":{"$oid":"000000000000000000000000"}}"#
    );
    assert_eq!(
        one(ObjectId::from_bytes([0xff; 12])),
        r#"{"v":{"$oid":"ffffffffffffffffffffffff"}}"#
    );
}

#[test]
fn dates_in_1970_to_9999_are_iso_with_trimmed_fraction() {
    let cases = [
        (0i64, "1970-01-01T00:00:00Z"),
        (5, "1970-01-01T00:00:00.005Z"),
        (50, "1970-01-01T00:00:00.05Z"),
        (120, "1970-01-01T00:00:00.12Z"),
        (500, "1970-01-01T00:00:00.5Z"),
        (999, "1970-01-01T00:00:00.999Z"),
        (1000, "1970-01-01T00:00:01Z"),
        (1234, "1970-01-01T00:00:01.234Z"),
        (86_399_999, "1970-01-01T23:59:59.999Z"),
        (86_400_000, "1970-01-02T00:00:00Z"),
        (951_782_400_000, "2000-02-29T00:00:00Z"),
        (1_704_164_645_678, "2024-01-02T03:04:05.678Z"),
        (253_402_300_799_999, "9999-12-31T23:59:59.999Z"),
    ];
    for (ms, iso) in cases {
        assert_eq!(
            one(DateTime::from_millis(ms)),
            format!(r#"{{"v":{{"$date":"{iso}"}}}}"#),
            "{ms}"
        );
        one_matches_bson(DateTime::from_millis(ms));
    }
}

#[test]
fn dates_outside_1970_to_9999_are_number_long_milliseconds() {
    for ms in [
        -1i64,
        -1000,
        -62_135_596_800_000, // 0001-01-01
        253_402_300_800_000, // 10000-01-01
        i64::MIN,
        i64::MAX,
    ] {
        assert_eq!(
            one(DateTime::from_millis(ms)),
            format!(r#"{{"v":{{"$date":{{"$numberLong":"{ms}"}}}}}}"#),
            "{ms}"
        );
        one_matches_bson(DateTime::from_millis(ms));
    }
}

#[test]
fn decimal128_is_number_decimal_string() {
    for text in [
        "0",
        "-0",
        "1.5",
        "-1.50",
        "1E+6144",
        "1E-6176",
        "NaN",
        "Infinity",
        "-Infinity",
        "123456789012345678901234567890123",
    ] {
        let d: Decimal128 = text.parse().unwrap();
        let want = Bson::Decimal128(d).into_relaxed_extjson();
        assert_eq!(
            serde_json::from_str::<Value>(&one(d)).unwrap()["v"],
            want,
            "{text}"
        );
        one_matches_bson(d);
    }
    assert_eq!(
        one("1.5".parse::<Decimal128>().unwrap()),
        r#"{"v":{"$numberDecimal":"1.5"}}"#
    );
}

#[test]
fn binary_subtypes_and_base64() {
    let cases = [
        (BinarySubtype::Generic, "00"),
        (BinarySubtype::Function, "01"),
        (BinarySubtype::BinaryOld, "02"),
        (BinarySubtype::UuidOld, "03"),
        (BinarySubtype::Uuid, "04"),
        (BinarySubtype::Md5, "05"),
        (BinarySubtype::Encrypted, "06"),
        (BinarySubtype::UserDefined(0x80), "80"),
        (BinarySubtype::UserDefined(0xff), "ff"),
    ];
    for (subtype, hex) in cases {
        let b = Binary {
            subtype,
            bytes: vec![1, 2, 3, 4],
        };
        assert_eq!(
            one(b.clone()),
            format!(r#"{{"v":{{"$binary":{{"base64":"AQIDBA==","subType":"{hex}"}}}}}}"#)
        );
        one_matches_bson(b);
    }
}

#[test]
fn binary_empty_padding_and_alphabet() {
    let empty = Binary {
        subtype: BinarySubtype::Generic,
        bytes: vec![],
    };
    assert_eq!(
        one(empty.clone()),
        r#"{"v":{"$binary":{"base64":"","subType":"00"}}}"#
    );
    one_matches_bson(empty);
    // Chuẩn có `+`/`/` và đệm `=`, không dùng bảng URL-safe.
    for (bytes, b64) in [
        (vec![0xfb, 0xff], "+/8="),
        (vec![0xfb], "+w=="),
        (vec![0xfb, 0xff, 0xbf], "+/+/"),
    ] {
        let b = Binary {
            subtype: BinarySubtype::Generic,
            bytes,
        };
        assert_eq!(
            one(b.clone()),
            format!(r#"{{"v":{{"$binary":{{"base64":"{b64}","subType":"00"}}}}}}"#)
        );
        one_matches_bson(b);
    }
    // Mọi độ dài 0..=20 byte đều giống chuẩn.
    for n in 0..=20u8 {
        one_matches_bson(Binary {
            subtype: BinarySubtype::Uuid,
            bytes: (0..n).collect(),
        });
    }
}

#[test]
fn regex_flags_are_sorted_alphabetically() {
    let regex = |pattern: &str, options: &str| Regex {
        pattern: pattern.to_owned(),
        options: options.to_owned(),
    };
    assert_eq!(
        one(regex("^a.*b$", "xsmi")),
        r#"{"v":{"$regularExpression":{"pattern":"^a.*b$","options":"imsx"}}}"#
    );
    assert_eq!(
        one(regex("", "")),
        r#"{"v":{"$regularExpression":{"pattern":"","options":""}}}"#
    );
    // Pattern có ký tự cần escape.
    assert_eq!(
        one(regex("a\"\\\n", "i")),
        r#"{"v":{"$regularExpression":{"pattern":"a\"\\\n","options":"i"}}}"#
    );
    one_matches_bson(regex("^a", "xsmi"));
    one_matches_bson(regex("tiếng", "i"));
}

#[test]
fn javascript_code_with_and_without_scope() {
    assert_eq!(
        one(Bson::JavaScriptCode(
            "function() { return \"x\"; }".to_owned()
        )),
        r#"{"v":{"$code":"function() { return \"x\"; }"}}"#
    );
    let with_scope = Bson::JavaScriptCodeWithScope(JavaScriptCodeWithScope {
        code: "x + y".to_owned(),
        scope: doc! { "x": 1, "nested": { "s": "é" } },
    });
    assert_eq!(
        one(with_scope.clone()),
        r#"{"v":{"$code":"x + y","$scope":{"x":1,"nested":{"s":"é"}}}}"#
    );
    one_matches_bson(with_scope);
    one_matches_bson(Bson::JavaScriptCode("a".to_owned()));
    // Scope rỗng vẫn ghi `$scope`.
    assert_eq!(
        one(Bson::JavaScriptCodeWithScope(JavaScriptCodeWithScope {
            code: "1".to_owned(),
            scope: doc! {},
        })),
        r#"{"v":{"$code":"1","$scope":{}}}"#
    );
}

#[test]
fn timestamp_symbol_undefined_and_keys() {
    assert_eq!(
        one(Timestamp {
            time: 1_700_000_000,
            increment: 7
        }),
        r#"{"v":{"$timestamp":{"t":1700000000,"i":7}}}"#
    );
    assert_eq!(
        one(Timestamp {
            time: u32::MAX,
            increment: u32::MAX
        }),
        r#"{"v":{"$timestamp":{"t":4294967295,"i":4294967295}}}"#
    );
    one_matches_bson(Timestamp {
        time: u32::MAX,
        increment: 0,
    });
    assert_eq!(
        one(Bson::Symbol("sym \"q\"".to_owned())),
        r#"{"v":{"$symbol":"sym \"q\""}}"#
    );
    assert_eq!(one(Bson::Undefined), r#"{"v":{"$undefined":true}}"#);
    assert_eq!(one(Bson::MinKey), r#"{"v":{"$minKey":1}}"#);
    assert_eq!(one(Bson::MaxKey), r#"{"v":{"$maxKey":1}}"#);
    one_matches_bson(Bson::Symbol("s".to_owned()));
    one_matches_bson(Bson::Undefined);
    one_matches_bson(Bson::MinKey);
    one_matches_bson(Bson::MaxKey);
}

/// `$dbPointer` không dựng được từ API công khai của `bson` (trường private) nên dựng byte
/// BSON thô: type 0x0C, namespace là chuỗi, rồi 12 byte ObjectId.
#[test]
fn db_pointer_from_raw_bytes() {
    let mut e = vec![0x0c];
    e.extend_from_slice(b"p\0");
    e.extend_from_slice(&5i32.to_le_bytes());
    e.extend_from_slice(b"db.c\0");
    e.extend_from_slice(&[
        0x50, 0x7f, 0x1f, 0x77, 0xbc, 0xf8, 0x6c, 0xd7, 0x99, 0x43, 0x90, 0x11,
    ]);
    let raw = raw_doc(&e);
    let ours: Value = serde_json::from_str(&document_to_string(&raw).unwrap()).unwrap();
    assert_eq!(
        ours,
        serde_json::json!({"p": {"$dbPointer": {"$ref": "db.c", "$id": {"$oid": "507f1f77bcf86cd799439011"}}}})
    );
    // Và trùng chuẩn của `bson`.
    let want = Bson::Document(raw.to_document().unwrap()).into_relaxed_extjson();
    assert_eq!(ours, want);
}

#[test]
fn duplicate_keys_are_written_in_wire_order() {
    let mut raw = RawDocumentBuf::new();
    raw.append("a", 1);
    raw.append("b", 2);
    raw.append("a", 3);
    let s = document_to_string(&raw).unwrap();
    assert_eq!(s, r#"{"a":1,"b":2,"a":3}"#);
    // JSON hợp lệ (khoá trùng được parser chấp nhận, giá trị sau thắng).
    assert!(serde_json::from_str::<Value>(&s).is_ok());
}

#[test]
fn nested_documents_and_arrays_match_bson() {
    let d = doc! {
        "arr": [1, "two", 3.5, null, [true, [false, []]], { "k": [{ "z": {} }] }],
        "doc": { "a": { "b": { "c": { "d": [1, 2, 3] } } } },
    };
    assert_matches_bson(d);
}

#[test]
fn every_type_in_one_document_matches_bson() {
    let d = doc! {
        "double": 1.25, "string": "s", "doc": { "x": 1 }, "array": [1, 2],
        "binary": Binary { subtype: BinarySubtype::Generic, bytes: vec![0, 1, 2] },
        "undefined": Bson::Undefined,
        "oid": ObjectId::from_bytes([1; 12]),
        "bool": true, "date": DateTime::from_millis(1_700_000_000_123), "null": Bson::Null,
        "regex": Regex { pattern: "a".to_owned(), options: "ms".to_owned() },
        "code": Bson::JavaScriptCode("c".to_owned()),
        "symbol": Bson::Symbol("s".to_owned()),
        "scoped": Bson::JavaScriptCodeWithScope(JavaScriptCodeWithScope {
            code: "c".to_owned(), scope: doc! { "n": 1 },
        }),
        "int32": 7, "timestamp": Timestamp { time: 1, increment: 2 }, "int64": 8i64,
        "decimal": "9.99".parse::<Decimal128>().unwrap(),
        "min": Bson::MinKey, "max": Bson::MaxKey,
    };
    assert_matches_bson(d);
}

#[test]
fn document_nested_200_levels_is_ok_and_201_is_too_deep() {
    for (build, name) in [
        (nested_docs as fn(usize) -> Document, "documents"),
        (nested_arrays, "arrays"),
    ] {
        let ok = RawDocumentBuf::try_from(&build(200)).unwrap();
        assert!(document_to_string(&ok).is_ok(), "{name} 200");
        let deep = RawDocumentBuf::try_from(&build(201)).unwrap();
        let err = document_to_string(&deep).unwrap_err();
        assert!(matches!(err, EjsonError::TooDeep), "{name} 201: {err}");
        assert_eq!(err.to_string(), "document is nested too deeply");
    }
}

/// Dữ liệu độc lồng hàng nghìn tầng phải bị từ chối bằng lỗi, không tràn stack.
#[test]
fn hostile_nesting_depth_returns_an_error_instead_of_overflowing_the_stack() {
    let mut inner = vec![5, 0, 0, 0, 0];
    for _ in 0..2000 {
        let mut e = vec![0x03, b'a', 0];
        e.extend_from_slice(&inner);
        let len = i32::try_from(4 + e.len() + 1).unwrap();
        let mut next = len.to_le_bytes().to_vec();
        next.extend_from_slice(&e);
        next.push(0);
        inner = next;
    }
    let raw = RawDocumentBuf::from_bytes(inner).unwrap();
    assert!(matches!(document_to_string(&raw), Err(EjsonError::TooDeep)));
}

#[test]
fn malformed_bson_is_a_bson_error_without_document_data() {
    // Chuỗi khai báo dài 100 byte nhưng document chỉ có 1.
    let mut e = vec![0x02, b'a', 0];
    e.extend_from_slice(&100i32.to_le_bytes());
    let truncated = raw_doc(&e);
    // Chuỗi UTF-8 sai.
    let mut e = vec![0x02, b'a', 0];
    e.extend_from_slice(&2i32.to_le_bytes());
    e.extend_from_slice(&[0xff, 0x00]);
    let bad_utf8 = raw_doc(&e);
    // Kiểu phần tử không tồn tại.
    let unknown_type = raw_doc(&[0x7e, b'a', 0, 0, 0, 0, 0]);
    for raw in [truncated, bad_utf8, unknown_type] {
        let err = document_to_string(&raw).unwrap_err();
        assert!(matches!(err, EjsonError::Bson(_)), "{err:?}");
        assert!(err.to_string().starts_with("malformed BSON: "), "{err}");
    }
}

#[test]
fn malformed_element_after_valid_ones_is_still_an_error() {
    let mut e = vec![0x10, b'a', 0, 1, 0, 0, 0]; // a: int32 1
    e.extend_from_slice(&[0x7e, b'b', 0]);
    let raw = raw_doc(&e);
    assert!(matches!(document_to_string(&raw), Err(EjsonError::Bson(_))));
}

#[test]
fn unserializable_error_message() {
    assert_eq!(
        EjsonError::Unserializable.to_string(),
        "value cannot be written as JSON"
    );
}

#[test]
fn write_document_appends_to_the_buffer() {
    let raw = RawDocumentBuf::try_from(&doc! { "a": 1 }).unwrap();
    let mut out = String::from("prefix:");
    write_document(&mut out, &raw).unwrap();
    write_document(&mut out, &raw).unwrap();
    assert_eq!(out, r#"prefix:{"a":1}{"a":1}"#);
}

#[test]
fn large_document_round_trips() {
    let big = "é\"".repeat(100_000);
    let d = doc! { "big": big.as_str(), "n": (0..1000).collect::<Vec<i32>>() };
    let parsed: Value = serde_json::from_str(&render(&d)).unwrap();
    assert_eq!(parsed["big"].as_str().unwrap(), big);
    assert_eq!(parsed["n"].as_array().unwrap().len(), 1000);
}
