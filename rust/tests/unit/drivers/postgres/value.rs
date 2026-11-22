use super::*;
use tokio_postgres::types::Field;

/// Giải mã một ô đơn bằng chính đường của driver (`cell`), kể cả nhánh hex khi dữ liệu hỏng.
fn sc(s: Scalar, raw: &[u8]) -> String {
    cell(Decoder::Scalar(s), raw)
}

/// `write_scalar` thẳng, để thấy `BadData` thay vì chuỗi hex.
fn is_bad(s: Scalar, raw: &[u8]) -> bool {
    write_scalar(&mut String::new(), s, raw).is_err()
}

/// Dữ liệu sai thì `cell` trả hex của dữ liệu thô (có tiền tố `0x`), không panic.
fn assert_hex_fallback(s: Scalar, raw: &[u8]) {
    assert!(is_bad(s, raw), "{raw:?} lẽ ra phải sai định dạng");
    assert_eq!(sc(s, raw), hex(raw));
}

fn user_type(name: &str, kind: Kind) -> Type {
    Type::new(name.to_owned(), 99_999, kind, "public".to_owned())
}

fn numeric(weight: i16, sign: u16, dscale: u16, digits: &[u16]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&u16::try_from(digits.len()).unwrap().to_be_bytes());
    v.extend_from_slice(&weight.to_be_bytes());
    v.extend_from_slice(&sign.to_be_bytes());
    v.extend_from_slice(&dscale.to_be_bytes());
    for d in digits {
        v.extend_from_slice(&d.to_be_bytes());
    }
    v
}

fn num(weight: i16, dscale: u16, digits: &[u16]) -> String {
    sc(Scalar::Numeric, &numeric(weight, 0, dscale, digits))
}

fn interval(micros: i64, days: i32, months: i32) -> Vec<u8> {
    let mut v = micros.to_be_bytes().to_vec();
    v.extend_from_slice(&days.to_be_bytes());
    v.extend_from_slice(&months.to_be_bytes());
    v
}

fn iv(micros: i64, days: i32, months: i32) -> String {
    sc(Scalar::Interval, &interval(micros, days, months))
}

/// Micro giây của `h:m:s`.
fn hms(h: i64, m: i64, s: i64) -> i64 {
    ((h * 60 + m) * 60 + s) * 1_000_000
}

fn timetz(micros: i64, zone_west_secs: i32) -> Vec<u8> {
    let mut v = micros.to_be_bytes().to_vec();
    v.extend_from_slice(&zone_west_secs.to_be_bytes());
    v
}

/// `inet`/`cidr` nhị phân: họ địa chỉ (2 = IPv4, 3 = IPv6), số bit mạng, cờ cidr, địa chỉ.
fn inet_raw(family: u8, bits: u8, is_cidr: bool, addr: &[u8]) -> Vec<u8> {
    let mut v = vec![
        family,
        bits,
        u8::from(is_cidr),
        u8::try_from(addr.len()).unwrap(),
    ];
    v.extend_from_slice(addr);
    v
}

fn v6(words: [u16; 8]) -> [u8; 16] {
    let mut out = [0u8; 16];
    for (i, w) in words.iter().enumerate() {
        out[i * 2..i * 2 + 2].copy_from_slice(&w.to_be_bytes());
    }
    out
}

/// IPv6 `inet` không mặt nạ (128 bit) -> chuỗi.
fn ip6(words: [u16; 8]) -> String {
    sc(Scalar::Inet, &inet_raw(3, 128, false, &v6(words)))
}

fn bits_raw(nbits: i32, bytes: &[u8]) -> Vec<u8> {
    let mut v = nbits.to_be_bytes().to_vec();
    v.extend_from_slice(bytes);
    v
}

// ---- decoder_for: danh sách cho phép ----

fn kind_of(ty: &Type) -> &'static str {
    match decoder_for(ty) {
        None => "none",
        Some(Decoder::Scalar(_)) => "scalar",
        Some(Decoder::Array(_)) => "array",
    }
}

#[test]
fn every_allowed_builtin_type_reads_binary() {
    let allowed = [
        Type::BOOL,
        Type::INT2,
        Type::INT4,
        Type::INT8,
        Type::OID,
        Type::FLOAT4,
        Type::FLOAT8,
        Type::NUMERIC,
        Type::TEXT,
        Type::VARCHAR,
        Type::BPCHAR,
        Type::NAME,
        Type::XML,
        Type::CHAR,
        Type::JSON,
        Type::JSONB,
        Type::BYTEA,
        Type::DATE,
        Type::TIME,
        Type::TIMETZ,
        Type::TIMESTAMP,
        Type::TIMESTAMPTZ,
        Type::INTERVAL,
        Type::UUID,
        Type::INET,
        Type::CIDR,
        Type::MACADDR,
        Type::MACADDR8,
        Type::BIT,
        Type::VARBIT,
    ];
    for ty in allowed {
        assert_eq!(kind_of(&ty), "scalar", "{ty}");
    }
}

#[test]
fn types_outside_the_allow_list_force_simple_query() {
    let outside = [
        Type::MONEY,
        Type::POINT,
        Type::LINE,
        Type::BOX,
        Type::CIRCLE,
        Type::TS_VECTOR,
        Type::TSQUERY,
        Type::REGCLASS,
        Type::REGPROC,
        Type::INT4_RANGE,
        Type::TSTZ_RANGE,
        Type::RECORD,
        Type::VOID,
        Type::JSONPATH,
        Type::PG_LSN,
        Type::TXID_SNAPSHOT,
        Type::XID,
        Type::TID,
    ];
    for ty in outside {
        assert_eq!(kind_of(&ty), "none", "{ty}");
    }
}

