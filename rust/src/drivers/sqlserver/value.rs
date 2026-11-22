//! Đổi cột và ô của kết quả SQL Server (`tiberius`) sang tên kiểu và chuỗi hiển thị.
//!
//! Vị trí trong luồng: `actor` gọi `column_kinds` một lần cho mỗi result set (lúc có mô tả
//! cột) rồi `convert_row` cho từng dòng đọc từ server.
//!
//! `tiberius` đã giải mã giao thức TDS thành `ColumnData` (số, chuỗi UTF-8, mảng byte, các
//! struct ngày giờ...). Ở đây ta đọc thẳng `ColumnData` rồi viết ra chuỗi, không đi qua
//! `Row::get`/`FromSql` (sẽ phải chọn một kiểu trung gian như `chrono` cho mỗi ô). Ngày giờ viết
//! bằng `datetime.rs` (không kéo `chrono`), số nguyên bằng `itoa`.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `enum` + `match`: `ColumnData` là một enum, mỗi kiểu của SQL Server là một biến thể
//!   (variant); `match` buộc ta xử lý mọi biến thể (thiếu một cái là compiler báo lỗi).
//! - `Option<T>`: mỗi biến thể của `ColumnData` chứa `Option`, `None` chính là NULL của SQL.
//! - `Cow<str>`: chuỗi "mượn hoặc sở hữu"; `into_owned()` lấy lại `String` mà không sao chép
//!   nếu nó đã là bản sở hữu (trường hợp của `tiberius`, nên mỗi ô chữ chỉ tốn một lần cấp phát).

use crate::drivers::common::hex;
use crate::drivers::datetime::{
    MSSQL_DATE_EPOCH_UNIX_DAYS, MSSQL_DATETIME_EPOCH_UNIX_DAYS, write_date, write_time_ticks,
};
use crate::protocol::Column as ProtoColumn;
use std::fmt::Display;
use tiberius::time::{Date, DateTime, DateTime2, DateTimeOffset, SmallDateTime, Time};
use tiberius::xml::XmlData;
use tiberius::{Column, ColumnData, ColumnType, Row, Uuid};

/// Cách hiển thị một cột. `tiberius` giải mã `money`/`smallmoney` thành `f64` (cùng biến thể
/// với `float`), nên chỉ có mô tả cột mới phân biệt được hai loại.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Dùng nguyên giá trị theo kiểu của `ColumnData`.
    Plain,
    /// `money`/`smallmoney`: `f64` đã chia 10^4, hiện lại đủ 4 chữ số thập phân.
    Money,
}

/// Cột của result set theo dạng của giao thức (tên + tên kiểu).
pub fn protocol_columns(cols: &[Column]) -> Vec<ProtoColumn> {
    cols.iter()
        .map(|c| ProtoColumn {
            name: c.name().to_owned(),
            ty: type_name(c.column_type()).to_owned(),
        })
        .collect()
}

/// Cách hiển thị của từng cột trong `cols`.
pub fn column_kinds(cols: &[Column]) -> Vec<Kind> {
    cols.iter()
        .map(|c| match c.column_type() {
            ColumnType::Money | ColumnType::Money4 => Kind::Money,
            _ => Kind::Plain,
        })
        .collect()
}

/// Tên kiểu của cột để hiện ở tiêu đề (chữ thường như `sys.types`). `tiberius` chỉ cho biết
/// loại giao thức, không có độ dài/precision nên không có phần `(n)`. `smalldatetime` và
/// `datetime` có thể được báo chung là `datetimen` (kiểu cho phép NULL), khi đó ta lấy tên
/// phổ biến hơn là `datetime`.
pub fn type_name(ty: ColumnType) -> &'static str {
    use ColumnType::*;
    match ty {
        Null => "null",
        Bit | Bitn => "bit",
        Int1 => "tinyint",
        Int2 => "smallint",
        Int4 => "int",
        Int8 => "bigint",
        Intn => "int",
        Datetime4 => "smalldatetime",
        Datetime | Datetimen => "datetime",
        Float4 => "real",
        Float8 | Floatn => "float",
        Money => "money",
        Money4 => "smallmoney",
        Guid => "uniqueidentifier",
        Decimaln => "decimal",
        Numericn => "numeric",
        Daten => "date",
        Timen => "time",
        Datetime2 => "datetime2",
        DatetimeOffsetn => "datetimeoffset",
        BigVarBin => "varbinary",
        BigBinary => "binary",
        BigVarChar => "varchar",
        BigChar => "char",
        NVarchar => "nvarchar",
        NChar => "nchar",
        Xml => "xml",
        Udt => "udt",
        Text => "text",
        NText => "ntext",
        Image => "image",
        SSVariant => "sql_variant",
    }
}

