use super::*;
use mysql_common::row::new_row_raw;
use std::sync::Arc;

/// Dựng cột giả với kiểu, bộ ký tự, cờ và độ dài cho trước.
fn col(ty: ColumnType, charset: u16, flags: ColumnFlags, len: u32) -> Column {
    Column::new(ty)
        .with_character_set(charset)
        .with_flags(flags)
        .with_column_length(len)
}

/// Cột chữ thường (utf8mb4 = 45), không cờ.
fn text_col(ty: ColumnType, len: u32) -> Column {
    col(ty, 45, ColumnFlags::empty(), len)
}

#[test]
fn column_kind_bit_geometry_and_binary() {
    use ColumnType::*;
    assert_eq!(
        column_kind(&col(MYSQL_TYPE_BIT, 63, ColumnFlags::empty(), 12)),
        Kind::Bit(12)
    );
    assert_eq!(column_kind(&text_col(MYSQL_TYPE_GEOMETRY, 0)), Kind::Hex);
    // Mọi kiểu blob/chuỗi có bộ ký tự binary đều hiện hex.
    for ty in [
        MYSQL_TYPE_TINY_BLOB,
        MYSQL_TYPE_MEDIUM_BLOB,
        MYSQL_TYPE_LONG_BLOB,
        MYSQL_TYPE_BLOB,
        MYSQL_TYPE_STRING,
        MYSQL_TYPE_VAR_STRING,
        MYSQL_TYPE_VARCHAR,
    ] {
        assert_eq!(
            column_kind(&col(ty, 63, ColumnFlags::empty(), 10)),
            Kind::Hex,
            "{ty:?} binary"
        );
        assert_eq!(column_kind(&text_col(ty, 10)), Kind::Text, "{ty:?} text");
    }
}

#[test]
fn column_kind_other_types_are_text_even_with_binary_charset() {
    use ColumnType::*;
    // Số, ngày giờ, JSON dùng charset binary (63) nhưng server đã gửi chuỗi sẵn.
    for ty in [
        MYSQL_TYPE_LONG,
        MYSQL_TYPE_LONGLONG,
        MYSQL_TYPE_NEWDECIMAL,
        MYSQL_TYPE_DOUBLE,
        MYSQL_TYPE_DATE,
        MYSQL_TYPE_DATETIME,
        MYSQL_TYPE_TIMESTAMP,
        MYSQL_TYPE_JSON,
        MYSQL_TYPE_ENUM,
        MYSQL_TYPE_NULL,
    ] {
        assert_eq!(
            column_kind(&col(ty, 63, ColumnFlags::empty(), 10)),
            Kind::Text,
            "{ty:?}"
        );
    }
}

#[test]
fn type_name_integers_signed_and_unsigned() {
    use ColumnType::*;
    let un = ColumnFlags::UNSIGNED_FLAG;
    let none = ColumnFlags::empty();
    let cases = [
        (MYSQL_TYPE_TINY, "tinyint"),
        (MYSQL_TYPE_SHORT, "smallint"),
        (MYSQL_TYPE_INT24, "mediumint"),
        (MYSQL_TYPE_LONG, "int"),
        (MYSQL_TYPE_LONGLONG, "bigint"),
    ];
    for (ty, name) in cases {
        assert_eq!(type_name(&col(ty, 63, none, 0)), name);
        assert_eq!(type_name(&col(ty, 63, un, 0)), format!("{name} unsigned"));
    }
}

