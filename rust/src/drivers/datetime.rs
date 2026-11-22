//! Đổi số ngày/micro giây/ticks thành chuỗi ngày giờ ISO, không dùng `chrono`.
//!
//! Vị trí trong luồng: driver PostgreSQL và SQL Server giải mã giá trị ngày giờ ra số (số ngày
//! kể từ một mốc, micro giây trong ngày...) rồi gọi các hàm ở đây để ghi chuỗi vào `String`
//! của ô. Mọi hàm ghi thẳng vào `&mut String` (không `format!`) vì mỗi ô chỉ được cấp phát
//! đúng một lần.
//!
//! Mốc thời gian dùng chung là `1970-01-01` ("ngày unix", ngày số 0). Mỗi DB có mốc riêng nên
//! driver cộng thêm hằng `*_UNIX_DAYS` bên dưới trước khi gọi.

/// Số ngày từ 1970-01-01 tới 2000-01-01, mốc `date`/`timestamp` của PostgreSQL.
pub const PG_EPOCH_UNIX_DAYS: i64 = 10_957;
/// Số ngày từ 1970-01-01 lùi về 0001-01-01 (âm), mốc `date`/`datetime2` của SQL Server.
pub const MSSQL_DATE_EPOCH_UNIX_DAYS: i64 = -719_162;
/// Số ngày từ 1970-01-01 lùi về 1900-01-01 (âm), mốc `datetime`/`smalldatetime` của SQL Server.
pub const MSSQL_DATETIME_EPOCH_UNIX_DAYS: i64 = -25_567;
/// Số micro giây trong một ngày.
pub const MICROS_PER_DAY: i64 = 86_400_000_000;

/// Đổi số ngày kể từ 1970-01-01 (có thể âm) thành `(năm, tháng, ngày)` theo lịch Gregorian
/// (không có năm 0 của lịch thường nên năm ≤ 0 là năm thiên văn: 0 = 1 TCN, -1 = 2 TCN...).
///
/// Thuật toán `civil_from_days` của Howard Hinnant: chia thời gian thành các "kỷ" 400 năm
/// (146097 ngày) bắt đầu từ 1 tháng 3 để ngày nhuận luôn nằm cuối năm; chỉ dùng phép
/// nguyên, đúng với mọi `i64` hợp lý.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Dời mốc về 0000-03-01.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    // Ngày trong kỷ, 0..=146096.
    let doe = z.rem_euclid(146_097);
    // Năm trong kỷ, 0..=399.
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    // Tháng tính từ tháng 3 (0 = tháng 3, 11 = tháng 2).
    let mp = (5 * doy + 2) / 153;
    // Hai giá trị dưới nằm trong 1..=31 và 1..=12 nên đổi sang `u32` không mất dữ liệu.
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Ghi `n` thành đúng 2 chữ số (`n` < 100).
fn push_2(out: &mut String, n: u32) {
    out.push(char::from(b'0' + u8::try_from(n / 10 % 10).unwrap_or(0)));
    out.push(char::from(b'0' + u8::try_from(n % 10).unwrap_or(0)));
}

/// Ghi `n` với ít nhất `width` chữ số (bù số 0 bên trái).
fn push_padded(out: &mut String, n: u64, width: usize) {
    // `itoa` ghi số vào buffer trên stack, không cấp phát String.
    let mut buf = itoa::Buffer::new();
    let digits = buf.format(n);
    for _ in digits.len()..width {
        out.push('0');
    }
    out.push_str(digits);
}

/// Ghi `YYYY-MM-DD` cho số ngày kể từ 1970-01-01. Năm thiên văn ≤ 0 (trước công nguyên) ghi
/// thành số năm TCN (`1 - năm`) như PostgreSQL và trả `true`; người gọi nối ` BC` vào cuối
/// (sau cả phần giờ nếu có).
pub fn write_date(out: &mut String, unix_days: i64) -> bool {
    let (year, month, day) = civil_from_days(unix_days);
    let bc = year <= 0;
    let shown = if bc { 1 - year } else { year };
    push_padded(out, shown.unsigned_abs(), 4);
    out.push('-');
    push_2(out, month);
    out.push('-');
    push_2(out, day);
    bc
}

