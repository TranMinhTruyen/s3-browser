//! Đổi giá trị ô PostgreSQL (định dạng nhị phân của giao thức) thành chuỗi y như dạng text mà
//! server sẽ in, và quyết định kiểu nào được đọc nhị phân.
//!
//! Vị trí trong luồng: `actor` lấy từng dòng thô từ `tokio-postgres`, gọi `cell` cho mỗi ô; `cell`
//! chọn hàm giải mã theo `Decoder` (tính một lần cho mỗi cột bằng `decoder_for`). Giải mã nhị
//! phân tránh việc server phải in text rồi ta phải parse lại, và cho phép ghi thẳng vào một
//! `String` đã cấp sẵn dung lượng.
//!
//! Quy tắc: kiểu nào có trong danh sách cho phép (`decoder_for` trả `Some`) thì đọc nhị phân;
//! chỉ cần một cột ngoài danh sách thì `actor` chạy cả câu bằng simple query (text, Q31=A), nên
//! ở đây không có nhánh "kiểu lạ". Việc giải mã nhị phân dùng hàm của `postgres-protocol`
//! (không tự viết lại), chỉ phần ghi chuỗi (số thực, numeric, interval, timetz, inet IPv6...)
//! là tự viết, vì thư viện không có hoặc in khác PostgreSQL.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `enum` mang dữ liệu (`Decoder::Array(Scalar)`) và `match` bắt buộc xét hết các nhánh.
//! - `?` trên `Result`: gặp `Err` thì thoát hàm ngay và trả lỗi đó (tương tự `if err != nil
//!   { return err }` của Go). Ở đây mọi lỗi giải mã gom thành một kiểu `BadData`.
//! - Hằng như `Type::INT4` dùng được làm mẫu trong `match` (so sánh theo giá trị).

use crate::drivers::common::hex;
use crate::drivers::datetime::{
    MICROS_PER_DAY, PG_EPOCH_UNIX_DAYS, write_date, write_micros_trimmed, write_time_micros,
};
use postgres_protocol::types as pt;
use std::fmt::{self, Write};
use std::net::IpAddr;
use tokio_postgres::types::{Kind, Type};

/// Kiểu đơn (không phải mảng) đọc được nhị phân.
#[derive(Clone, Copy)]
pub enum Scalar {
    Bool,
    Int2,
    Int4,
    Int8,
    Oid,
    Float4,
    Float8,
    Numeric,
    /// text, varchar, bpchar, name, unknown, xml, citext và enum (đều là chuỗi UTF-8).
    Text,
    /// `"char"`: đúng một byte.
    Char,
    Json,
    Jsonb,
    Bytea,
    Date,
    Time,
    TimeTz,
    Timestamp,
    TimestampTz,
    Interval,
    Uuid,
    Inet,
    Cidr,
    MacAddr,
    MacAddr8,
    /// `bit` và `varbit` có chung định dạng.
    Bit,
}

/// Cách giải mã một cột: kiểu đơn hoặc mảng của một kiểu đơn.
#[derive(Clone, Copy)]
pub enum Decoder {
    Scalar(Scalar),
    Array(Scalar),
}

/// Dữ liệu nhị phân sai định dạng; `cell` thay bằng chuỗi hex của dữ liệu thô thay vì báo lỗi.
pub struct BadData;

/// `?` tự đổi lỗi của `postgres-protocol` (Box<dyn Error>) thành `BadData` nhờ `From`.
impl From<Box<dyn std::error::Error + Sync + Send>> for BadData {
    fn from(_: Box<dyn std::error::Error + Sync + Send>) -> Self {
        BadData
    }
}

/// `?` trên `write!` (ghi vào `String` không thể lỗi nhưng `fmt::Write` vẫn trả `Result`).
impl From<fmt::Error> for BadData {
    fn from(_: fmt::Error) -> Self {
        BadData
    }
}

/// Kết quả của một hàm ghi chuỗi: `Ok(())` hoặc dữ liệu sai.
pub type Decoded = Result<(), BadData>;

