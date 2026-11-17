//! Đổi giá trị ô SQLite sang chuỗi theo kiểu lưu thực của từng ô.
//!
//! Vị trí trong luồng: `actor::read_page` gọi `row_cells` cho mỗi dòng đọc từ stream; kết quả
//! là `Vec<Option<String>>` đưa thẳng vào JSON (`None` là NULL). SQLite gõ kiểu theo từng ô
//! chứ không theo cột, nên phải hỏi kiểu lưu thực của ô.

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, TypeInfo, ValueRef};

/// NULL -> `None`; INTEGER/REAL/TEXT -> chuỗi; BLOB -> toàn bộ hex `0x...`.
pub fn cell(row: &SqliteRow, i: usize) -> Result<Option<String>, sqlx::Error> {
    let raw = row.try_get_raw(i)?;
    if raw.is_null() {
        return Ok(None);
    }
    // `type_info()` trả giá trị tạm (`Cow`) bị huỷ cuối câu lệnh, nên copy tên kiểu ra `String` mới dùng tiếp được.
    let name = raw.type_info().name().to_owned();
    Ok(Some(match name.as_str() {
        "INTEGER" => row.try_get_unchecked::<i64, _>(i)?.to_string(),
        "REAL" => real(row.try_get_unchecked::<f64, _>(i)?),
        "BLOB" => hex(row.try_get_unchecked::<&[u8], _>(i)?),
        // TEXT: lấy byte rồi chuyển lossy để TEXT không phải UTF-8 hợp lệ vẫn hiển thị được.
        _ => String::from_utf8_lossy(row.try_get_unchecked::<&[u8], _>(i)?).into_owned(),
    }))
}

/// Đổi mọi ô của một dòng sang chuỗi; ô nào lỗi thì cả hàm trả lỗi (`collect` gom `Result`).
pub fn row_cells(row: &SqliteRow) -> Result<Vec<Option<String>>, sqlx::Error> {
    (0..row.len()).map(|i| cell(row, i)).collect()
}

/// REAL giữ dấu `.0` như SQLite (`1.0`), không dùng ký hiệu mũ.
fn real(v: f64) -> String {
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
fn hex(bytes: &[u8]) -> String {
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
}