#[test]
fn arrays_of_allowed_types_are_array_decoders_and_others_are_not() {
    for ty in [
        Type::INT4_ARRAY,
        Type::TEXT_ARRAY,
        Type::NUMERIC_ARRAY,
        Type::TIMESTAMPTZ_ARRAY,
        Type::INTERVAL_ARRAY,
        Type::BYTEA_ARRAY,
        Type::UUID_ARRAY,
        Type::INET_ARRAY,
        Type::VARBIT_ARRAY,
        Type::JSONB_ARRAY,
    ] {
        assert_eq!(kind_of(&ty), "array", "{ty}");
    }
    for ty in [
        Type::MONEY_ARRAY,
        Type::POINT_ARRAY,
        Type::INT4_RANGE_ARRAY,
        Type::TS_VECTOR_ARRAY,
        Type::RECORD_ARRAY,
    ] {
        assert_eq!(kind_of(&ty), "none", "{ty}");
    }
}

#[test]
fn array_decoder_carries_the_element_scalar() {
    assert!(matches!(
        decoder_for(&Type::INT4_ARRAY),
        Some(Decoder::Array(Scalar::Int4))
    ));
    assert!(matches!(
        decoder_for(&Type::TEXT_ARRAY),
        Some(Decoder::Array(Scalar::Text))
    ));
}

#[test]
fn enum_is_text_and_array_of_enum_is_text_array() {
    let mood = user_type("mood", Kind::Enum(vec!["sad".into(), "ok".into()]));
    assert!(matches!(
        decoder_for(&mood),
        Some(Decoder::Scalar(Scalar::Text))
    ));
    let mood_array = user_type("_mood", Kind::Array(mood));
    assert!(matches!(
        decoder_for(&mood_array),
        Some(Decoder::Array(Scalar::Text))
    ));
}

#[test]
fn domain_follows_its_base_type() {
    let posint = user_type("posint", Kind::Domain(Type::INT4));
    assert!(matches!(
        decoder_for(&posint),
        Some(Decoder::Scalar(Scalar::Int4))
    ));
    // Domain xếp chồng domain vẫn về kiểu gốc.
    let nested = user_type("posint2", Kind::Domain(posint.clone()));
    assert!(matches!(
        decoder_for(&nested),
        Some(Decoder::Scalar(Scalar::Int4))
    ));
    // Domain trên mảng là mảng; mảng của domain là mảng của kiểu gốc.
    let int_list = user_type("int_list", Kind::Domain(Type::INT4_ARRAY));
    assert!(matches!(
        decoder_for(&int_list),
        Some(Decoder::Array(Scalar::Int4))
    ));
    let posint_array = user_type("_posint", Kind::Array(posint));
    assert!(matches!(
        decoder_for(&posint_array),
        Some(Decoder::Array(Scalar::Int4))
    ));
    // Gốc ngoài danh sách thì cả domain ngoài danh sách.
    let cash = user_type("cash", Kind::Domain(Type::MONEY));
    assert_eq!(kind_of(&cash), "none");
    let cash_array = user_type("_cash", Kind::Array(cash));
    assert_eq!(kind_of(&cash_array), "none");
}

#[test]
fn composite_range_and_unknown_extension_types_are_not_allowed() {
    let composite = user_type(
        "pt",
        Kind::Composite(vec![Field::new("x".to_owned(), Type::INT4)]),
    );
    assert_eq!(kind_of(&composite), "none");
    assert_eq!(kind_of(&user_type("_pt", Kind::Array(composite))), "none");
    assert_eq!(
        kind_of(&user_type("myrange", Kind::Range(Type::INT4))),
        "none"
    );
    // Kiểu extension lạ (ví dụ PostGIS `geometry`), kể cả tên gần giống citext.
    assert_eq!(kind_of(&user_type("geometry", Kind::Simple)), "none");
    assert_eq!(kind_of(&user_type("citext2", Kind::Simple)), "none");
    assert_eq!(kind_of(&user_type("CITEXT", Kind::Simple)), "none");
}

#[test]
fn citext_is_recognised_by_name_and_reads_as_text() {
    let citext = user_type("citext", Kind::Simple);
    assert!(matches!(
        decoder_for(&citext),
        Some(Decoder::Scalar(Scalar::Text))
    ));
    let citext_array = user_type("_citext", Kind::Array(citext));
    assert!(matches!(
        decoder_for(&citext_array),
        Some(Decoder::Array(Scalar::Text))
    ));
}

// ---- BadData ----

#[test]
fn bad_data_converts_from_protocol_and_format_errors() {
    fn from_boxed() -> Decoded {
        let e: Box<dyn std::error::Error + Sync + Send> = "bad".into();
        Err::<(), _>(e)?;
        Ok(())
    }
    fn from_fmt() -> Decoded {
        Err::<(), _>(fmt::Error)?;
        Ok(())
    }
    assert!(from_boxed().is_err());
    assert!(from_fmt().is_err());
}

// ---- số nguyên, bool, oid ----

#[test]
fn bool_is_t_or_f() {
    assert_eq!(sc(Scalar::Bool, &[1]), "t");
    assert_eq!(sc(Scalar::Bool, &[0]), "f");
    assert_hex_fallback(Scalar::Bool, &[]);
    assert_hex_fallback(Scalar::Bool, &[1, 0]);
}

#[test]
fn integers_print_at_their_extremes() {
    assert_eq!(sc(Scalar::Int2, &i16::MIN.to_be_bytes()), "-32768");
    assert_eq!(sc(Scalar::Int2, &i16::MAX.to_be_bytes()), "32767");
    assert_eq!(sc(Scalar::Int4, &i32::MIN.to_be_bytes()), "-2147483648");
    assert_eq!(sc(Scalar::Int4, &i32::MAX.to_be_bytes()), "2147483647");
    assert_eq!(
        sc(Scalar::Int8, &i64::MIN.to_be_bytes()),
        "-9223372036854775808"
    );
    assert_eq!(
        sc(Scalar::Int8, &i64::MAX.to_be_bytes()),
        "9223372036854775807"
    );
    assert_eq!(sc(Scalar::Oid, &u32::MAX.to_be_bytes()), "4294967295");
    assert_eq!(sc(Scalar::Int4, &0i32.to_be_bytes()), "0");
}