/// Cách đọc nhị phân của kiểu cột; `None` nghĩa là kiểu ngoài danh sách (composite, range,
/// money, geometric, tsvector, extension...) và cả câu phải chạy bằng simple query.
pub fn decoder_for(ty: &Type) -> Option<Decoder> {
    match ty.kind() {
        Kind::Array(elem) => scalar_for(elem).map(Decoder::Array),
        Kind::Domain(base) => decoder_for(base),
        _ => scalar_for(ty).map(Decoder::Scalar),
    }
}

/// Kiểu đơn trong danh sách cho phép. Enum gửi nhị phân đúng bằng nhãn text; domain đọc như kiểu gốc.
fn scalar_for(ty: &Type) -> Option<Scalar> {
    match ty.kind() {
        Kind::Enum(_) => Some(Scalar::Text),
        Kind::Domain(base) => scalar_for(base),
        Kind::Simple => builtin(ty),
        _ => None,
    }
}

/// Bảng kiểu có sẵn của PostgreSQL (và `citext`, kiểu extension duy nhất nhận theo tên).
fn builtin(ty: &Type) -> Option<Scalar> {
    Some(match *ty {
        Type::BOOL => Scalar::Bool,
        Type::INT2 => Scalar::Int2,
        Type::INT4 => Scalar::Int4,
        Type::INT8 => Scalar::Int8,
        Type::OID => Scalar::Oid,
        Type::FLOAT4 => Scalar::Float4,
        Type::FLOAT8 => Scalar::Float8,
        Type::NUMERIC => Scalar::Numeric,
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::UNKNOWN | Type::XML => {
            Scalar::Text
        }
        Type::CHAR => Scalar::Char,
        Type::JSON => Scalar::Json,
        Type::JSONB => Scalar::Jsonb,
        Type::BYTEA => Scalar::Bytea,
        Type::DATE => Scalar::Date,
        Type::TIME => Scalar::Time,
        Type::TIMETZ => Scalar::TimeTz,
        Type::TIMESTAMP => Scalar::Timestamp,
        Type::TIMESTAMPTZ => Scalar::TimestampTz,
        Type::INTERVAL => Scalar::Interval,
        Type::UUID => Scalar::Uuid,
        Type::INET => Scalar::Inet,
        Type::CIDR => Scalar::Cidr,
        Type::MACADDR => Scalar::MacAddr,
        Type::MACADDR8 => Scalar::MacAddr8,
        Type::BIT | Type::VARBIT => Scalar::Bit,
        _ if ty.name() == "citext" => Scalar::Text,
        _ => return None,
    })
}

/// Đổi một ô nhị phân thành chuỗi. Dữ liệu sai định dạng (không xảy ra với server đúng) hiện
/// thành hex của dữ liệu thô để người dùng vẫn thấy được, không làm hỏng cả trang.
pub fn cell(dec: Decoder, raw: &[u8]) -> String {
    // Cấp sẵn đúng cỡ cho kiểu chuỗi/bytea, kiểu số ngắn dùng 32 byte; tránh `String` phải nới.
    let capacity = match dec {
        Decoder::Scalar(Scalar::Text | Scalar::Json | Scalar::Jsonb) => raw.len(),
        Decoder::Scalar(Scalar::Bytea) => raw.len() * 2 + 2,
        Decoder::Scalar(_) => 32,
        Decoder::Array(_) => raw.len() * 2,
    };
    let mut out = String::with_capacity(capacity);
    let decoded = match dec {
        Decoder::Scalar(sc) => write_scalar(&mut out, sc, raw),
        Decoder::Array(sc) => super::array::write_array(&mut out, sc, raw),
    };
    if decoded.is_err() { hex(raw) } else { out }
}

