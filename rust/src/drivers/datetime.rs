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
mod tests {
    use super::*;

    fn trimmed(micros: u64) -> String {
        let mut s = String::new();
        write_micros_trimmed(&mut s, micros);
        s
    }

    #[test]
    fn write_micros_trimmed_pads_to_six_digits_then_drops_trailing_zeros() {
        assert_eq!(trimmed(100_000), "1");
        assert_eq!(trimmed(123_456), "123456");
        assert_eq!(trimmed(1), "000001");
        assert_eq!(trimmed(10), "00001");
        assert_eq!(trimmed(120_000), "12");
        assert_eq!(trimmed(999_999), "999999");
        // 0 không được dùng (người gọi bỏ phần lẻ), nhưng không được xoá số 0 có sẵn trong `out`.
        assert_eq!(trimmed(0), "");
        let mut s = String::from("10");
        write_micros_trimmed(&mut s, 0);
        assert_eq!(s, "10");
    }

    #[test]
    fn write_micros_trimmed_appends_without_touching_the_existing_text() {
        let mut s = String::from("12:00:00.");
        write_micros_trimmed(&mut s, 500_000);
        assert_eq!(s, "12:00:00.5");
        // Số 0 ở đầu phần micro giây là số liệu thật, không bị bỏ.
        let mut s = String::from("0");
        write_micros_trimmed(&mut s, 7);
        assert_eq!(s, "0000007");
    }

    fn date(unix_days: i64) -> String {
        let mut s = String::new();
        if write_date(&mut s, unix_days) {
            s.push_str(" BC");
        }
        s
    }

    fn time_micros(micros: i64) -> String {
        let mut s = String::new();
        write_time_micros(&mut s, micros);
        s
    }

    fn time_ticks(ticks: u64, scale: u8) -> String {
        let mut s = String::new();
        write_time_ticks(&mut s, ticks, scale);
        s
    }

    fn timestamp(unix_micros: i64, suffix: &str) -> String {
        let mut s = String::new();
        write_timestamp_micros(&mut s, unix_micros, suffix);
        s
    }

    // Lịch tham chiếu độc lập với `civil_from_days` (đếm từng năm/tháng, chậm nhưng hiển nhiên đúng).