#[test]
fn type_name_fixed_kinds() {
    use ColumnType::*;
    let cases = [
        (MYSQL_TYPE_DECIMAL, "decimal"),
        (MYSQL_TYPE_NEWDECIMAL, "decimal"),
        (MYSQL_TYPE_FLOAT, "float"),
        (MYSQL_TYPE_DOUBLE, "double"),
        (MYSQL_TYPE_BIT, "bit"),
        (MYSQL_TYPE_DATE, "date"),
        (MYSQL_TYPE_NEWDATE, "date"),
        (MYSQL_TYPE_TIME, "time"),
        (MYSQL_TYPE_TIME2, "time"),
        (MYSQL_TYPE_DATETIME, "datetime"),
        (MYSQL_TYPE_DATETIME2, "datetime"),
        (MYSQL_TYPE_TIMESTAMP, "timestamp"),
        (MYSQL_TYPE_TIMESTAMP2, "timestamp"),
        (MYSQL_TYPE_YEAR, "year"),
        (MYSQL_TYPE_JSON, "json"),
        (MYSQL_TYPE_ENUM, "enum"),
        (MYSQL_TYPE_SET, "set"),
        (MYSQL_TYPE_GEOMETRY, "geometry"),
        (MYSQL_TYPE_NULL, "null"),
        (MYSQL_TYPE_VECTOR, "vector"),
    ];
    for (ty, name) in cases {
        assert_eq!(type_name(&text_col(ty, 0)), name, "{ty:?}");
    }
    // Kiểu không biết (mảng có kiểu của binlog) không panic.
    assert_eq!(type_name(&text_col(MYSQL_TYPE_TYPED_ARRAY, 0)), "unknown");
}

#[test]
fn type_name_blob_text_by_length_boundaries() {
    use ColumnType::*;
    // (độ dài, tên khi nhị phân, tên khi chữ); biên đúng bằng ngưỡng thuộc nhóm nhỏ hơn.
    let cases = [
        (0, "tinyblob", "tinytext"),
        (1_020, "tinyblob", "tinytext"),
        (1_021, "blob", "text"),
        (262_140, "blob", "text"),
        (262_141, "mediumblob", "mediumtext"),
        (67_108_860, "mediumblob", "mediumtext"),
        (67_108_861, "longblob", "longtext"),
        (u32::MAX, "longblob", "longtext"),
    ];
    for ty in [
        MYSQL_TYPE_TINY_BLOB,
        MYSQL_TYPE_MEDIUM_BLOB,
        MYSQL_TYPE_LONG_BLOB,
        MYSQL_TYPE_BLOB,
    ] {
        for (len, bin, text) in cases {
            assert_eq!(
                type_name(&col(ty, 63, ColumnFlags::empty(), len)),
                bin,
                "{ty:?} len {len}"
            );
            assert_eq!(type_name(&text_col(ty, len)), text, "{ty:?} len {len}");
        }
    }
}

#[test]
fn type_name_string_family() {
    use ColumnType::*;
    let none = ColumnFlags::empty();
    assert_eq!(type_name(&col(MYSQL_TYPE_STRING, 63, none, 5)), "binary");
    assert_eq!(type_name(&col(MYSQL_TYPE_STRING, 45, none, 5)), "char");
    for ty in [MYSQL_TYPE_VAR_STRING, MYSQL_TYPE_VARCHAR] {
        assert_eq!(type_name(&col(ty, 63, none, 5)), "varbinary");
        assert_eq!(type_name(&col(ty, 45, none, 5)), "varchar");
    }
}

#[test]
fn type_name_enum_and_set_flags_take_priority() {
    use ColumnType::*;
    for ty in [MYSQL_TYPE_STRING, MYSQL_TYPE_VAR_STRING, MYSQL_TYPE_VARCHAR] {
        assert_eq!(type_name(&col(ty, 45, ColumnFlags::ENUM_FLAG, 5)), "enum");
        assert_eq!(type_name(&col(ty, 45, ColumnFlags::SET_FLAG, 5)), "set");
        // Cờ ENUM thắng cờ SET khi cả hai cùng có (nhánh enum đứng trước).
        let both = ColumnFlags::ENUM_FLAG | ColumnFlags::SET_FLAG;
        assert_eq!(type_name(&col(ty, 45, both, 5)), "enum");
    }
}

#[test]
fn bit_string_basic_widths() {
    assert_eq!(bit_string(&[0b0000_0101], 3), "101");
    assert_eq!(bit_string(&[0b0000_0101], 8), "00000101");
    assert_eq!(bit_string(&[0b1000_0000], 1), "0");
    assert_eq!(bit_string(&[0xFF], 1), "1");
    // BIT(12) = 2 byte, chỉ lấy 12 bit thấp.
    assert_eq!(bit_string(&[0x0A, 0xBC], 12), "101010111100");
    assert_eq!(bit_string(&[0x00, 0x01], 16), "0000000000000001");
}