#[test]
fn integers_with_the_wrong_width_fall_back_to_hex() {
    assert_hex_fallback(Scalar::Int2, &[1, 2, 3, 4]);
    assert_hex_fallback(Scalar::Int4, &[1, 2]);
    assert_hex_fallback(Scalar::Int8, &[1, 2, 3, 4]);
    assert_hex_fallback(Scalar::Oid, &[1]);
    assert_hex_fallback(Scalar::Int4, &[]);
}

// ---- float ----

fn f8(v: f64) -> String {
    sc(Scalar::Float8, &v.to_be_bytes())
}

fn f4(v: f32) -> String {
    sc(Scalar::Float4, &v.to_be_bytes())
}

#[test]
fn float8_special_values_and_negative_zero() {
    assert_eq!(f8(f64::NAN), "NaN");
    assert_eq!(f8(f64::INFINITY), "Infinity");
    assert_eq!(f8(f64::NEG_INFINITY), "-Infinity");
    assert_eq!(f8(0.0), "0");
    assert_eq!(f8(-0.0), "-0");
    // NaN mang bit dấu âm vẫn là NaN (không thành "-NaN").
    assert_eq!(f8(-f64::NAN), "NaN");
}

#[test]
fn float8_uses_plain_notation_for_exponents_minus4_to_14() {
    for (v, want) in [
        (100.0, "100"),
        (1.0, "1"),
        (0.1, "0.1"),
        (1e14, "100000000000000"),
        (1.5e14, "150000000000000"),
        (123_456_789_012_345.0, "123456789012345"),
        (99_999_999_999_999.9, "99999999999999.9"),
        (1e-4, "0.0001"),
        (9.99e-4, "0.000999"),
        (1.5e-4, "0.00015"),
        (-1e-4, "-0.0001"),
        (-1e14, "-100000000000000"),
        (1.0 / 3.0, "0.3333333333333333"),
        (12345.678, "12345.678"),
    ] {
        assert_eq!(f8(v), want, "{v:e}");
    }
}

#[test]
fn float8_switches_to_scientific_outside_the_threshold() {
    for (v, want) in [
        (1e15, "1e+15"),
        (1.5e15, "1.5e+15"),
        (-1e15, "-1e+15"),
        (1e16, "1e+16"),
        (1e-5, "1e-05"),
        (-1e-5, "-1e-05"),
        (9.99e-5, "9.99e-05"),
        (1.2345678e-7, "1.2345678e-07"),
        (1e100, "1e+100"),
        (1.797_693_134_862_315_7e308, "1.7976931348623157e+308"),
        (5e-324, "5e-324"),
        (2.225_073_858_507_201_4e-308, "2.2250738585072014e-308"),
    ] {
        assert_eq!(f8(v), want, "{v:e}");
    }
}

#[test]
fn float4_uses_plain_notation_for_exponents_minus4_to_5() {
    for (v, want) in [
        (100_000.0, "100000"),
        (150_000.0, "150000"),
        (123_456.79, "123456.79"),
        (0.1, "0.1"),
        (1e-4, "0.0001"),
        (9.99e-4, "0.000999"),
        (-1e-4, "-0.0001"),
        (1.0, "1"),
    ] {
        assert_eq!(f4(v), want, "{v:e}");
    }
}

#[test]
fn float4_switches_to_scientific_outside_the_threshold() {
    for (v, want) in [
        (1e6, "1e+06"),
        (1.5e6, "1.5e+06"),
        (-1e6, "-1e+06"),
        (1e15, "1e+15"),
        (1e-5, "1e-05"),
        (-1.5e-5, "-1.5e-05"),
        (3.402_823_5e38, "3.4028235e+38"),
        (1e-45, "1e-45"),
        (1.175_494_4e-38, "1.1754944e-38"),
    ] {
        assert_eq!(f4(v), want, "{v:e}");
    }
    assert_eq!(f4(f32::NAN), "NaN");
    assert_eq!(f4(f32::INFINITY), "Infinity");
    assert_eq!(f4(f32::NEG_INFINITY), "-Infinity");
    assert_eq!(f4(-0.0), "-0");
    assert_eq!(f4(0.0), "0");
}

#[test]
fn float_text_reads_back_to_the_same_number() {
    // Giới hạn đã biết: khi hai thuật toán "chữ số ngắn nhất" khác nhau ở các số hoà (ví dụ
    // 1e23) PostgreSQL in 9.999999999999999e+22 còn ta in 1e+23; hai chuỗi đọc lại đúng cùng
    // một số nhị phân nên không mất dữ liệu.
    assert_eq!(f8(1e23), "1e+23");
    assert_eq!("1e+23".parse::<f64>().unwrap().to_bits(), 1e23f64.to_bits());
    assert_eq!(
        "9.999999999999999e+22".parse::<f64>().unwrap().to_bits(),
        1e23f64.to_bits()
    );
    for v in [0.1, 1.0 / 3.0, 123.456, 2.5e-9, 7.0e200, f64::MIN_POSITIVE] {
        let text = f8(v);
        assert_eq!(
            text.parse::<f64>().unwrap().to_bits(),
            v.to_bits(),
            "{text}"
        );
    }
    for v in [0.1f32, 1.0 / 3.0, 123.456, 2.5e-9, 7.0e30] {
        let text = f4(v);
        assert_eq!(
            text.parse::<f32>().unwrap().to_bits(),
            v.to_bits(),
            "{text}"
        );
    }
}

#[test]
fn floats_with_the_wrong_width_fall_back_to_hex() {
    assert_hex_fallback(Scalar::Float8, &[0; 4]);
    assert_hex_fallback(Scalar::Float4, &[0; 8]);
}

#[test]
fn write_shortest_rejects_malformed_scientific_text() {
    let mut out = String::new();
    // Không có `e`.
    assert!(write_shortest(&mut out, b"123", false, 14).is_err());
    // Số mũ không phải số.
    assert!(write_shortest(&mut out, b"1ex", false, 14).is_err());
    assert!(write_shortest(&mut out, b"1e", false, 14).is_err());
    // Quá nhiều chữ số trong phần định trị (bộ đệm 24).
    let long = format!("{}e0", "1".repeat(25));
    assert!(write_shortest(&mut out, long.as_bytes(), false, 14).is_err());
    // Đúng 24 chữ số thì còn nhận.
    let full = format!("{}e0", "1".repeat(24));
    out.clear();
    assert!(write_shortest(&mut out, full.as_bytes(), false, 14).is_ok());
}