/// Đổi một dòng thành các ô chuỗi (`None` = NULL). `kinds` là kết quả của `column_kinds` cho
/// cùng result set; cột nào không có trong `kinds` thì coi là `Plain`.
pub fn convert_row(row: Row, kinds: &[Kind]) -> Vec<Option<String>> {
    // `into_iter()` lấy từng `ColumnData` theo giá trị (move), nên chuỗi không bị sao chép.
    let cells = row.into_iter();
    let mut out = Vec::with_capacity(cells.len());
    for (i, data) in cells.enumerate() {
        let kind = kinds.get(i).copied().unwrap_or(Kind::Plain);
        out.push(cell(data, kind));
    }
    out
}

/// Đổi một ô thành chuỗi hiển thị.
pub fn cell(data: ColumnData<'_>, kind: Kind) -> Option<String> {
    match data {
        ColumnData::U8(v) => v.map(int),
        ColumnData::I16(v) => v.map(int),
        ColumnData::I32(v) => v.map(int),
        ColumnData::I64(v) => v.map(int),
        ColumnData::F32(v) => v.map(float_text),
        ColumnData::F64(v) => v.map(|v| match kind {
            Kind::Money => money_text(v),
            Kind::Plain => float_text(v),
        }),
        ColumnData::Bit(v) => v.map(|b| (if b { "1" } else { "0" }).to_owned()),
        ColumnData::String(v) => v.map(std::borrow::Cow::into_owned),
        ColumnData::Guid(v) => v.map(|g| guid_text(&g)),
        ColumnData::Binary(v) => v.map(|b| hex(&b)),
        ColumnData::Numeric(v) => v.map(|n| numeric_text(n.value(), n.scale())),
        ColumnData::Xml(v) => v.map(|x| {
            let xml: &XmlData = &x;
            let text: &str = xml.as_ref();
            text.to_owned()
        }),
        ColumnData::DateTime(v) => v.map(datetime_text),
        ColumnData::SmallDateTime(v) => v.map(smalldatetime_text),
        ColumnData::Time(v) => v.map(|t| {
            let mut s = String::with_capacity(16);
            write_time_ticks(&mut s, t.increments(), t.scale());
            s
        }),
        ColumnData::Date(v) => v.map(|d| {
            let mut s = String::with_capacity(10);
            write_date(&mut s, date_unix_days(d));
            s
        }),
        ColumnData::DateTime2(v) => v.map(datetime2_text),
        ColumnData::DateTimeOffset(v) => v.map(datetimeoffset_text),
    }
}

/// Số nguyên thành chuỗi bằng `itoa` (nhanh hơn `format!`, một lần cấp phát đúng cỡ).
fn int<I: itoa::Integer>(v: I) -> String {
    itoa::Buffer::new().format(v).to_owned()
}

/// Số thực thành chuỗi: chữ số ngắn nhất mà đọc lại đúng giá trị (như `Display` của Rust);
/// số quá lớn hoặc quá nhỏ dùng ký hiệu khoa học kiểu SQL Server (`1.5E+20`, `2E-07`).
/// Bit dấu của 0 bị bỏ (`-0` hiện `0`). `Into<f64>` chỉ để so cỡ độ lớn, giá trị in vẫn là
/// kiểu gốc nên `real` (f32) không hiện thêm chữ số rác của f64.
fn float_text<F: Display + std::fmt::LowerExp + Into<f64> + Copy>(v: F) -> String {
    let magnitude: f64 = v.into();
    let abs = magnitude.abs();
    if abs == 0.0 {
        return "0".to_owned();
    }
    if (1e-5..1e15).contains(&abs) {
        return v.to_string();
    }
    let sci = format!("{v:e}");
    match sci.split_once('e') {
        // Rust viết `1e-7`/`1.5e20`; SQL Server luôn có dấu của số mũ.
        Some((mantissa, exp)) if exp.starts_with('-') => format!("{mantissa}E{exp}"),
        Some((mantissa, exp)) => format!("{mantissa}E+{exp}"),
        None => sci,
    }
}