#[test]
fn bit_string_zero_or_oversized_width_takes_all_bits() {
    // bits = 0 (server không báo) hoặc lớn hơn số bit thật: lấy hết.
    assert_eq!(bit_string(&[0b1010_0000], 0), "10100000");
    assert_eq!(bit_string(&[0b1010_0000], 8), "10100000");
    assert_eq!(bit_string(&[0b1010_0000], 64), "10100000");
    assert_eq!(bit_string(&[0x01, 0x02], 0), "0000000100000010");
}

#[test]
fn bit_string_empty_bytes_is_empty() {
    assert_eq!(bit_string(&[], 0), "");
    assert_eq!(bit_string(&[], 5), "");
}

#[test]
fn cell_text_utf8_is_passed_through() {
    assert_eq!(cell(Kind::Text, "héllo".as_bytes().to_vec()), "héllo");
    assert_eq!(cell(Kind::Text, Vec::new()), "");
    assert_eq!(cell(Kind::Text, b"-12.50".to_vec()), "-12.50");
}

#[test]
fn cell_text_invalid_utf8_uses_replacement_char() {
    assert_eq!(cell(Kind::Text, vec![b'a', 0xFF, b'b']), "a\u{FFFD}b");
    // Chuỗi UTF-8 bị cắt giữa ký tự (é = C3 A9).
    assert_eq!(cell(Kind::Text, vec![0xC3]), "\u{FFFD}");
}

#[test]
fn cell_hex_and_bit() {
    assert_eq!(cell(Kind::Hex, vec![0x00, 0xAB, 0xFF]), "0x00abff");
    assert_eq!(cell(Kind::Hex, Vec::new()), "0x");
    assert_eq!(cell(Kind::Bit(4), vec![0b0000_1010]), "1010");
}

/// Dựng `Row` giả từ các giá trị thô.
fn row(values: Vec<Option<Value>>) -> Row {
    let cols: Vec<Column> = values
        .iter()
        .map(|_| text_col(ColumnType::MYSQL_TYPE_VAR_STRING, 10))
        .collect();
    new_row_raw(values, Arc::from(cols))
}

#[test]
fn convert_row_maps_each_kind_and_null() {
    let r = row(vec![
        Some(Value::Bytes(b"abc".to_vec())),
        Some(Value::Bytes(vec![0xDE, 0xAD])),
        Some(Value::Bytes(vec![0b0000_0011])),
        Some(Value::NULL),
    ]);
    let kinds = [Kind::Text, Kind::Hex, Kind::Bit(2), Kind::Text];
    assert_eq!(
        convert_row(r, &kinds),
        vec![
            Some("abc".to_string()),
            Some("0xdead".to_string()),
            Some("11".to_string()),
            None
        ]
    );
}

#[test]
fn convert_row_missing_value_is_null() {
    // `None` (ô đã bị lấy đi) coi như NULL.
    let r = row(vec![None, Some(Value::Bytes(b"x".to_vec()))]);
    assert_eq!(
        convert_row(r, &[Kind::Text, Kind::Text]),
        vec![None, Some("x".to_string())]
    );
}

#[test]
fn convert_row_non_text_value_falls_back_to_sql_literal() {
    // Nhánh phòng thủ: giá trị không phải Bytes/NULL vẫn ra chuỗi, không panic.
    let r = row(vec![Some(Value::Int(-7)), Some(Value::UInt(9))]);
    assert_eq!(
        convert_row(r, &[Kind::Text, Kind::Text]),
        vec![Some("-7".to_string()), Some("9".to_string())]
    );
}

#[test]
fn convert_row_extra_values_beyond_kinds_are_dropped() {
    // `zip` dừng ở bên ngắn hơn: không panic nếu số kind ít hơn số ô.
    let r = row(vec![
        Some(Value::Bytes(b"a".to_vec())),
        Some(Value::Bytes(b"b".to_vec())),
    ]);
    assert_eq!(convert_row(r, &[Kind::Text]), vec![Some("a".to_string())]);
}