#[test]
fn stack_buffer_refuses_to_overflow() {
    let mut s = Stack::new();
    assert!(s.write_str(&"x".repeat(40)).is_ok());
    assert_eq!(s.bytes().len(), 40);
    assert!(s.write_str("y").is_err());
    // Ghi quá cỡ trong một lần cũng lỗi, không panic.
    assert!(Stack::new().write_str(&"x".repeat(41)).is_err());
}

// ---- numeric ----

#[test]
fn numeric_zero_and_scale() {
    assert_eq!(num(0, 0, &[]), "0");
    assert_eq!(num(0, 2, &[]), "0.00");
    assert_eq!(num(0, 10, &[]), "0.0000000000");
}

#[test]
fn numeric_integer_and_fraction_groups() {
    assert_eq!(num(1, 3, &[1, 2345, 6780]), "12345.678");
    assert_eq!(num(1, 0, &[1]), "10000");
    assert_eq!(num(0, 0, &[7]), "7");
    assert_eq!(num(0, 2, &[1, 5000]), "1.50");
    // `dscale` lớn hơn số chữ số đang lưu thì đệm số 0 tới đủ.
    assert_eq!(num(0, 6, &[1, 5000]), "1.500000");
    // `dscale` không chia hết cho 4: nhóm cuối bị cắt.
    assert_eq!(num(0, 5, &[3, 1415, 9265]), "3.14159");
    assert_eq!(num(0, 1, &[3, 1415]), "3.1");
    assert_eq!(num(2, 0, &[1, 0, 5]), "100000005");
}

#[test]
fn numeric_below_one_and_negative() {
    assert_eq!(num(-1, 4, &[1]), "0.0001");
    assert_eq!(num(-1, 2, &[5000]), "0.50");
    // 1e-30: nhóm đầu nằm ở trọng số -8, 29 số 0 rồi tới 1.
    assert_eq!(num(-8, 30, &[100]), format!("0.{}1", "0".repeat(29)));
    let neg = numeric(1, 0x4000, 3, &[1, 2345, 6780]);
    assert_eq!(sc(Scalar::Numeric, &neg), "-12345.678");
    let neg_half = numeric(-1, 0x4000, 2, &[5000]);
    assert_eq!(sc(Scalar::Numeric, &neg_half), "-0.50");
}

#[test]
fn numeric_very_large_and_very_long() {
    assert_eq!(num(25, 0, &[1]), format!("1{}", "0".repeat(100)));
    assert_eq!(
        num(
            7,
            9,
            &[
                12, 3456, 7890, 1234, 5678, 9012, 3456, 7890, 1234, 5678, 9000
            ]
        ),
        "123456789012345678901234567890.123456789"
    );
    // 1000 chữ số 9 (250 nhóm 9999).
    let digits = vec![9999u16; 250];
    assert_eq!(num(249, 0, &digits), "9".repeat(1000));
    // Phần thập phân dài 1000 chữ số.
    let frac = num(-1, 1000, &digits);
    assert_eq!(frac.len(), 2 + 1000);
    assert!(frac.starts_with("0.9999"));
}

#[test]
fn numeric_nan_and_infinities() {
    assert_eq!(sc(Scalar::Numeric, &numeric(0, 0xC000, 0, &[])), "NaN");
    assert_eq!(sc(Scalar::Numeric, &numeric(0, 0xD000, 0, &[])), "Infinity");
    assert_eq!(
        sc(Scalar::Numeric, &numeric(0, 0xF000, 0, &[])),
        "-Infinity"
    );
}

#[test]
fn numeric_malformed_falls_back_to_hex() {
    // Ngắn hơn phần đầu 8 byte.
    assert_hex_fallback(Scalar::Numeric, &[0, 0, 0, 0]);
    assert_hex_fallback(Scalar::Numeric, &[]);
    // Dấu lạ.
    assert_hex_fallback(Scalar::Numeric, &numeric(0, 0x1234, 0, &[]));
    // Số nhóm không khớp phần thân (khai 2 nhóm, có 1).
    let mut short = numeric(0, 0, 0, &[1]);
    short[1] = 2;
    assert_hex_fallback(Scalar::Numeric, &short);
    // Thừa byte.
    let mut long = numeric(0, 0, 0, &[1]);
    long.push(0);
    assert_hex_fallback(Scalar::Numeric, &long);
}

// ---- chuỗi, json, "char" ----

