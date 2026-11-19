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
use crate::drivers::datetime::{MICROS_PER_DAY, PG_EPOCH_UNIX_DAYS, write_date, write_time_micros};
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
        // `"char"` 0 là chuỗi rỗng; byte >= 128 không phải UTF-8 hợp lệ một mình nên rơi về hex.
        Scalar::Char => match u8::try_from(pt::char_from_sql(raw)?) {
            Ok(0) => {}
            Ok(b) if b.is_ascii() => out.push(char::from(b)),
            _ => return Err(BadData),
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
            let digits = format!("{:06}", frac.unsigned_abs());
            out.push_str(digits.trim_end_matches('0'));
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
mod tests {
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
        // Byte >= 128 không phải UTF-8 hợp lệ khi đứng một mình.
        assert_hex_fallback(Scalar::Char, &[0xe9]);
        assert_hex_fallback(Scalar::Char, &[0x80]);
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
            0xa0, 0xee, 0xbc, 0x99, 0x9c, 0x0b, 0x4e, 0xf8, 0xbb, 0x6d, 0x6b, 0xb9, 0xbd, 0x38,
            0x0a, 0x11,
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
}
