//! Định dạng chuỗi cho giá trị ô SQLite (REAL, BLOB).
//!
//! Vị trí trong luồng: `raw::Stmt::cell` đọc ô từ SQLite theo kiểu lưu thực rồi gọi các hàm ở
//! đây cho REAL/BLOB; kết quả là chuỗi đưa thẳng vào JSON (NULL là `None`, xử lý ở `raw`).

/// REAL giữ dấu `.0` như SQLite (`1.0`), không dùng ký hiệu mũ.
pub(super) fn real(v: f64) -> String {
    if v.is_nan() {
        "NaN".to_owned()
    } else if v.is_infinite() {
        if v > 0.0 { "Inf" } else { "-Inf" }.to_owned()
    } else if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{v:.1}")
    } else {
        v.to_string()
    }
}

/// BLOB -> chuỗi hex, ví dụ `[0x0a, 0xff]` -> `0x0aff`.
/// Một lần cấp phát đúng cỡ: `0x` + 2 ký tự mỗi byte (tránh `format!` cho mỗi byte, BLOB có thể lớn).
pub(super) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2 + 2);
    s.push_str("0x");
    for &b in bytes {
        s.push(DIGITS[usize::from(b >> 4)] as char);
        s.push(DIGITS[usize::from(b & 0x0f)] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{hex, real};

    /// Hex in đủ mọi byte, kể cả mảng rỗng.
    #[test]
    fn hex_full() {
        assert_eq!(hex(&[]), "0x");
        assert_eq!(hex(&[0x00, 0xff, 0x10, 0xab]), "0x00ff10ab");
    }

    /// REAL giữ `.0`, không ký hiệu mũ, xử lý NaN/vô cực.
    #[test]
    fn real_format() {
        assert_eq!(real(1.0), "1.0");
        assert_eq!(real(-3.0), "-3.0");
        assert_eq!(real(1.5), "1.5");
        assert_eq!(real(0.1), "0.1");
        assert_eq!(real(1e20), "100000000000000000000");
        assert_eq!(real(f64::NAN), "NaN");
        assert_eq!(real(f64::INFINITY), "Inf");
        assert_eq!(real(f64::NEG_INFINITY), "-Inf");
    }

    /// Biên 1e15: dưới ngưỡng giữ `.0`, từ ngưỡng trở lên in số nguyên không `.0`; -0.0 giữ dấu.
    #[test]
    fn real_boundaries() {
        assert_eq!(real(999_999_999_999_999.0), "999999999999999.0");
        assert_eq!(real(-999_999_999_999_999.0), "-999999999999999.0");
        assert_eq!(real(1e15), "1000000000000000");
        assert_eq!(real(-1e15), "-1000000000000000");
        assert_eq!(real(0.0), "0.0");
        assert_eq!(real(-0.0), "-0.0");
        assert_eq!(real(1e-7), "0.0000001");
        assert_eq!(real(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(real(123_456_789.125), "123456789.125");
        // Không bao giờ có ký hiệu mũ, kể cả số cực nhỏ/lớn.
        for v in [
            f64::MIN_POSITIVE,
            5e-324,
            f64::MAX,
            f64::MIN,
            1e300,
            1.5e-300,
        ] {
            let s = real(v);
            assert!(!s.contains(['e', 'E']), "{v:e} -> {s}");
            assert_eq!(s.parse::<f64>().unwrap(), v, "{s}");
        }
    }

    /// Hex dùng chữ thường, đủ 256 giá trị byte, độ dài đúng `2 + 2n`.
    #[test]
    fn hex_all_byte_values() {
        let all: Vec<u8> = (0..=255).collect();
        let h = hex(&all);
        assert_eq!(h.len(), 2 + 512);
        assert!(h.starts_with("0x000102"));
        assert!(h.ends_with("fdfeff"));
        assert_eq!(
            h,
            format!(
                "0x{}",
                all.iter().map(|b| format!("{b:02x}")).collect::<String>()
            )
        );
    }
}