/// Ghi một giá trị đơn theo dạng text của PostgreSQL.
pub fn write_scalar(out: &mut String, sc: Scalar, raw: &[u8]) -> Decoded {
    match sc {
        Scalar::Bool => out.push(if pt::bool_from_sql(raw)? { 't' } else { 'f' }),
        Scalar::Int2 => push_int(out, pt::int2_from_sql(raw)?),
        Scalar::Int4 => push_int(out, pt::int4_from_sql(raw)?),
        Scalar::Int8 => push_int(out, pt::int8_from_sql(raw)?),
        Scalar::Oid => push_int(out, pt::oid_from_sql(raw)?),
        Scalar::Float4 => write_f32(out, pt::float4_from_sql(raw)?)?,
        Scalar::Float8 => write_f64(out, pt::float8_from_sql(raw)?)?,
        Scalar::Numeric => write_numeric(out, raw)?,
        Scalar::Text | Scalar::Json => out.push_str(pt::text_from_sql(raw)?),
        // `"char"` 0 là chuỗi rỗng; byte >= 128 không phải UTF-8 hợp lệ một mình nên in `\ooo`
        // (bát phân 3 chữ số) như server.
        Scalar::Char => match pt::char_from_sql(raw)?.cast_unsigned() {
            0 => {}
            b if b.is_ascii() => out.push(char::from(b)),
            b => {
                out.push('\\');
                for shift in [6, 3, 0] {
                    out.push(char::from(b'0' + (b >> shift & 7)));
                }
            }
        },
        // Byte đầu của jsonb là số phiên bản (luôn 1), phần còn lại là JSON text.
        Scalar::Jsonb => match raw.split_first() {
            Some((1, text)) => out.push_str(pt::text_from_sql(text)?),
            _ => return Err(BadData),
        },
        Scalar::Bytea => write_bytea(out, pt::bytea_from_sql(raw)),
        Scalar::Date => write_date_value(out, pt::date_from_sql(raw)?),
        Scalar::Time => write_time_micros(out, pt::time_from_sql(raw)?),
        Scalar::TimeTz => write_timetz(out, raw)?,
        Scalar::Timestamp => write_timestamp(out, pt::timestamp_from_sql(raw)?, ""),
        // `timestamptz` luôn in theo UTC (`+00`), không phụ thuộc múi giờ của session (Q32=A).
        Scalar::TimestampTz => write_timestamp(out, pt::timestamp_from_sql(raw)?, "+00"),
        Scalar::Interval => write_interval(out, raw)?,
        Scalar::Uuid => write_uuid(out, &pt::uuid_from_sql(raw)?),
        Scalar::Inet => write_inet(out, raw, false)?,
        Scalar::Cidr => write_inet(out, raw, true)?,
        Scalar::MacAddr => write_hex_pairs(out, &pt::macaddr_from_sql(raw)?),
        Scalar::MacAddr8 => {
            if raw.len() != 8 {
                return Err(BadData);
            }
            write_hex_pairs(out, raw);
        }
        Scalar::Bit => {
            let bits = pt::varbit_from_sql(raw)?;
            let bytes = bits.bytes();
            for i in 0..bits.len() {
                // Bit đầu tiên là bit cao nhất của byte đầu tiên.
                let byte = bytes.get(i / 8).copied().ok_or(BadData)?;
                out.push(if byte & (0x80 >> (i % 8)) != 0 {
                    '1'
                } else {
                    '0'
                });
            }
        }
    }
    Ok(())
}

/// Ghi số nguyên bằng `itoa` (nhanh hơn `format!`, không cấp phát).
fn push_int<I: itoa::Integer>(out: &mut String, v: I) {
    out.push_str(itoa::Buffer::new().format(v));
}

/// Ghi chữ số hex thường của từng byte, không có dấu phân cách (dùng cho `bytea` sau tiền tố `\x`).
fn push_hex(out: &mut String, bytes: &[u8]) {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for &b in bytes {
        out.push(char::from(DIGITS[usize::from(b >> 4)]));
        out.push(char::from(DIGITS[usize::from(b & 0x0f)]));
    }
}

/// `bytea` dạng hex của PostgreSQL: `\x` rồi hex thường.
fn write_bytea(out: &mut String, bytes: &[u8]) {
    out.push_str("\\x");
    push_hex(out, bytes);
}

/// `macaddr`/`macaddr8`: các byte hex thường cách nhau bằng `:`.
fn write_hex_pairs(out: &mut String, bytes: &[u8]) {
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 {
            out.push(':');
        }
        push_hex(out, std::slice::from_ref(b));
    }
}

/// `uuid`: 8-4-4-4-12 chữ số hex thường.
fn write_uuid(out: &mut String, bytes: &[u8; 16]) {
    for (i, b) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            out.push('-');
        }
        push_hex(out, std::slice::from_ref(b));
    }
}