/// `money`/`smallmoney` từ `f64`: lấy lại số đơn vị 10^-4 rồi viết đủ 4 chữ số thập phân.
/// `tiberius` đã đổi sang `f64` nên giá trị trên ~9×10^11 có thể lệch ở các chữ số cuối
/// (giới hạn của `f64`, 53 bit); `smallmoney` luôn chính xác.
fn money_text(v: f64) -> String {
    // `as i64` bão hoà ở biên thay vì tràn, và NaN thành 0: không panic với dữ liệu lạ.
    let units = (v * 10_000.0).round() as i64;
    let mut s = String::with_capacity(24);
    if units < 0 {
        s.push('-');
    }
    let abs = units.unsigned_abs();
    s.push_str(itoa::Buffer::new().format(abs / 10_000));
    s.push('.');
    let frac = abs % 10_000;
    // Đệm số 0 bên trái cho đủ 4 chữ số.
    for digit in [1_000, 100, 10, 1] {
        s.push(char::from(
            b'0' + u8::try_from(frac / digit % 10).unwrap_or(0),
        ));
    }
    s
}

/// `decimal`/`numeric`: `unscaled` là số nguyên chưa chia, `scale` là số chữ số thập phân.
/// Ví dụ (12345, 2) -> `123.45`, (-5, 3) -> `-0.005`, (7, 0) -> `7`. Giữ đủ `scale` chữ số
/// lẻ như SQL Server (`decimal(10,2)` giá trị 3 hiện `3.00`).
fn numeric_text(unscaled: i128, scale: u8) -> String {
    let mut buf = itoa::Buffer::new();
    let digits = buf.format(unscaled.unsigned_abs());
    let scale = usize::from(scale);
    let mut s = String::with_capacity(digits.len() + scale + 3);
    if unscaled < 0 {
        s.push('-');
    }
    if scale == 0 {
        s.push_str(digits);
    } else if digits.len() > scale {
        let (int_part, frac) = digits.split_at(digits.len() - scale);
        s.push_str(int_part);
        s.push('.');
        s.push_str(frac);
    } else {
        // Nhỏ hơn 1: `0.` rồi đệm số 0 cho đủ `scale` chữ số.
        s.push_str("0.");
        for _ in digits.len()..scale {
            s.push('0');
        }
        s.push_str(digits);
    }
    s
}

/// `uniqueidentifier` viết HOA như SQL Server (`6F9619FF-8B86-D011-B42D-00C04FC964FF`).
fn guid_text(g: &Uuid) -> String {
    let mut buf = Uuid::encode_buffer();
    g.hyphenated().encode_upper(&mut buf).to_owned()
}

/// Số ngày kể từ 1970-01-01 của `date` (SQL Server đếm từ 0001-01-01).
fn date_unix_days(d: Date) -> i64 {
    i64::from(d.days()) + MSSQL_DATE_EPOCH_UNIX_DAYS
}

/// `datetime`: ngày + giờ có phần lẻ mili giây (`.000`, `.003`, `.007`...).
/// Server đếm giờ theo 1/300 giây; mili giây hiển thị là `(ticks * 10 + 1) / 3` (làm tròn
/// kiểu SQL Server: 1 tick -> .003, 2 -> .007, 3 -> .010).
fn datetime_text(dt: DateTime) -> String {
    let mut s = String::with_capacity(23);
    write_date(
        &mut s,
        i64::from(dt.days()) + MSSQL_DATETIME_EPOCH_UNIX_DAYS,
    );
    s.push(' ');
    let millis = (u64::from(dt.seconds_fragments()) * 10 + 1) / 3;
    write_time_ticks(&mut s, millis, 3);
    s
}

/// `smalldatetime`: chính xác tới phút, giây luôn `00`.
fn smalldatetime_text(dt: SmallDateTime) -> String {
    let mut s = String::with_capacity(19);
    write_date(
        &mut s,
        i64::from(dt.days()) + MSSQL_DATETIME_EPOCH_UNIX_DAYS,
    );
    s.push(' ');
    write_time_ticks(&mut s, u64::from(dt.seconds_fragments()) * 60, 0);
    s
}

/// `datetime2(n)`: ngày + giờ có đúng `n` chữ số lẻ giây.
fn datetime2_text(dt: DateTime2) -> String {
    let mut s = String::with_capacity(27);
    write_date(&mut s, date_unix_days(dt.date()));
    s.push(' ');
    let time: Time = dt.time();
    write_time_ticks(&mut s, time.increments(), time.scale());
    s
}