#[test]
fn text_and_json_pass_through_and_reject_invalid_utf8() {
    assert_eq!(sc(Scalar::Text, "héllo ✓ 😀".as_bytes()), "héllo ✓ 😀");
    assert_eq!(sc(Scalar::Text, b""), "");
    assert_eq!(
        sc(Scalar::Json, br#"{"a":1,  "b":[]}"#),
        r#"{"a":1,  "b":[]}"#
    );
    assert_hex_fallback(Scalar::Text, &[0x61, 0xff]);
    assert_hex_fallback(Scalar::Json, &[0xc3]);
}

#[test]
fn jsonb_drops_the_version_byte() {
    let mut raw = vec![1u8];
    raw.extend_from_slice(br#"{"a": 1}"#);
    assert_eq!(sc(Scalar::Jsonb, &raw), r#"{"a": 1}"#);
    assert_eq!(sc(Scalar::Jsonb, &[1]), "");
}

#[test]
fn jsonb_with_wrong_version_or_text_falls_back_to_hex() {
    assert_hex_fallback(Scalar::Jsonb, &[]);
    assert_hex_fallback(Scalar::Jsonb, &[2, b'{', b'}']);
    assert_hex_fallback(Scalar::Jsonb, &[0, b'1']);
    assert_hex_fallback(Scalar::Jsonb, &[1, 0xff]);
}

#[test]
fn single_byte_char_type() {
    assert_eq!(sc(Scalar::Char, b"x"), "x");
    assert_eq!(sc(Scalar::Char, &[0]), "");
    assert_eq!(sc(Scalar::Char, b"~"), "~");
    // Q4: byte >= 128 không phải UTF-8 hợp lệ khi đứng một mình, in `\ooo` bát phân như server.
    assert_eq!(sc(Scalar::Char, &[0x80]), r"\200");
    assert_eq!(sc(Scalar::Char, &[0xff]), r"\377");
    assert_eq!(sc(Scalar::Char, &[0xe9]), r"\351");
    assert_eq!(sc(Scalar::Char, &[0x7f]), "\x7f");
    assert_hex_fallback(Scalar::Char, &[]);
    assert_hex_fallback(Scalar::Char, b"ab");
}

// ---- bytea, uuid, mac ----

#[test]
fn bytea_is_backslash_x_hex() {
    assert_eq!(sc(Scalar::Bytea, &[]), "\\x");
    assert_eq!(sc(Scalar::Bytea, &[0x00, 0xff, 0x10]), "\\x00ff10");
    assert_eq!(sc(Scalar::Bytea, &[0xde, 0xad, 0xbe, 0xef]), "\\xdeadbeef");
    let big = vec![0xabu8; 100_000];
    let text = sc(Scalar::Bytea, &big);
    assert_eq!(text.len(), 2 + 200_000);
    assert!(text.starts_with("\\xabab") && text.ends_with("abab"));
}

#[test]
fn uuid_is_8_4_4_4_12() {
    let raw = [
        0xa0, 0xee, 0xbc, 0x99, 0x9c, 0x0b, 0x4e, 0xf8, 0xbb, 0x6d, 0x6b, 0xb9, 0xbd, 0x38, 0x0a,
        0x11,
    ];
    assert_eq!(
        sc(Scalar::Uuid, &raw),
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    );
    assert_eq!(
        sc(Scalar::Uuid, &[0; 16]),
        "00000000-0000-0000-0000-000000000000"
    );
    assert_hex_fallback(Scalar::Uuid, &[0; 15]);
    assert_hex_fallback(Scalar::Uuid, &[0; 17]);
}

#[test]
fn macaddr_and_macaddr8() {
    assert_eq!(
        sc(Scalar::MacAddr, &[0x08, 0x00, 0x2b, 0x01, 0x02, 0x03]),
        "08:00:2b:01:02:03"
    );
    assert_eq!(
        sc(
            Scalar::MacAddr8,
            &[0x08, 0x00, 0x2b, 0x01, 0x02, 0x03, 0x04, 0x05]
        ),
        "08:00:2b:01:02:03:04:05"
    );
    assert_hex_fallback(Scalar::MacAddr, &[0; 8]);
    assert_hex_fallback(Scalar::MacAddr, &[0; 5]);
    assert_hex_fallback(Scalar::MacAddr8, &[0; 6]);
    assert_hex_fallback(Scalar::MacAddr8, &[]);
}

// ---- bit / varbit ----

#[test]
fn bit_strings() {
    assert_eq!(sc(Scalar::Bit, &bits_raw(4, &[0b1010_0000])), "1010");
    assert_eq!(sc(Scalar::Bit, &bits_raw(3, &[0b1010_0000])), "101");
    assert_eq!(sc(Scalar::Bit, &bits_raw(1, &[0b1000_0000])), "1");
    assert_eq!(sc(Scalar::Bit, &bits_raw(0, &[])), "");
    // 19 bit trải trên 3 byte.
    assert_eq!(
        sc(
            Scalar::Bit,
            &bits_raw(19, &[0b1010_1010, 0b1010_1010, 0b1010_0000])
        ),
        "1010101010101010101"
    );
    assert_eq!(sc(Scalar::Bit, &bits_raw(8, &[0xff])), "11111111");
    assert_eq!(sc(Scalar::Bit, &bits_raw(8, &[0x00])), "00000000");
}

#[test]
fn bit_strings_with_missing_bytes_fall_back_to_hex() {
    // Khai 16 bit nhưng chỉ có 1 byte dữ liệu.
    assert_hex_fallback(Scalar::Bit, &bits_raw(16, &[0xff]));
    assert_hex_fallback(Scalar::Bit, &[0, 0]);
    assert_hex_fallback(Scalar::Bit, &bits_raw(-1, &[]));
}

// ---- ngày giờ ----

#[test]
fn date_values() {
    let date = |d: i32| sc(Scalar::Date, &d.to_be_bytes());
    assert_eq!(date(0), "2000-01-01");
    assert_eq!(date(-1), "1999-12-31");
    assert_eq!(date(366), "2001-01-01");
    // 2000 là năm nhuận: ngày thứ 60 là 2000-03-01.
    assert_eq!(date(60), "2000-03-01");
    assert_eq!(date(7306), "2020-01-02");
    assert_eq!(date(i32::MAX), "infinity");
    assert_eq!(date(i32::MIN), "-infinity");
    assert_hex_fallback(Scalar::Date, &[0, 0, 0]);
}

#[test]
fn date_bounds_and_before_common_era() {
    let date = |d: i32| sc(Scalar::Date, &d.to_be_bytes());
    // Ngày nhỏ nhất của PostgreSQL (Julian day 0) và 0001-12-31 TCN (liền trước 0001-01-01).
    assert_eq!(date(-2_451_545), "4714-11-24 BC");
    assert_eq!(date(-730_120), "0001-12-31 BC");
    assert_eq!(date(-730_119), "0001-01-01");
    // Ngày lớn nhất của PostgreSQL.
    assert_eq!(date(2_145_031_948), "5874897-12-31");
}

#[test]
fn time_values() {
    let time = |us: i64| sc(Scalar::Time, &us.to_be_bytes());
    assert_eq!(time(0), "00:00:00");
    assert_eq!(time(hms(12, 34, 56) + 500_000), "12:34:56.5");
    assert_eq!(time(86_399_999_999), "23:59:59.999999");
    assert_eq!(time(86_400_000_000), "24:00:00");
    assert_eq!(time(1), "00:00:00.000001");
    assert_eq!(time(hms(1, 2, 3) + 120_000), "01:02:03.12");
    assert_hex_fallback(Scalar::Time, &[0; 4]);
}

#[test]
fn timetz_zone_sign_follows_postgres() {
    let tz = |zone: i32| sc(Scalar::TimeTz, &timetz(hms(12, 34, 56), zone));
    // Múi giờ lưu theo giây về phía TÂY: +05:30 là -19800.
    assert_eq!(tz(-(5 * 3600 + 1800)), "12:34:56+05:30");
    assert_eq!(tz(8 * 3600), "12:34:56-08");
    assert_eq!(tz(0), "12:34:56+00");
    assert_eq!(tz(-7 * 3600), "12:34:56+07");
    assert_eq!(tz(12 * 3600 + 1800), "12:34:56-12:30");
    assert_eq!(tz(-(5 * 3600 + 1800 + 15)), "12:34:56+05:30:15");
    // Có giây nhưng phút bằng 0 vẫn in cả phút.
    assert_eq!(tz(-(3 * 3600 + 7)), "12:34:56+03:00:07");
    assert_eq!(
        sc(
            Scalar::TimeTz,
            &timetz(hms(12, 34, 56) + 789_000, -(5 * 3600 + 1800 + 15))
        ),
        "12:34:56.789+05:30:15"
    );
    assert_eq!(
        sc(Scalar::TimeTz, &timetz(0, 12 * 3600 + 1800)),
        "00:00:00-12:30"
    );
    assert_eq!(
        sc(Scalar::TimeTz, &timetz(86_400_000_000, 0)),
        "24:00:00+00"
    );
}

#[test]
fn timetz_wrong_length_falls_back_to_hex() {
    assert_hex_fallback(Scalar::TimeTz, &[0; 11]);
    assert_hex_fallback(Scalar::TimeTz, &[0; 7]);
    assert_hex_fallback(Scalar::TimeTz, &[0; 13]);
    assert_hex_fallback(Scalar::TimeTz, &[]);
}

fn ts(us: i64) -> String {
    sc(Scalar::Timestamp, &us.to_be_bytes())
}

fn tstz(us: i64) -> String {
    sc(Scalar::TimestampTz, &us.to_be_bytes())
}

const DAY: i64 = 86_400_000_000;

#[test]
fn timestamp_values_around_the_epoch() {
    assert_eq!(ts(0), "2000-01-01 00:00:00");
    assert_eq!(ts(-1), "1999-12-31 23:59:59.999999");
    assert_eq!(ts(-500_000), "1999-12-31 23:59:59.5");
    assert_eq!(
        ts(7306 * DAY + hms(3, 4, 5) + 678_000),
        "2020-01-02 03:04:05.678"
    );
    assert_eq!(ts(7306 * DAY + hms(3, 4, 5)), "2020-01-02 03:04:05");
    // 1969-12-31 23:59:59.5 (trước mốc unix, sau mốc PostgreSQL).
    assert_eq!(ts(-10_957 * DAY - 500_000), "1969-12-31 23:59:59.5");
    assert_hex_fallback(Scalar::Timestamp, &[0; 4]);
    assert_hex_fallback(Scalar::TimestampTz, &[0; 9]);
}

#[test]
fn timestamp_infinity() {
    assert_eq!(ts(i64::MAX), "infinity");
    assert_eq!(ts(i64::MIN), "-infinity");
    // `timestamptz` vô cực không có hậu tố múi giờ.
    assert_eq!(tstz(i64::MAX), "infinity");
    assert_eq!(tstz(i64::MIN), "-infinity");
}

#[test]
fn timestamp_before_common_era_puts_bc_last() {
    assert_eq!(ts(-2_451_545 * DAY), "4714-11-24 00:00:00 BC");
    assert_eq!(ts(-730_120 * DAY), "0001-12-31 00:00:00 BC");
    // ` BC` đứng sau cả hậu tố múi giờ.
    assert_eq!(tstz(-2_451_545 * DAY), "4714-11-24 00:00:00+00 BC");
    assert_eq!(tstz(-730_120 * DAY + 1), "0001-12-31 00:00:00.000001+00 BC");
}

#[test]
fn timestamptz_is_always_utc() {
    assert_eq!(tstz(0), "2000-01-01 00:00:00+00");
    assert_eq!(tstz(-1), "1999-12-31 23:59:59.999999+00");
    assert_eq!(
        tstz(7306 * DAY + hms(3, 4, 5) + 678_000),
        "2020-01-02 03:04:05.678+00"
    );
}

#[test]
fn timestamp_at_the_ends_of_the_i64_range_does_not_overflow() {
    // Cộng mốc 2000 vào micro giây sẽ tràn ở cuối miền giá trị, nên `write_timestamp` tách
    // ngày/giờ trước rồi mới cộng vào số ngày.
    let max = ts(i64::MAX - 1);
    assert!(max.starts_with("29427"), "{max}");
    assert!(max.ends_with(" 04:00:54.775806"), "{max}");
    let min = ts(i64::MIN + 1);
    assert!(min.ends_with(" BC"), "{min}");
    let max_tz = tstz(i64::MAX - 1);
    assert!(max_tz.ends_with(" 04:00:54.775806+00"), "{max_tz}");
    assert!(tstz(i64::MIN + 1).ends_with("+00 BC"));
}

// ---- interval ----

#[test]
fn interval_single_parts() {
    assert_eq!(iv(0, 1, 0), "1 day");
    assert_eq!(iv(0, -1, 0), "-1 days");
    assert_eq!(iv(0, 2, 0), "2 days");
    assert_eq!(iv(0, 0, 1), "1 mon");
    assert_eq!(iv(0, 0, 2), "2 mons");
    assert_eq!(iv(0, 0, 12), "1 year");
    assert_eq!(iv(0, 0, 24), "2 years");
    assert_eq!(iv(0, 0, 13), "1 year 1 mon");
    assert_eq!(iv(0, 0, -13), "-1 years -1 mons");
    assert_eq!(iv(0, 0, 0), "00:00:00");
}

#[test]
fn interval_time_part() {
    assert_eq!(iv(hms(100, 0, 0), 0, 0), "100:00:00");
    assert_eq!(iv(-hms(100, 0, 0), 0, 0), "-100:00:00");
    assert_eq!(iv(1, 0, 0), "00:00:00.000001");
    assert_eq!(iv(-1, 0, 0), "-00:00:00.000001");
    assert_eq!(iv(500_000, 0, 0), "00:00:00.5");
    assert_eq!(iv(hms(1, 2, 3) + 450_000, 0, 0), "01:02:03.45");
}

#[test]
fn interval_with_mixed_signs() {
    assert_eq!(
        iv(hms(4, 5, 6) + 789_000, 3, 14),
        "1 year 2 mons 3 days 04:05:06.789"
    );
    assert_eq!(
        iv(-hms(4, 5, 6), -3, -14),
        "-1 years -2 mons -3 days -04:05:06"
    );
    // Dấu `+` chỉ hiện khi phần đứng trước âm.
    assert_eq!(iv(hms(3, 0, 0), -2, 12), "1 year -2 days +03:00:00");
    assert_eq!(iv(-hms(3, 0, 0), 2, -12), "-1 years +2 days -03:00:00");
    assert_eq!(iv(0, -1, 1), "1 mon -1 days");
    assert_eq!(iv(0, 1, -1), "-1 mons +1 day");
    assert_eq!(iv(hms(1, 0, 0), 0, -1), "-1 mons +01:00:00");
    assert_eq!(iv(hms(1, 0, 0), 1, 1), "1 mon 1 day 01:00:00");
}

#[test]
fn interval_at_the_extremes() {
    assert_eq!(iv(0, i32::MAX, 0), "2147483647 days");
    assert_eq!(iv(0, i32::MIN, 0), "-2147483648 days");
    assert_eq!(iv(0, 0, 178_000_000 * 12), "178000000 years");
    assert_eq!(iv(i64::MAX, 0, 0), "2562047788:00:54.775807");
    assert_eq!(iv(i64::MIN, 0, 0), "-2562047788:00:54.775808");
    assert_eq!(iv(0, 0, i32::MAX), "178956970 years 7 mons");
    assert_eq!(iv(0, 0, i32::MIN), "-178956970 years -8 mons");
}

#[test]
fn interval_infinity_is_the_all_max_or_all_min_triple() {
    // B2: PostgreSQL 17, 16 byte dựng tay.
    let mut inf = i64::MAX.to_be_bytes().to_vec();
    inf.extend_from_slice(&i32::MAX.to_be_bytes());
    inf.extend_from_slice(&i32::MAX.to_be_bytes());
    assert_eq!(inf.len(), 16);
    assert_eq!(sc(Scalar::Interval, &inf), "infinity");
    let mut ninf = i64::MIN.to_be_bytes().to_vec();
    ninf.extend_from_slice(&i32::MIN.to_be_bytes());
    ninf.extend_from_slice(&i32::MIN.to_be_bytes());
    assert_eq!(sc(Scalar::Interval, &ninf), "-infinity");
    assert_eq!(iv(i64::MAX, i32::MAX, i32::MAX), "infinity");
    assert_eq!(iv(i64::MIN, i32::MIN, i32::MIN), "-infinity");
}

#[test]
fn interval_with_only_some_parts_at_the_extreme_is_not_infinity() {
    // Chỉ khi cả ba phần cùng cực trị mới là vô cực; hai trên ba vẫn là giá trị thường.
    assert_ne!(iv(i64::MAX, i32::MAX, 0), "infinity");
    assert_ne!(iv(i64::MAX, 0, i32::MAX), "infinity");
    assert_ne!(iv(0, i32::MAX, i32::MAX), "infinity");
    assert_ne!(iv(i64::MIN, i32::MIN, 0), "-infinity");
    // Lệch dấu giữa các phần cũng không phải vô cực.
    assert_ne!(iv(i64::MAX, i32::MIN, i32::MIN), "infinity");
    assert_ne!(iv(i64::MIN, i32::MAX, i32::MAX), "-infinity");
}

#[test]
fn interval_fraction_uses_trimmed_micros() {
    // P3: phần micro giây ghi qua `write_micros_trimmed`.
    assert_eq!(iv(hms(0, 0, 1) + 500_000, 0, 0), "00:00:01.5");
    assert_eq!(iv(hms(0, 0, 1) + 1, 0, 0), "00:00:01.000001");
    assert_eq!(iv(hms(0, 0, 1) + 123_456, 0, 0), "00:00:01.123456");
}

#[test]
fn interval_wrong_length_falls_back_to_hex() {
    assert_hex_fallback(Scalar::Interval, &[0; 15]);
    assert_hex_fallback(Scalar::Interval, &[0; 17]);
    assert_hex_fallback(Scalar::Interval, &[]);
}

// ---- inet / cidr ----

#[test]
fn inet_ipv4_prints_mask_only_when_not_full() {
    let inet = |bits: u8| sc(Scalar::Inet, &inet_raw(2, bits, false, &[192, 168, 1, 1]));
    assert_eq!(inet(32), "192.168.1.1");
    assert_eq!(inet(24), "192.168.1.1/24");
    assert_eq!(inet(0), "192.168.1.1/0");
    assert_eq!(
        sc(Scalar::Inet, &inet_raw(2, 32, false, &[0, 0, 0, 0])),
        "0.0.0.0"
    );
}

#[test]
fn cidr_always_prints_the_mask() {
    assert_eq!(
        sc(Scalar::Cidr, &inet_raw(2, 24, true, &[192, 168, 1, 0])),
        "192.168.1.0/24"
    );
    assert_eq!(
        sc(Scalar::Cidr, &inet_raw(2, 0, true, &[0, 0, 0, 0])),
        "0.0.0.0/0"
    );
    assert_eq!(
        sc(Scalar::Cidr, &inet_raw(2, 32, true, &[10, 1, 2, 3])),
        "10.1.2.3/32"
    );
    assert_eq!(
        sc(
            Scalar::Cidr,
            &inet_raw(3, 32, true, &v6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]))
        ),
        "2001:db8::/32"
    );
    assert_eq!(sc(Scalar::Cidr, &inet_raw(3, 0, true, &[0; 16])), "::/0");
}

#[test]
fn inet_ipv6_with_mask() {
    assert_eq!(
        sc(
            Scalar::Inet,
            &inet_raw(3, 64, false, &v6([0xfe80, 0, 0, 0, 0, 0, 0, 1]))
        ),
        "fe80::1/64"
    );
    assert_eq!(
        sc(
            Scalar::Inet,
            &inet_raw(3, 127, false, &v6([0xfe80, 0, 0, 0, 0, 0, 0, 1]))
        ),
        "fe80::1/127"
    );
}

#[test]
fn ipv6_compression_follows_bind() {
    // Nén chuỗi 0 dài nhất, chuỗi đầu thắng khi bằng nhau.
    assert_eq!(ip6([0, 0, 0, 0, 0, 0, 0, 1]), "::1");
    assert_eq!(ip6([0; 8]), "::");
    assert_eq!(ip6([1, 0, 0, 0, 0, 0, 0, 0]), "1::");
    assert_eq!(ip6([1, 0, 0, 2, 0, 0, 0, 3]), "1:0:0:2::3");
    assert_eq!(ip6([0x2001, 0xdb8, 0, 0, 1, 0, 0, 1]), "2001:db8::1:0:0:1");
    assert_eq!(ip6([1, 0, 0, 0, 1, 0, 0, 1]), "1::1:0:0:1");
    assert_eq!(ip6([0xffff; 8]), "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
    // Một nhóm 0 đơn lẻ không nén.
    assert_eq!(ip6([1, 0, 2, 3, 4, 5, 6, 7]), "1:0:2:3:4:5:6:7");
    assert_eq!(ip6([0, 1, 2, 3, 4, 5, 6, 7]), "0:1:2:3:4:5:6:7");
    assert_eq!(ip6([1, 2, 3, 4, 5, 6, 7, 0]), "1:2:3:4:5:6:7:0");
    // Hex thường, không đệm số 0.
    assert_eq!(ip6([0xABCD, 0x0001, 0, 0, 0, 0, 0, 0x00ff]), "abcd:1::ff");
    assert_eq!(ip6([0, 0, 0xa, 0, 0, 0, 0, 0]), "0:0:a::");
}

#[test]
fn ipv6_embedded_ipv4_uses_dotted_quad() {
    assert_eq!(ip6([0, 0, 0, 0, 0, 0, 0x0102, 0x0304]), "::1.2.3.4");
    assert_eq!(
        ip6([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]),
        "::ffff:1.2.3.4"
    );
    // Kiểu BIND/PostgreSQL: `::1:2` in là `::0.1.0.2`.
    assert_eq!(ip6([0, 0, 0, 0, 0, 0, 1, 2]), "::0.1.0.2");
    assert_eq!(ip6([0, 0, 0, 0, 0, 0xffff, 0, 0]), "::ffff:0.0.0.0");
    // Chuỗi 0 không đủ dài hoặc không bắt đầu ở nhóm đầu thì không dùng dạng IPv4.
    assert_eq!(ip6([0, 0, 0, 0, 1, 2, 3, 4]), "::1:2:3:4");
    assert_eq!(ip6([1, 0, 0, 0, 0, 0, 0x0102, 0x0304]), "1::102:304");
    assert_eq!(
        ip6([0, 0, 0, 0, 0, 0xfffe, 0x0102, 0x0304]),
        "::fffe:102:304"
    );
}

#[test]
fn inet_with_malformed_data_falls_back_to_hex() {
    // Họ địa chỉ lạ, độ dài địa chỉ không khớp, thiếu byte, thừa byte.
    assert_hex_fallback(Scalar::Inet, &inet_raw(9, 32, false, &[1, 2, 3, 4]));
    assert_hex_fallback(Scalar::Inet, &inet_raw(2, 32, false, &[1, 2, 3]));
    assert_hex_fallback(Scalar::Inet, &inet_raw(3, 128, false, &[1; 4]));
    assert_hex_fallback(Scalar::Cidr, &[2, 32, 1]);
    assert_hex_fallback(Scalar::Inet, &[]);
    let mut extra = inet_raw(2, 32, false, &[1, 2, 3, 4]);
    extra.push(0);
    assert_hex_fallback(Scalar::Inet, &extra);
}

// ---- cell và hàm phụ ----

#[test]
fn cell_array_decoder_goes_through_write_array() {
    // Mảng int4 {7,8}: ndim=1, không NULL, oid int4=23, độ dài 2, chỉ số đầu 1.
    let mut arr = Vec::new();
    for v in [1i32, 0, 23, 2, 1] {
        arr.extend_from_slice(&v.to_be_bytes());
    }
    for e in [7i32, 8] {
        arr.extend_from_slice(&4i32.to_be_bytes());
        arr.extend_from_slice(&e.to_be_bytes());
    }
    assert_eq!(cell(Decoder::Array(Scalar::Int4), &arr), "{7,8}");
    // Rác thì ra hex của chính nó.
    assert_eq!(
        cell(Decoder::Array(Scalar::Int4), &[1, 2, 3]),
        hex(&[1, 2, 3])
    );
}

#[test]
fn digit_helpers_pad_and_truncate() {
    let mut out = String::new();
    push_2(&mut out, 7);
    push_2(&mut out, 12);
    push_2(&mut out, 100);
    assert_eq!(out, "0712100");
    out.clear();
    push_padded_2(&mut out, 5);
    push_padded_2(&mut out, 5_000_000_000);
    assert_eq!(out, "055000000000");
    out.clear();
    push_group(&mut out, 42, 4);
    push_group(&mut out, 9999, 2);
    assert_eq!(out, "004299");
}