// ---- ngày giờ ----

/// `date`: số ngày kể từ 2000-01-01; `i32::MAX`/`MIN` là `infinity`/`-infinity`.
fn write_date_value(out: &mut String, days: i32) {
    match days {
        i32::MAX => out.push_str("infinity"),
        i32::MIN => out.push_str("-infinity"),
        _ => {
            if write_date(out, i64::from(days) + PG_EPOCH_UNIX_DAYS) {
                out.push_str(" BC");
            }
        }
    }
}

/// `timestamp`/`timestamptz`: micro giây kể từ 2000-01-01 00:00:00. Tự tách ngày/giờ (thay vì
/// gọi `write_timestamp_micros`) vì cộng mốc 2000 vào micro giây có thể tràn `i64` ở cuối
/// miền giá trị; cộng vào số ngày thì không.
fn write_timestamp(out: &mut String, micros: i64, suffix: &str) {
    match micros {
        i64::MAX => out.push_str("infinity"),
        i64::MIN => out.push_str("-infinity"),
        _ => {
            let days = micros.div_euclid(MICROS_PER_DAY) + PG_EPOCH_UNIX_DAYS;
            let bc = write_date(out, days);
            out.push(' ');
            write_time_micros(out, micros.rem_euclid(MICROS_PER_DAY));
            out.push_str(suffix);
            // PostgreSQL đặt ` BC` sau cùng, sau cả múi giờ.
            if bc {
                out.push_str(" BC");
            }
        }
    }
}

/// `timetz`: 8 byte micro giây trong ngày + 4 byte múi giờ tính bằng giây về phía TÂY UTC
/// (ngược dấu với cách viết `+07`), nên dấu in ra là `+` khi múi giờ <= 0.
fn write_timetz(out: &mut String, raw: &[u8]) -> Decoded {
    let (time, zone) = raw.split_at_checked(8).ok_or(BadData)?;
    let micros = i64::from_be_bytes(time.try_into().map_err(|_| BadData)?);
    let zone = i32::from_be_bytes(zone.try_into().map_err(|_| BadData)?);
    write_time_micros(out, micros);
    out.push(if zone <= 0 { '+' } else { '-' });
    let secs = zone.unsigned_abs();
    let (hour, min, sec) = (secs / 3600, secs / 60 % 60, secs % 60);
    push_2(out, hour);
    if min != 0 || sec != 0 {
        out.push(':');
        push_2(out, min);
    }
    if sec != 0 {
        out.push(':');
        push_2(out, sec);
    }
    Ok(())
}

/// Ghi `n` thành ít nhất 2 chữ số.
fn push_2(out: &mut String, n: u32) {
    if n < 10 {
        out.push('0');
    }
    push_int(out, n);
}

/// `interval` theo kiểu `postgres` (IntervalStyle mặc định), mô phỏng `EncodeInterval` của
/// PostgreSQL: các phần `year`, `mon`, `day` chỉ in khi khác 0, dấu `+` chỉ hiện khi phần trước
/// âm; phần giờ `HH:MM:SS[.ffffff]` in khi là phần duy nhất hoặc khác 0. Nhị phân: 8 byte micro
/// giây, 4 byte ngày, 4 byte tháng.
fn write_interval(out: &mut String, raw: &[u8]) -> Decoded {
    let raw: &[u8; 16] = raw.try_into().map_err(|_| BadData)?;
    let time = i64::from_be_bytes([
        raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
    ]);
    let days = i32::from_be_bytes([raw[8], raw[9], raw[10], raw[11]]);
    let months = i32::from_be_bytes([raw[12], raw[13], raw[14], raw[15]]);
    // PostgreSQL 17 có `interval` vô cực: cả ba phần ở giá trị lớn/nhỏ nhất.
    match (time, days, months) {
        (i64::MAX, i32::MAX, i32::MAX) => {
            out.push_str("infinity");
            return Ok(());
        }
        (i64::MIN, i32::MIN, i32::MIN) => {
            out.push_str("-infinity");
            return Ok(());
        }
        _ => {}
    }

    let mut is_zero = true;
    let mut is_before = false;
    for (value, unit) in [(months / 12, "year"), (months % 12, "mon"), (days, "day")] {
        if value == 0 {
            continue;
        }
        if !is_zero {
            out.push(' ');
        }
        if is_before && value > 0 {
            out.push('+');
        }
        push_int(out, value);
        out.push(' ');
        out.push_str(unit);
        if value != 1 {
            out.push('s');
        }
        // Mỗi phần khác 0 quyết định dấu `+` của phần kế tiếp.
        is_before = value < 0;
        is_zero = false;
    }

    let hour = time / 3_600_000_000;
    let min = time % 3_600_000_000 / 60_000_000;
    let sec = time % 60_000_000 / 1_000_000;
    let frac = time % 1_000_000;
    if is_zero || time != 0 {
        if !is_zero {
            out.push(' ');
        }
        if time < 0 {
            out.push('-');
        } else if is_before {
            out.push('+');
        }
        push_padded_2(out, hour.unsigned_abs());
        out.push(':');
        push_padded_2(out, min.unsigned_abs());
        out.push(':');
        push_padded_2(out, sec.unsigned_abs());
        if frac != 0 {
            out.push('.');
            write_micros_trimmed(out, frac.unsigned_abs());
        }
    }
    Ok(())
}