/// `datetimeoffset(n)`: giờ địa phương kèm độ lệch `+HH:MM`/`-HH:MM` như SQL Server.
/// TDS gửi phần ngày giờ theo UTC và độ lệch tính bằng phút, nên giờ địa phương là UTC cộng độ
/// lệch (có thể sang ngày khác).
fn datetimeoffset_text(dto: DateTimeOffset) -> String {
    let utc = dto.datetime2();
    let time = utc.time();
    let scale = time.scale().min(7);
    let unit = 10i128.pow(u32::from(scale));
    let offset = i128::from(dto.offset());
    let per_day = 86_400 * unit;
    let total = i128::from(date_unix_days(utc.date())) * per_day
        + i128::from(time.increments())
        + offset * 60 * unit;
    let days = i64::try_from(total.div_euclid(per_day)).unwrap_or(0);
    let ticks = u64::try_from(total.rem_euclid(per_day)).unwrap_or(0);

    let mut s = String::with_capacity(34);
    write_date(&mut s, days);
    s.push(' ');
    write_time_ticks(&mut s, ticks, scale);
    s.push(' ');
    s.push(if offset < 0 { '-' } else { '+' });
    let abs = offset.unsigned_abs();
    push_2(&mut s, abs / 60);
    s.push(':');
    push_2(&mut s, abs % 60);
    s
}

