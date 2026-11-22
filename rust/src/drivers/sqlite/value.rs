//! Định dạng chuỗi cho giá trị ô SQLite (REAL; BLOB dùng `common::hex`).
//!
//! Vị trí trong luồng: `raw::Stmt::cell` đọc ô từ SQLite theo kiểu lưu thực rồi gọi hàm ở
//! đây cho REAL (BLOB đi qua `common::hex`); kết quả là chuỗi đưa thẳng vào JSON (NULL là `None`, xử lý ở `raw`).

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

#[cfg(test)]
#[path = "../../../tests/unit/drivers/sqlite/value.rs"]
mod tests;