/// Ghi `n` (có thể > 99, ví dụ hơn 99 giờ) với ít nhất 2 chữ số.
fn push_padded_2(out: &mut String, n: u64) {
    if n < 10 {
        out.push('0');
    }
    push_int(out, n);
}

// ---- inet / cidr ----

/// `inet`/`cidr`. PostgreSQL in `/bits` khi `bits` khác độ dài đầy đủ của địa chỉ (inet) hoặc
/// luôn luôn (cidr). IPv6 in theo thuật toán của BIND/PostgreSQL (khác `Ipv6Addr::to_string`
/// của Rust ở dạng IPv4 nhúng, ví dụ `::1:2` là `::0.1.0.2`), nên tự viết.
fn write_inet(out: &mut String, raw: &[u8], is_cidr: bool) -> Decoded {
    let inet = pt::inet_from_sql(raw)?;
    let bits = inet.netmask();
    let full_bits = match inet.addr() {
        IpAddr::V4(a) => {
            write_ipv4(out, a.octets());
            32
        }
        IpAddr::V6(a) => {
            write_ipv6(out, &a.octets());
            128
        }
    };
    if is_cidr || bits != full_bits {
        out.push('/');
        push_int(out, bits);
    }
    Ok(())
}

/// IPv4 dạng chấm.
fn write_ipv4(out: &mut String, octets: [u8; 4]) {
    for (i, o) in octets.iter().enumerate() {
        if i > 0 {
            out.push('.');
        }
        push_int(out, *o);
    }
}

/// IPv6: rút gọn chuỗi số 0 dài nhất (>= 2 nhóm, lấy chuỗi đầu nếu bằng nhau); `::` + 4 byte
/// cuối dạng IPv4 khi địa chỉ là `::a.b.c.d` hoặc `::ffff:a.b.c.d`. Từng bước theo `inet_net_ntop`.
fn write_ipv6(out: &mut String, octets: &[u8; 16]) {
    let mut words = [0u16; 8];
    for (w, pair) in words.iter_mut().zip(octets.as_chunks::<2>().0) {
        *w = u16::from_be_bytes(*pair);
    }
    // Chuỗi số 0 tốt nhất: (vị trí đầu, độ dài).
    let (mut best_base, mut best_len) = (0, 0);
    let (mut run_base, mut run_len) = (0, 0);
    for (i, &w) in words.iter().enumerate() {
        if w == 0 {
            if run_len == 0 {
                run_base = i;
            }
            run_len += 1;
            if run_len > best_len {
                (best_base, best_len) = (run_base, run_len);
            }
        } else {
            run_len = 0;
        }
    }
    // Một nhóm 0 đơn lẻ không được rút gọn.
    if best_len < 2 {
        best_len = 0;
    }
    let mut i = 0;
    while i < 8 {
        if best_len > 0 && (best_base..best_base + best_len).contains(&i) {
            // Đầu chuỗi 0: ghi `:`; các nhóm còn lại của chuỗi bỏ qua.
            if i == best_base {
                out.push(':');
            }
            i += 1;
            continue;
        }
        if i != 0 {
            out.push(':');
        }
        let embedded_v4 =
            best_base == 0 && (best_len == 6 || (best_len == 5 && words[5] == 0xffff));
        if i == 6 && embedded_v4 {
            write_ipv4(out, [octets[12], octets[13], octets[14], octets[15]]);
            return;
        }
        // `{:x}` của số nguyên: hex thường không số 0 đứng đầu.
        let _ = write!(out, "{:x}", words[i]);
        i += 1;
    }
    // Chuỗi 0 chạy tới cuối: thêm `:` thứ hai của `::`.
    if best_len > 0 && best_base + best_len == 8 {
        out.push(':');
    }
}