/// Ghi `HH:MM:SS`; nếu `micros_of_day` có phần lẻ giây thì thêm `.ffffff` bỏ các số 0 cuối
/// (đúng cách PostgreSQL in `time`/`timestamp`). `micros_of_day` nằm trong `0..=86_400_000_000`
/// (cho phép đúng 24:00:00 của PostgreSQL).
pub fn write_time_micros(out: &mut String, micros_of_day: i64) {
    let total_secs = micros_of_day.div_euclid(1_000_000);
    let micros = micros_of_day.rem_euclid(1_000_000);
    write_hms(out, total_secs);
    if micros != 0 {
        out.push('.');
        write_micros_trimmed(out, micros.unsigned_abs());
    }
}

/// Ghi 6 chữ số của phần micro giây (`micros` trong `1..1_000_000`) rồi bỏ các số 0 cuối, thẳng
/// vào `out` (không String trung gian). Chỉ bỏ các số 0 do hàm này ghi, không đụng phần có sẵn
/// trong `out` (ví dụ `"10"` + 0 vẫn là `"10"`).
pub fn write_micros_trimmed(out: &mut String, micros: u64) {
    let start = out.len();
    push_padded(out, micros, 6);
    while out.len() > start && out.ends_with('0') {
        out.pop();
    }
}

/// Ghi `HH:MM:SS` cho số giây trong ngày.
fn write_hms(out: &mut String, total_secs: i64) {
    // Kẹp vào 0..=86400 (cho phép 24:00:00); giá trị ngoài khoảng là dữ liệu hỏng, không panic.
    let secs = u32::try_from(total_secs.clamp(0, 86_400)).unwrap_or(0);
    push_2(out, secs / 3_600);
    out.push(':');
    push_2(out, secs / 60 % 60);
    out.push(':');
    push_2(out, secs % 60);
}

/// Ghi giờ của SQL Server `time(n)`/`datetime2(n)`: `ticks` là số đơn vị 10^-`scale` giây kể từ
/// 00:00:00, kết quả có đúng `scale` chữ số lẻ (không có dấu `.` khi `scale = 0`), như SQL Server.
/// `scale` lớn hơn 7 bị coi là 7 (giới hạn của SQL Server).
pub fn write_time_ticks(out: &mut String, ticks: u64, scale: u8) {
    let scale = scale.min(7);
    let unit = 10u64.pow(u32::from(scale));
    write_hms(out, i64::try_from(ticks / unit).unwrap_or(0));
    if scale > 0 {
        out.push('.');
        push_padded(out, ticks % unit, usize::from(scale));
    }
}

/// Ghi `YYYY-MM-DD HH:MM:SS[.ffffff]<suffix>[ BC]` cho số micro giây kể từ 1970-01-01 00:00:00.
/// Dùng cho `timestamp` của PostgreSQL (`suffix` rỗng) và `timestamptz` (`suffix` = `+00`).
/// PostgreSQL đặt ` BC` (trước công nguyên) sau cùng, sau cả hậu tố múi giờ, nên hàm ghi
/// `suffix` trước rồi mới tới ` BC`.
pub fn write_timestamp_micros(out: &mut String, unix_micros: i64, suffix: &str) {
    let days = unix_micros.div_euclid(MICROS_PER_DAY);
    let micros_of_day = unix_micros.rem_euclid(MICROS_PER_DAY);
    let bc = write_date(out, days);
    out.push(' ');
    write_time_micros(out, micros_of_day);
    out.push_str(suffix);
    if bc {
        out.push_str(" BC");
    }
}

#[cfg(test)]
#[path = "../../tests/unit/drivers/datetime.rs"]
mod tests;