/// Ghi số `< 100` thành đúng hai chữ số.
fn push_2(out: &mut String, n: u128) {
    out.push(char::from(b'0' + u8::try_from(n / 10 % 10).unwrap_or(0)));
    out.push(char::from(b'0' + u8::try_from(n % 10).unwrap_or(0)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;
    use tiberius::numeric::Numeric;

    /// Ô `Plain` từ `ColumnData`.
    fn text(data: ColumnData<'_>) -> Option<String> {
        cell(data, Kind::Plain)
    }

    fn some(data: ColumnData<'_>) -> String {
        text(data).expect("không phải NULL")
    }

    /// Ngày của SQL Server: số ngày kể từ 0001-01-01.
    fn date(days_from_0001: u32) -> Date {
        Date::new(days_from_0001)
    }

    // 2024-02-29 là ngày thứ 738_944 kể từ 0001-01-01 (719_162 ngày tới 1970-01-01 + 19_782).
    const D_2024_02_29: u32 = 738_944;

    #[test]
    fn integers_use_their_decimal_form_and_keep_the_extremes() {
        assert_eq!(some(ColumnData::U8(Some(0))), "0");
        assert_eq!(some(ColumnData::U8(Some(255))), "255");
        assert_eq!(some(ColumnData::I16(Some(i16::MIN))), "-32768");
        assert_eq!(some(ColumnData::I16(Some(i16::MAX))), "32767");
        assert_eq!(some(ColumnData::I32(Some(i32::MIN))), "-2147483648");
        assert_eq!(some(ColumnData::I32(Some(i32::MAX))), "2147483647");
        assert_eq!(
            some(ColumnData::I64(Some(i64::MIN))),
            "-9223372036854775808"
        );
        assert_eq!(some(ColumnData::I64(Some(i64::MAX))), "9223372036854775807");
    }

    #[test]
    fn every_null_variant_is_none() {
        let nulls: Vec<ColumnData<'static>> = vec![
            ColumnData::U8(None),
            ColumnData::I16(None),
            ColumnData::I32(None),
            ColumnData::I64(None),
            ColumnData::F32(None),
            ColumnData::F64(None),
            ColumnData::Bit(None),
            ColumnData::String(None),
            ColumnData::Guid(None),
            ColumnData::Binary(None),
            ColumnData::Numeric(None),
            ColumnData::Xml(None),
            ColumnData::DateTime(None),
            ColumnData::SmallDateTime(None),
            ColumnData::Time(None),
            ColumnData::Date(None),
            ColumnData::DateTime2(None),
            ColumnData::DateTimeOffset(None),
        ];
        for n in nulls {
            let name = format!("{n:?}");
            assert_eq!(cell(n.clone(), Kind::Plain), None, "{name}");
            // `Money` chỉ đổi cách hiển thị số, NULL vẫn là NULL.
            assert_eq!(cell(n, Kind::Money), None, "{name}");
        }
    }

    #[test]
    fn bit_is_one_or_zero() {
        assert_eq!(some(ColumnData::Bit(Some(true))), "1");
        assert_eq!(some(ColumnData::Bit(Some(false))), "0");
    }

    #[test]
    fn float_uses_the_shortest_round_trip_text() {
        assert_eq!(some(ColumnData::F64(Some(1.5))), "1.5");
        assert_eq!(some(ColumnData::F64(Some(-2.25))), "-2.25");
        assert_eq!(some(ColumnData::F64(Some(3.0))), "3");
        assert_eq!(some(ColumnData::F64(Some(0.1))), "0.1");
        assert_eq!(
            some(ColumnData::F64(Some(123_456_789.123))),
            "123456789.123"
        );
        // `real` (f32) không hiện chữ số rác của f64.
        assert_eq!(some(ColumnData::F32(Some(0.1))), "0.1");
        assert_eq!(some(ColumnData::F32(Some(1.5))), "1.5");
    }

    #[test]
    fn float_zero_has_no_sign() {
        assert_eq!(some(ColumnData::F64(Some(0.0))), "0");
        assert_eq!(some(ColumnData::F64(Some(-0.0))), "0");
        assert_eq!(some(ColumnData::F32(Some(-0.0))), "0");
    }

    #[test]
    fn float_switches_to_scientific_outside_1e_minus_5_to_1e15() {
        assert_eq!(some(ColumnData::F64(Some(1.5e20))), "1.5E+20");
        assert_eq!(some(ColumnData::F64(Some(-1.5e20))), "-1.5E+20");
        assert_eq!(some(ColumnData::F64(Some(2e-7))), "2E-7");
        assert_eq!(some(ColumnData::F64(Some(-2e-7))), "-2E-7");
        // Biên: 1e15 đã sang ký hiệu khoa học, 1e14 thì chưa.
        assert_eq!(some(ColumnData::F64(Some(1e15))), "1E+15");
        assert_eq!(some(ColumnData::F64(Some(1e14))), "100000000000000");
        // 1e-5 còn dạng thường, nhỏ hơn thì khoa học.
        assert_eq!(some(ColumnData::F64(Some(1e-5))), "0.00001");
        assert_eq!(some(ColumnData::F64(Some(9.9e-6))), "9.9E-6");
        assert_eq!(
            some(ColumnData::F64(Some(f64::MAX))),
            "1.7976931348623157E+308"
        );
        assert_eq!(
            some(ColumnData::F64(Some(f64::MIN_POSITIVE))),
            "2.2250738585072014E-308"
        );
        assert_eq!(some(ColumnData::F32(Some(f32::MAX))), "3.4028235E+38");
        assert_eq!(some(ColumnData::F32(Some(1e-7))), "1E-7");
    }

    #[test]
    fn float_non_finite_values_do_not_panic() {
        // SQL Server không lưu NaN/Infinity; chỉ cần không panic với dữ liệu lạ.
        for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(!some(ColumnData::F64(Some(v))).is_empty());
        }
    }

    #[test]
    fn money_always_shows_four_decimals() {
        let money = |v: f64| cell(ColumnData::F64(Some(v)), Kind::Money).unwrap();
        assert_eq!(money(0.0), "0.0000");
        assert_eq!(money(12.5), "12.5000");
        assert_eq!(money(-0.5), "-0.5000");
        assert_eq!(money(-0.0001), "-0.0001");
        assert_eq!(money(0.0001), "0.0001");
        assert_eq!(money(1234.5678), "1234.5678");
        // smallmoney lớn nhất/nhỏ nhất.
        assert_eq!(money(214_748.364_7), "214748.3647");
        assert_eq!(money(-214_748.364_8), "-214748.3648");
        // Sai số nhỏ của f64 được làm tròn về đơn vị 10^-4.
        assert_eq!(money(0.1 + 0.2), "0.3000");
    }

    #[test]
    fn money_extremes_and_nan_do_not_panic() {
        let money = |v: f64| cell(ColumnData::F64(Some(v)), Kind::Money).unwrap();
        assert_eq!(money(f64::NAN), "0.0000");
        // `as i64` bão hoà ở biên thay vì tràn.
        assert!(!money(9.2e14).is_empty());
        assert!(!money(f64::INFINITY).is_empty());
        assert!(money(f64::NEG_INFINITY).starts_with('-'));
    }

    #[test]
    fn kind_only_changes_f64_not_other_variants() {
        // f32 (`real`) và số nguyên không bị ảnh hưởng bởi `Kind::Money`.
        assert_eq!(
            cell(ColumnData::F32(Some(1.5)), Kind::Money).unwrap(),
            "1.5"
        );
        assert_eq!(cell(ColumnData::I32(Some(7)), Kind::Money).unwrap(), "7");
        // `float` thường (Plain) không thêm 4 số lẻ.
        assert_eq!(
            cell(ColumnData::F64(Some(12.5)), Kind::Plain).unwrap(),
            "12.5"
        );
    }

    fn numeric(v: i128, scale: u8) -> String {
        some(ColumnData::Numeric(Some(Numeric::new_with_scale(v, scale))))
    }

    #[test]
    fn numeric_keeps_sign_and_scale() {
        assert_eq!(numeric(12345, 2), "123.45");
        assert_eq!(numeric(-12345, 2), "-123.45");
        assert_eq!(numeric(7, 0), "7");
        assert_eq!(numeric(-7, 0), "-7");
        assert_eq!(numeric(0, 0), "0");
        // Nhỏ hơn 1: `0.` rồi đệm số 0 cho đủ scale.
        assert_eq!(numeric(-5, 3), "-0.005");
        assert_eq!(numeric(3, 2), "0.03");
        assert_eq!(numeric(0, 2), "0.00");
        // `decimal(10,2)` giá trị 3 -> 3.00.
        assert_eq!(numeric(300, 2), "3.00");
        assert_eq!(numeric(100, 2), "1.00");
        // Số chữ số đúng bằng scale.
        assert_eq!(numeric(99, 2), "0.99");
    }

    #[test]
    fn numeric_handles_the_widest_decimal_38() {
        let max = 10i128.pow(38) - 1;
        assert_eq!(numeric(max, 0), "9".repeat(38));
        assert_eq!(numeric(-max, 0), format!("-{}", "9".repeat(38)));
        assert_eq!(numeric(max, 38), format!("0.{}", "9".repeat(38)));
        assert_eq!(numeric(1, 38), format!("0.{}1", "0".repeat(37)));
        assert_eq!(
            numeric(max, 19),
            format!("{}.{}", "9".repeat(19), "9".repeat(19))
        );
    }

    #[test]
    fn strings_keep_unicode_and_empty() {
        assert_eq!(some(ColumnData::String(Some(Cow::Borrowed("")))), "");
        assert_eq!(
            some(ColumnData::String(Some(Cow::Borrowed(
                "Tiếng Việt é 日本語 😀"
            )))),
            "Tiếng Việt é 日本語 😀"
        );
        assert_eq!(
            some(ColumnData::String(Some(Cow::Owned("a'b\"c\n".to_owned())))),
            "a'b\"c\n"
        );
    }

    #[test]
    fn binary_is_lowercase_hex_with_0x_prefix() {
        let bin = |b: &[u8]| some(ColumnData::Binary(Some(Cow::Owned(b.to_vec()))));
        assert_eq!(bin(&[]), "0x");
        assert_eq!(bin(&[0x00]), "0x00");
        assert_eq!(bin(&[0xde, 0xad, 0xbe, 0xef]), "0xdeadbeef");
        assert_eq!(bin(&[0x0a, 0xff]), "0x0aff");
    }

    #[test]
    fn uniqueidentifier_is_uppercase_and_hyphenated() {
        let g = Uuid::parse_str("6f9619ff-8b86-d011-b42d-00c04fc964ff").unwrap();
        assert_eq!(
            some(ColumnData::Guid(Some(g))),
            "6F9619FF-8B86-D011-B42D-00C04FC964FF"
        );
        assert_eq!(
            some(ColumnData::Guid(Some(Uuid::nil()))),
            "00000000-0000-0000-0000-000000000000"
        );
    }

    #[test]
    fn xml_is_its_text() {
        let x = XmlData::new("<a b=\"1\">é</a>");
        assert_eq!(
            some(ColumnData::Xml(Some(Cow::Owned(x)))),
            "<a b=\"1\">é</a>"
        );
        assert_eq!(
            some(ColumnData::Xml(Some(Cow::Owned(XmlData::new(""))))),
            ""
        );
    }

    #[test]
    fn date_covers_the_whole_sql_server_range() {
        let d = |n: u32| some(ColumnData::Date(Some(date(n))));
        assert_eq!(d(0), "0001-01-01");
        assert_eq!(d(719_162), "1970-01-01");
        assert_eq!(d(D_2024_02_29), "2024-02-29");
        assert_eq!(d(D_2024_02_29 + 1), "2024-03-01");
        assert_eq!(d(3_652_058), "9999-12-31");
    }

    #[test]
    fn time_has_exactly_scale_fraction_digits() {
        let t = |incr: u64, scale: u8| some(ColumnData::Time(Some(Time::new(incr, scale))));
        assert_eq!(t(0, 0), "00:00:00");
        assert_eq!(t(3661, 0), "01:01:01");
        assert_eq!(t(86_399, 0), "23:59:59");
        assert_eq!(t(1, 3), "00:00:00.001");
        assert_eq!(t(12_345, 3), "00:00:12.345");
        assert_eq!(t(10, 1), "00:00:01.0");
        assert_eq!(t(1, 7), "00:00:00.0000001");
        assert_eq!(t(863_999_999_999, 7), "23:59:59.9999999");
        for scale in 0..=7u8 {
            let s = t(0, scale);
            let want = if scale == 0 {
                8
            } else {
                9 + usize::from(scale)
            };
            assert_eq!(s.len(), want, "scale {scale}: {s}");
        }
    }

    #[test]
    fn datetime2_combines_date_and_time_with_scale() {
        let dt = |days: u32, incr: u64, scale: u8| {
            some(ColumnData::DateTime2(Some(DateTime2::new(
                date(days),
                Time::new(incr, scale),
            ))))
        };
        assert_eq!(dt(D_2024_02_29, 0, 0), "2024-02-29 00:00:00");
        assert_eq!(
            dt(D_2024_02_29, 123_456_700, 7),
            "2024-02-29 00:00:12.3456700"
        );
        assert_eq!(dt(0, 0, 7), "0001-01-01 00:00:00.0000000");
        assert_eq!(
            dt(3_652_058, 863_999_999_999, 7),
            "9999-12-31 23:59:59.9999999"
        );
        assert_eq!(dt(D_2024_02_29, 5, 2), "2024-02-29 00:00:00.05");
    }

    #[test]
    fn datetime_uses_sql_server_rounding_of_300ths() {
        let dt = |days: i32, frag: u32| some(ColumnData::DateTime(Some(DateTime::new(days, frag))));
        assert_eq!(dt(0, 0), "1900-01-01 00:00:00.000");
        // 1 tick = 1/300 s -> .003, 2 -> .007, 3 -> .010.
        assert_eq!(dt(0, 1), "1900-01-01 00:00:00.003");
        assert_eq!(dt(0, 2), "1900-01-01 00:00:00.007");
        assert_eq!(dt(0, 3), "1900-01-01 00:00:00.010");
        // Ngày cuối cùng của kiểu: 9999-12-31 23:59:59.997.
        assert_eq!(dt(2_958_463, 25_919_999), "9999-12-31 23:59:59.997");
        // Ngày âm (trước 1900): giá trị nhỏ nhất của kiểu là 1753-01-01.
        assert_eq!(dt(-53_690, 0), "1753-01-01 00:00:00.000");
    }

    #[test]
    fn smalldatetime_has_zero_seconds() {
        let dt = |days: u16, minutes: u16| {
            some(ColumnData::SmallDateTime(Some(SmallDateTime::new(
                days, minutes,
            ))))
        };
        assert_eq!(dt(0, 0), "1900-01-01 00:00:00");
        assert_eq!(dt(0, 1439), "1900-01-01 23:59:00");
        assert_eq!(dt(65_535, 0), "2079-06-06 00:00:00");
    }

    fn dto(days: u32, incr: u64, scale: u8, offset: i16) -> String {
        some(ColumnData::DateTimeOffset(Some(DateTimeOffset::new(
            DateTime2::new(date(days), Time::new(incr, scale)),
            offset,
        ))))
    }

    #[test]
    fn datetimeoffset_shows_local_time_and_offset() {
        // UTC 2024-02-29 23:30:00 + 120 phút -> sang ngày 2024-03-01 01:30 local.
        assert_eq!(
            dto(D_2024_02_29, 23 * 3600 + 30 * 60, 0, 120),
            "2024-03-01 01:30:00 +02:00"
        );
        // Offset âm kèm phút lẻ: UTC 2024-03-01 02:00 - 5h30 -> 2024-02-29 20:30 -05:30.
        assert_eq!(
            dto(D_2024_02_29 + 1, 2 * 3600, 0, -330),
            "2024-02-29 20:30:00 -05:30"
        );
        assert_eq!(dto(D_2024_02_29, 0, 0, 0), "2024-02-29 00:00:00 +00:00");
        // Giữ scale của phần giây.
        assert_eq!(
            dto(D_2024_02_29, 123_456_700, 7, 60),
            "2024-02-29 01:00:12.3456700 +01:00"
        );
        // Biên offset của SQL Server: +14:00 và -14:00.
        assert_eq!(dto(D_2024_02_29, 0, 0, 840), "2024-02-29 14:00:00 +14:00");
        assert_eq!(dto(D_2024_02_29, 0, 0, -840), "2024-02-28 10:00:00 -14:00");
    }

    #[test]
    fn datetimeoffset_crossing_the_year_boundary_stays_correct() {
        // 2023-12-31 23:00 UTC + 1 giờ -> 2024-01-01 00:00 +01:00.
        let new_year_eve = D_2024_02_29 - 31 - 28 - 1;
        assert_eq!(
            dto(new_year_eve, 23 * 3600, 0, 60),
            "2024-01-01 00:00:00 +01:00"
        );
    }

    #[test]
    fn type_names_follow_sys_types() {
        use ColumnType::*;
        let table = [
            (Null, "null"),
            (Bit, "bit"),
            (Bitn, "bit"),
            (Int1, "tinyint"),
            (Int2, "smallint"),
            (Int4, "int"),
            (Int8, "bigint"),
            (Intn, "int"),
            (Datetime4, "smalldatetime"),
            (Datetime, "datetime"),
            (Datetimen, "datetime"),
            (Float4, "real"),
            (Float8, "float"),
            (Floatn, "float"),
            (Money, "money"),
            (Money4, "smallmoney"),
            (Guid, "uniqueidentifier"),
            (Decimaln, "decimal"),
            (Numericn, "numeric"),
            (Daten, "date"),
            (Timen, "time"),
            (Datetime2, "datetime2"),
            (DatetimeOffsetn, "datetimeoffset"),
            (BigVarBin, "varbinary"),
            (BigBinary, "binary"),
            (BigVarChar, "varchar"),
            (BigChar, "char"),
            (NVarchar, "nvarchar"),
            (NChar, "nchar"),
            (Xml, "xml"),
            (Udt, "udt"),
            (Text, "text"),
            (NText, "ntext"),
            (Image, "image"),
            (SSVariant, "sql_variant"),
        ];
        for (ty, name) in table {
            assert_eq!(type_name(ty), name, "{ty:?}");
        }
    }

    fn columns() -> Vec<Column> {
        vec![
            Column::new("id".to_owned(), ColumnType::Int4),
            Column::new("price".to_owned(), ColumnType::Money),
            Column::new("small".to_owned(), ColumnType::Money4),
            Column::new("ratio".to_owned(), ColumnType::Float8),
            Column::new(String::new(), ColumnType::NVarchar),
        ]
    }

    #[test]
    fn protocol_columns_keep_name_and_order_including_empty_names() {
        let cols = protocol_columns(&columns());
        let got: Vec<(&str, &str)> = cols
            .iter()
            .map(|c| (c.name.as_str(), c.ty.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                ("id", "int"),
                ("price", "money"),
                ("small", "smallmoney"),
                ("ratio", "float"),
                ("", "nvarchar"),
            ]
        );
        assert!(protocol_columns(&[]).is_empty());
    }

    #[test]
    fn column_kinds_marks_only_money_columns() {
        assert_eq!(
            column_kinds(&columns()),
            [
                Kind::Plain,
                Kind::Money,
                Kind::Money,
                Kind::Plain,
                Kind::Plain
            ]
        );
        assert!(column_kinds(&[]).is_empty());
    }

    #[test]
    fn convert_row_applies_the_kind_per_column() {
        let row = Row::builder()
            .column("id", ColumnType::Int4, ColumnData::I32(Some(1)))
            .column("price", ColumnType::Money, ColumnData::F64(Some(2.5)))
            .column("ratio", ColumnType::Float8, ColumnData::F64(Some(2.5)))
            .column("note", ColumnType::NVarchar, ColumnData::String(None))
            .build();
        let kinds = [Kind::Plain, Kind::Money, Kind::Plain, Kind::Plain];
        assert_eq!(
            convert_row(row, &kinds),
            [
                Some("1".to_owned()),
                Some("2.5000".to_owned()),
                Some("2.5".to_owned()),
                None
            ]
        );
    }

    #[test]
    fn convert_row_treats_missing_kinds_as_plain() {
        let row = Row::builder()
            .column("a", ColumnType::Float8, ColumnData::F64(Some(2.5)))
            .column("b", ColumnType::Float8, ColumnData::F64(Some(3.5)))
            .build();
        // `kinds` ngắn hơn số cột: cột thừa là Plain, không panic.
        assert_eq!(
            convert_row(row, &[Kind::Money]),
            [Some("2.5000".to_owned()), Some("3.5".to_owned())]
        );
        let empty = Row::builder().build();
        assert!(convert_row(empty, &[]).is_empty());
    }
}