// ---- số ----

/// `numeric`: 8 byte đầu là số nhóm (ndigits), trọng số nhóm đầu (weight), dấu và số chữ số
/// thập phân hiển thị (dscale); sau đó là ndigits nhóm 4 chữ số thập phân (cơ số 10000).
/// Dấu: 0x0000 dương, 0x4000 âm, 0xC000 NaN, 0xD000 +Infinity, 0xF000 -Infinity.
fn write_numeric(out: &mut String, raw: &[u8]) -> Decoded {
    let (head, body) = raw.split_at_checked(8).ok_or(BadData)?;
    let ndigits = usize::from(u16::from_be_bytes([head[0], head[1]]));
    let weight = i32::from(i16::from_be_bytes([head[2], head[3]]));
    let sign = u16::from_be_bytes([head[4], head[5]]);
    let dscale = usize::from(u16::from_be_bytes([head[6], head[7]]));
    if body.len() != ndigits * 2 {
        return Err(BadData);
    }
    match sign {
        0x0000 => {}
        0x4000 => out.push('-'),
        0xC000 => {
            out.push_str("NaN");
            return Ok(());
        }
        0xD000 => {
            out.push_str("Infinity");
            return Ok(());
        }
        0xF000 => {
            out.push_str("-Infinity");
            return Ok(());
        }
        _ => return Err(BadData),
    }
    // Nhóm thứ `i` (nhóm bị thiếu ở hai đầu coi là 0).
    let group = |i: i32| -> u16 {
        usize::try_from(i)
            .ok()
            .and_then(|i| body.get(i * 2..i * 2 + 2))
            .map_or(0, |b| u16::from_be_bytes([b[0], b[1]]))
    };
    // Phần nguyên: nhóm 0..=weight, nhóm đầu không đệm số 0, các nhóm sau đệm đủ 4 chữ số.
    if weight < 0 {
        out.push('0');
    } else {
        for i in 0..=weight {
            if i == 0 {
                push_int(out, group(i));
            } else {
                push_group(out, group(i), 4);
            }
        }
    }
    // Phần thập phân: đúng `dscale` chữ số, nhóm thứ weight+1 trở đi, nhóm cuối cắt cho vừa.
    if dscale > 0 {
        out.push('.');
        let mut remaining = dscale;
        let mut i = weight + 1;
        while remaining > 0 {
            let take = remaining.min(4);
            push_group(out, group(i), take);
            remaining -= take;
            i += 1;
        }
    }
    Ok(())
}

/// Ghi `take` chữ số đầu của nhóm `g` viết đủ 4 chữ số (`take` = 4 là cả nhóm).
fn push_group(out: &mut String, g: u16, take: usize) {
    let digits = [
        b'0' + u8::try_from(g / 1000 % 10).unwrap_or(0),
        b'0' + u8::try_from(g / 100 % 10).unwrap_or(0),
        b'0' + u8::try_from(g / 10 % 10).unwrap_or(0),
        b'0' + u8::try_from(g % 10).unwrap_or(0),
    ];
    for &d in &digits[..take] {
        out.push(char::from(d));
    }
}

/// Bộ đệm trên stack cho `write!` (không cấp phát); đủ cho chuỗi `{:e}` của f32/f64.
struct Stack {
    buf: [u8; 40],
    len: usize,
}

impl Stack {
    fn new() -> Self {
        Self {
            buf: [0; 40],
            len: 0,
        }
    }