    fn leap(y: i64) -> bool {
        (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    }

    fn month_len(y: i64, m: u32) -> u32 {
        match m {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            _ if leap(y) => 29,
            _ => 28,
        }
    }

    /// Số ngày từ 1970-01-01 của `(năm thiên văn, tháng, ngày)`.
    fn civil_days(year: i64, month: u32, day: u32) -> i64 {
        let mut days: i64 = 0;
        let mut y = 1970;
        while y < year {
            days += if leap(y) { 366 } else { 365 };
            y += 1;
        }
        while y > year {
            y -= 1;
            days -= if leap(y) { 366 } else { 365 };
        }
        for m in 1..month {
            days += i64::from(month_len(year, m));
        }
        days + i64::from(day) - 1
    }

    #[test]
    fn reference_calendar_matches_known_dates() {
        assert_eq!(civil_days(1970, 1, 1), 0);
        assert_eq!(civil_days(2000, 1, 1), 10_957);
        assert_eq!(civil_days(1, 1, 1), -719_162);
        assert_eq!(civil_days(1900, 1, 1), -25_567);
        assert_eq!(civil_days(2024, 2, 29), 19_782);
    }

    // ---- ngày mốc ----

    #[test]
    fn epoch_constants_point_at_the_right_dates() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(PG_EPOCH_UNIX_DAYS), "2000-01-01");
        assert_eq!(date(MSSQL_DATE_EPOCH_UNIX_DAYS), "0001-01-01");
        assert_eq!(date(MSSQL_DATETIME_EPOCH_UNIX_DAYS), "1900-01-01");
        assert_eq!(MICROS_PER_DAY, 24 * 3600 * 1_000_000);
    }

    #[test]
    fn boundary_dates() {
        assert_eq!(date(civil_days(1, 1, 1)), "0001-01-01");
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(10_957), "2000-01-01");
        assert_eq!(date(civil_days(9999, 12, 31)), "9999-12-31");
        assert_eq!(date(civil_days(9999, 12, 31) + 1), "10000-01-01");
        assert_eq!(date(-1), "1969-12-31");
    }

    #[test]
    fn leap_years_2000_1900_2024() {
        // 2000 chia hết cho 400: có 29/2. 1900 chia hết cho 100 mà không cho 400: không có.
        assert_eq!(date(civil_days(2000, 2, 29)), "2000-02-29");
        assert_eq!(date(civil_days(2000, 2, 29) + 1), "2000-03-01");
        assert_eq!(date(civil_days(1900, 2, 28)), "1900-02-28");
        assert_eq!(date(civil_days(1900, 2, 28) + 1), "1900-03-01");
        assert_eq!(date(civil_days(2024, 2, 29)), "2024-02-29");
        assert_eq!(date(civil_days(2024, 2, 29) + 1), "2024-03-01");
        // Năm nhuận có 366 ngày.
        assert_eq!(date(civil_days(2000, 12, 31)), "2000-12-31");
        assert_eq!(date(civil_days(2000, 12, 31) + 1), "2001-01-01");
        assert_eq!(date(civil_days(2023, 12, 31) + 1), "2024-01-01");
        assert_eq!(date(civil_days(2100, 2, 28) + 1), "2100-03-01");
    }

    #[test]
    fn every_day_from_year_1_to_9999_matches_independent_calendar() {
        // Đi từng ngày bằng lịch tự đếm và so với `civil_from_days` (3,65 triệu ngày).
        let (mut y, mut m, mut d) = (1_i64, 1_u32, 1_u32);
        let mut days = MSSQL_DATE_EPOCH_UNIX_DAYS;
        while y <= 9999 {
            assert_eq!(civil_from_days(days), (y, m, d), "day {days}");
            days += 1;
            d += 1;
            if d > month_len(y, m) {
                d = 1;
                m += 1;
                if m > 12 {
                    m = 1;
                    y += 1;
                }
            }
        }
        // Ngày kế tiếp sau 9999-12-31 là 10000-01-01.
        assert_eq!(civil_from_days(days), (10_000, 1, 1));
    }

    #[test]
    fn days_before_year_one_are_astronomical_years_and_shown_as_bc() {
        assert_eq!(civil_from_days(-719_163), (0, 12, 31));
        // Năm 0 thiên văn là 1 TCN (nhuận): PostgreSQL in `0001-12-31 BC`.
        assert_eq!(date(-719_163), "0001-12-31 BC");
        assert_eq!(date(civil_days(0, 1, 1)), "0001-01-01 BC");
        assert_eq!(date(civil_days(-1, 12, 31)), "0002-12-31 BC");
        // 1 TCN có 29/2 (năm thiên văn 0 chia hết cho 400).
        assert_eq!(date(civil_days(0, 2, 29)), "0001-02-29 BC");
        let mut s = String::new();
        assert!(write_date(&mut s, -719_163));
        assert!(!write_date(&mut s, -719_162));
    }

    #[test]
    fn postgres_range_ends_round_trip() {
        // PostgreSQL: từ 4714-11-24 BC (năm thiên văn -4713) tới 5874897-12-31.
        for (y, m, d, text) in [
            (-4713, 11, 24, "4714-11-24 BC"),
            (5_874_897, 12, 31, "5874897-12-31"),
        ] {
            let days = civil_days(y, m, d);
            assert_eq!(civil_from_days(days), (y, m, d));
            assert_eq!(date(days), text);
        }
    }

    #[test]
    fn extreme_i32_day_counts_do_not_panic() {
        // `date` của PostgreSQL là i32 ngày từ 2000-01-01.
        for raw in [i32::MIN, i32::MAX] {
            let days = PG_EPOCH_UNIX_DAYS + i64::from(raw);
            assert!(!date(days).is_empty());
        }
    }

    // ---- giờ ----

    #[test]
    fn time_of_day_formats() {
        assert_eq!(time_micros(0), "00:00:00");
        assert_eq!(time_micros(1_000_000), "00:00:01");
        assert_eq!(time_micros(3_661_000_000), "01:01:01");
        assert_eq!(time_micros(86_399_000_000), "23:59:59");
    }

    #[test]
    fn microseconds_drop_trailing_zeros_like_postgres() {
        assert_eq!(time_micros(1), "00:00:00.000001");
        assert_eq!(time_micros(10), "00:00:00.00001");
        assert_eq!(time_micros(500_000), "00:00:00.5");
        assert_eq!(time_micros(120_000), "00:00:00.12");
        assert_eq!(time_micros(123_456), "00:00:00.123456");
        assert_eq!(time_micros(86_399_999_999), "23:59:59.999999");
    }

    #[test]
    fn twenty_four_hundred_is_allowed() {
        assert_eq!(time_micros(MICROS_PER_DAY), "24:00:00");
    }

    #[test]
    fn corrupt_time_values_are_clamped_not_panicking() {
        assert_eq!(time_micros(MICROS_PER_DAY + 5_000_000), "24:00:00");
        assert_eq!(time_micros(i64::MAX), "24:00:00.775807");
        assert_eq!(time_micros(i64::MIN), "00:00:00.224192");
        assert_eq!(time_ticks(u64::MAX, 7), "24:00:00.9551615");
        // Số giây không vừa `i64` (chỉ có với dữ liệu hỏng): về 0 thay vì panic.
        assert_eq!(time_ticks(u64::MAX, 0), "00:00:00");
    }

    #[test]
    fn mssql_ticks_by_scale() {
        // `time(0)`: không có dấu chấm.
        assert_eq!(time_ticks(0, 0), "00:00:00");
        assert_eq!(time_ticks(86_399, 0), "23:59:59");
        // `time(3)`: mili giây, giữ số 0 cuối.
        assert_eq!(time_ticks(1_234, 3), "00:00:01.234");
        assert_eq!(time_ticks(1_200, 3), "00:00:01.200");
        assert_eq!(time_ticks(0, 3), "00:00:00.000");
        // `time(6)`: micro giây.
        assert_eq!(time_ticks(1, 6), "00:00:00.000001");
        // `time(7)`: 100 ns.
        assert_eq!(time_ticks(1, 7), "00:00:00.0000001");
        assert_eq!(time_ticks(10_000_000, 7), "00:00:01.0000000");
        assert_eq!(time_ticks(863_999_999_999, 7), "23:59:59.9999999");
        assert_eq!(time_ticks(123_456_789, 7), "00:00:12.3456789");
    }

    #[test]
    fn mssql_scale_above_seven_is_seven() {
        assert_eq!(time_ticks(1, 8), "00:00:00.0000001");
        assert_eq!(time_ticks(1, 255), "00:00:00.0000001");
    }

    // ---- timestamp ----

    #[test]
    fn timestamp_boundary_values() {
        assert_eq!(timestamp(0, ""), "1970-01-01 00:00:00");
        assert_eq!(timestamp(946_684_800_000_000, ""), "2000-01-01 00:00:00");
        assert_eq!(timestamp(-1, ""), "1969-12-31 23:59:59.999999");
        assert_eq!(timestamp(1, ""), "1970-01-01 00:00:00.000001");
        let year_one = MSSQL_DATE_EPOCH_UNIX_DAYS * MICROS_PER_DAY;
        assert_eq!(timestamp(year_one, ""), "0001-01-01 00:00:00");
        let last = civil_days(9999, 12, 31) * MICROS_PER_DAY + MICROS_PER_DAY - 1;
        assert_eq!(timestamp(last, ""), "9999-12-31 23:59:59.999999");
    }

    #[test]
    fn timestamptz_suffix_is_plus_00() {
        assert_eq!(timestamp(0, "+00"), "1970-01-01 00:00:00+00");
        assert_eq!(
            timestamp(PG_EPOCH_UNIX_DAYS * MICROS_PER_DAY + 123_000, "+00"),
            "2000-01-01 00:00:00.123+00"
        );
    }

    #[test]
    fn timestamp_suffix_passes_through_positive_and_negative_offsets() {
        assert_eq!(timestamp(0, "+07:00"), "1970-01-01 00:00:00+07:00");
        assert_eq!(timestamp(0, "-05:30"), "1970-01-01 00:00:00-05:30");
        assert_eq!(timestamp(0, " +14:00"), "1970-01-01 00:00:00 +14:00");
    }

    #[test]
    fn timestamp_bc_puts_bc_after_time_and_suffix() {
        let before_year_one = (MSSQL_DATE_EPOCH_UNIX_DAYS - 1) * MICROS_PER_DAY + 43_200_000_000;
        assert_eq!(timestamp(before_year_one, ""), "0001-12-31 12:00:00 BC");
        assert_eq!(
            timestamp(before_year_one, "+00"),
            "0001-12-31 12:00:00+00 BC"
        );
        assert_eq!(
            timestamp(before_year_one + 1, "+00"),
            "0001-12-31 12:00:00.000001+00 BC"
        );
        // Từ ngày đầu năm 1 CN trở đi thì không có BC.
        let year_one = MSSQL_DATE_EPOCH_UNIX_DAYS * MICROS_PER_DAY;
        assert_eq!(timestamp(year_one, "+00"), "0001-01-01 00:00:00+00");
    }

    #[test]
    fn timestamp_negative_micros_split_into_correct_day_and_time() {
        // Một micro giây trước 2000-01-01.
        let midnight = PG_EPOCH_UNIX_DAYS * MICROS_PER_DAY;
        assert_eq!(timestamp(midnight - 1, ""), "1999-12-31 23:59:59.999999");
        // Đúng nửa đêm là ngày mới 00:00:00, không phải 24:00:00 của ngày cũ.
        assert_eq!(timestamp(midnight, ""), "2000-01-01 00:00:00");
    }

    #[test]
    fn push_padded_pads_but_never_truncates() {
        let mut s = String::new();
        push_padded(&mut s, 7, 4);
        push_padded(&mut s, 12_345, 4);
        push_padded(&mut s, 0, 0);
        assert_eq!(s, "0007123450");
    }
}
