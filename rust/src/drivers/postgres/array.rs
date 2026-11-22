//! Đổi mảng PostgreSQL (định dạng nhị phân) thành chuỗi dạng `{a,b,"c d",NULL}`.
//!
//! Vị trí trong luồng: `value::cell` gọi `write_array` cho cột có kiểu mảng. Mỗi phần tử được
//! ghi bằng `value::write_scalar` (cùng quy tắc với cột đơn), sau đó mới quyết định có cần đặt
//! trong dấu nháy kép hay không theo luật của `array_out` của PostgreSQL.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `FallibleIterator` (crate `fallible-iterator`) giống `Iterator` nhưng `next()` trả
//!   `Result<Option<_>, _>`, vì mỗi phần tử đọc từ buffer có thể lỗi.
//! - Đệ quy: mảng nhiều chiều viết bằng một hàm tự gọi lại cho chiều kế tiếp.

use super::value::{BadData, Decoded, Scalar, write_scalar};
use fallible_iterator::FallibleIterator;
use postgres_protocol::types::{ArrayDimension, ArrayValues, array_from_sql};

/// PostgreSQL cho tối đa 6 chiều; giới hạn này chặn đệ quy sâu khi dữ liệu sai.
const MAX_DIMS: usize = 6;

/// Ghi mảng. Mảng rỗng là `{}`; chiều có chỉ số bắt đầu khác 1 có tiền tố `[l:u]=` như PostgreSQL.
pub fn write_array(out: &mut String, sc: Scalar, raw: &[u8]) -> Decoded {
    let array = array_from_sql(raw)?;
    let dims: Vec<ArrayDimension> = array.dimensions().collect()?;
    if dims.is_empty() {
        out.push_str("{}");
        return Ok(());
    }
    if dims.len() > MAX_DIMS {
        return Err(BadData);
    }
    if dims.iter().any(|d| d.lower_bound != 1) {
        for d in &dims {
            let upper = i64::from(d.lower_bound) + i64::from(d.len) - 1;
            out.push('[');
            out.push_str(&d.lower_bound.to_string());
            out.push(':');
            out.push_str(&upper.to_string());
            out.push(']');
        }
        out.push('=');
    }
    let mut values = array.values();
    write_level(out, sc, &dims, &mut values)
}

/// Ghi một chiều `{...}`; các phần tử lấy lần lượt từ `values` (PostgreSQL gửi phẳng theo thứ tự hàng).
fn write_level(
    out: &mut String,
    sc: Scalar,
    dims: &[ArrayDimension],
    values: &mut ArrayValues<'_>,
) -> Decoded {
    let (dim, inner) = dims.split_first().ok_or(BadData)?;
    out.push('{');
    for i in 0..usize::try_from(dim.len).map_err(|_| BadData)? {
        if i > 0 {
            out.push(',');
        }
        if inner.is_empty() {
            match values.next()?.ok_or(BadData)? {
                None => out.push_str("NULL"),
                Some(bytes) => write_element(out, sc, bytes)?,
            }
        } else {
            write_level(out, sc, inner, values)?;
        }
    }
    out.push('}');
    Ok(())
}

/// Ghi một phần tử khác NULL; ghi thẳng vào `out`, chỉ khi cần nháy mới tách ra ghi lại có escape
/// (đa số phần tử, như số, không cần nên không tốn thêm cấp phát).
fn write_element(out: &mut String, sc: Scalar, bytes: &[u8]) -> Decoded {
    let start = out.len();
    write_scalar(out, sc, bytes)?;
    if !needs_quotes(&out[start..]) {
        return Ok(());
    }
    // `split_off` lấy phần vừa ghi ra khỏi `out`, rồi ghi lại trong nháy với `"` và `\` có escape.
    let plain = out.split_off(start);
    out.push('"');
    for c in plain.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    Ok(())
}

/// Luật của `array_out`: cần nháy khi rỗng, bằng `NULL` (không phân biệt hoa thường), hoặc chứa
/// `"`, `\`, `{`, `}`, dấu phẩy hay khoảng trắng.
fn needs_quotes(s: &str) -> bool {
    s.is_empty()
        || s.eq_ignore_ascii_case("NULL")
        || s.contains(|c: char| {
            matches!(c, '"' | '\\' | '{' | '}' | ',')
                || matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c')
        })
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/postgres/array.rs"]
mod tests;