    fn bytes(&self) -> &[u8] {
        &self.buf[..self.len]
    }
}

impl fmt::Write for Stack {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let end = self.len + s.len();
        self.buf
            .get_mut(self.len..end)
            .ok_or(fmt::Error)?
            .copy_from_slice(s.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// `float8` theo dạng text của PostgreSQL 12+ (số chữ số ngắn nhất đọc lại đúng giá trị).
fn write_f64(out: &mut String, v: f64) -> Decoded {
    if let Some(special) = non_finite(v.is_nan(), v.is_infinite(), v.is_sign_negative()) {
        out.push_str(special);
        return Ok(());
    }
    let mut buf = Stack::new();
    write!(buf, "{:e}", v.abs())?;
    write_shortest(out, buf.bytes(), v.is_sign_negative(), F64_MAX_FIXED_EXP)
}

/// `float4`: giống `float8` nhưng chữ số ngắn nhất tính theo độ chính xác của f32.
fn write_f32(out: &mut String, v: f32) -> Decoded {
    if let Some(special) = non_finite(v.is_nan(), v.is_infinite(), v.is_sign_negative()) {
        out.push_str(special);
        return Ok(());
    }
    let mut buf = Stack::new();
    write!(buf, "{:e}", v.abs())?;
    write_shortest(out, buf.bytes(), v.is_sign_negative(), F32_MAX_FIXED_EXP)
}

/// Chuỗi của NaN và vô cực (`None` với số hữu hạn).
fn non_finite(nan: bool, inf: bool, negative: bool) -> Option<&'static str> {
    if nan {
        Some("NaN")
    } else if inf {
        Some(if negative { "-Infinity" } else { "Infinity" })
    } else {
        None
    }
}

/// Số mũ thập phân lớn nhất còn viết ký hiệu thường (không có `e+XX`): PostgreSQL đặt 14 cho
/// `float8` nhưng chỉ 5 cho `float4` (đo bằng cách so với text của server).
const F64_MAX_FIXED_EXP: i32 = 14;
const F32_MAX_FIXED_EXP: i32 = 5;

/// Dựng chuỗi PostgreSQL từ dạng khoa học của Rust (`d.ddde<exp>`): ký hiệu thường khi số mũ
/// thập phân nằm trong `-4..=max_fixed`, ngược lại `d.ddde+XX` / `d.ddde-XX` (ít nhất 2 chữ số mũ).
fn write_shortest(out: &mut String, repr: &[u8], negative: bool, max_fixed: i32) -> Decoded {
    let e_at = repr.iter().position(|&b| b == b'e').ok_or(BadData)?;
    let exp: i32 = std::str::from_utf8(&repr[e_at + 1..])
        .ok()
        .and_then(|s| s.parse().ok())
        .ok_or(BadData)?;
    // Gom các chữ số của phần định trị, bỏ dấu `.`.
    let mut digits = [0u8; 24];
    let mut n = 0;
    for &b in repr[..e_at].iter().filter(|&&b| b != b'.') {
        *digits.get_mut(n).ok_or(BadData)? = b;
        n += 1;
    }
    let digits = &digits[..n];
    if negative {
        out.push('-');
    }
    let push_digits = |out: &mut String, d: &[u8]| d.iter().for_each(|&b| out.push(char::from(b)));
    match exp {
        0.. if exp <= max_fixed => {
            let int_len = usize::try_from(exp).map_err(|_| BadData)? + 1;
            if digits.len() <= int_len {
                push_digits(out, digits);
                (digits.len()..int_len).for_each(|_| out.push('0'));
            } else {
                push_digits(out, &digits[..int_len]);
                out.push('.');
                push_digits(out, &digits[int_len..]);
            }
        }
        -4..=-1 => {
            out.push_str("0.");
            (1..-exp).for_each(|_| out.push('0'));
            push_digits(out, digits);
        }
        _ => {
            push_digits(out, &digits[..1]);
            if digits.len() > 1 {
                out.push('.');
                push_digits(out, &digits[1..]);
            }
            out.push('e');
            out.push(if exp < 0 { '-' } else { '+' });
            push_2(out, exp.unsigned_abs());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/postgres/value.rs"]
mod tests;
