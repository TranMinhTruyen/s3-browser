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
#[path = "../../../tests/unit/drivers/sqlserver/value.rs"]
mod tests;
