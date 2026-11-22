//! Đổi reply của Redis (kiểu `redis::Value`, cả RESP2 lẫn RESP3) thành bảng cột/dòng, theo Q26 = A.
//!
//! Vị trí trong luồng: `actor` gửi lệnh, nhận một `redis::Value` rồi gọi `Reply::new`; `Held`
//! (cursor) lấy từng dòng bằng `Reply::next_row` để dựng các trang. Reply vốn đã nằm trọn trong
//! RAM nên cursor chỉ là vị trí đọc dở trong nó. Phần này thuần (không chạm mạng).
//!
//! Hình dạng bảng theo kiểu reply:
//! - Số, chuỗi, `OK`, double, bool...: một dòng, một cột `value`. `nil` là ô NULL.
//! - Mảng/set: mỗi phần tử một dòng, cột `value` (ví dụ `LRANGE`, `SMEMBERS`, `KEYS`).
//! - Map (RESP3: `HGETALL`, `CONFIG GET`): mỗi cặp một dòng, hai cột `key`, `value`.
//! - Mảng mà mọi phần tử là mảng cùng độ dài n ≥ 2 (`ZRANGE ... WITHSCORES`, `XRANGE`): mỗi phần
//!   tử một dòng, n cột `c1..cn`.
//! - Phần tử lồng nhau trong một ô (mảng/map/set bên trong): chuỗi JSON gọn một dòng.
//!
//! Quy ước chuỗi: số in thập phân; chuỗi UTF-8 giữ nguyên; chuỗi byte không phải UTF-8 thành hex
//! `0x...` (giống BLOB ở các driver khác); double in dạng ngắn nhất đọc lại được (`inf`, `-inf`,
//! `nan` giữ như Redis gửi); lỗi lồng trong reply (ví dụ một phần tử của `EXEC`) thành `CODE
//! chi tiết`.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `vec::IntoIter<T>` là iterator *lấy quyền sở hữu* từng phần tử của `Vec`: lấy phần tử ra là
//!   chuyển nó đi (move), nên chuỗi byte của reply đổi thành `String` mà không phải chép.
//! - `ExactSizeIterator::len` cho biết còn bao nhiêu phần tử chưa lấy, dùng để biết đã hết dòng.

use crate::drivers::common::hex;
use crate::protocol::Column;
use redis::Value;
use std::vec::IntoIter;

/// Số cột tối đa của dạng bảng "mảng các mảng". Hơn mức này thì coi là dữ liệu lồng và ghi JSON,
/// tránh một bảng rộng vô tận.
const MAX_GRID_COLUMNS: usize = 32;
/// Độ sâu lồng tối đa khi ghi JSON, để reply lồng bất thường không làm tràn stack. Quá mức thì
/// phần còn lại được thay bằng chuỗi `"..."`.
const MAX_DEPTH: usize = 100;

/// Nguồn dòng còn lại của reply.
enum Source {
    /// Giá trị đơn (còn chưa lấy khi là `Some`).
    One(Option<Value>),
    /// Mảng/set: mỗi phần tử một dòng một cột.
    Items(IntoIter<Value>),
    /// Map: mỗi cặp một dòng hai cột.
    Pairs(IntoIter<(Value, Value)>),
    /// Mảng các mảng cùng độ dài: mỗi mảng một dòng nhiều cột.
    Grid(IntoIter<Value>),
}

/// Reply đã phân loại, đọc dần từng dòng.
pub struct Reply {
    /// Cột của bảng.
    pub columns: Vec<Column>,
    source: Source,
}

impl Reply {
    /// Phân loại `value` thành bảng (xem đầu file).
    pub fn new(value: Value) -> Self {
        match unwrap_attribute(value) {
            Value::Array(items) => match grid_width(&items) {
                Some(width) => {
                    Self::build(columns_numbered(width), Source::Grid(items.into_iter()))
                }
                None => Self::build(columns(&["value"]), Source::Items(items.into_iter())),
            },
            Value::Set(items) => Self::build(columns(&["value"]), Source::Items(items.into_iter())),
            Value::Map(pairs) => {
                Self::build(columns(&["key", "value"]), Source::Pairs(pairs.into_iter()))
            }
            other => Self::build(columns(&["value"]), Source::One(Some(other))),
        }
    }

    fn build(columns: Vec<Column>, source: Source) -> Self {
        Self { columns, source }
    }

    /// Đã lấy hết dòng chưa.
    pub fn is_done(&self) -> bool {
        match &self.source {
            Source::One(v) => v.is_none(),
            Source::Items(it) | Source::Grid(it) => it.len() == 0,
            Source::Pairs(it) => it.len() == 0,
        }
    }

    /// Lấy dòng kế tiếp; `None` khi hết. Mỗi ô là chuỗi, `None` = NULL (`nil`).
    pub fn next_row(&mut self) -> Option<Vec<Option<String>>> {
        match &mut self.source {
            Source::One(v) => v.take().map(|v| vec![cell(v)]),
            Source::Items(it) => it.next().map(|v| vec![cell(v)]),
            Source::Pairs(it) => it.next().map(|(k, v)| vec![cell(k), cell(v)]),
            Source::Grid(it) => it.next().map(|row| match unwrap_attribute(row) {
                Value::Array(cells) => cells.into_iter().map(cell).collect(),
                // `grid_width` đã kiểm mọi phần tử là mảng nên nhánh này không xảy ra.
                other => vec![cell(other)],
            }),
        }
    }
}

/// Danh sách cột kiểu `text` theo tên.
fn columns(names: &[&str]) -> Vec<Column> {
    names
        .iter()
        .map(|name| Column {
            name: (*name).to_owned(),
            ty: "text".to_owned(),
        })
        .collect()
}

/// Các cột `c1..cn`.
fn columns_numbered(n: usize) -> Vec<Column> {
    (1..=n)
        .map(|i| Column {
            name: format!("c{i}"),
            ty: "text".to_owned(),
        })
        .collect()
}

/// `Some(n)` nếu `items` không rỗng và mọi phần tử là mảng đúng n phần tử với 2 ≤ n ≤
/// `MAX_GRID_COLUMNS`.
fn grid_width(items: &[Value]) -> Option<usize> {
    let width = match items.first()? {
        Value::Array(first) => first.len(),
        _ => return None,
    };
    if !(2..=MAX_GRID_COLUMNS).contains(&width) {
        return None;
    }
    items
        .iter()
        .all(|v| matches!(v, Value::Array(a) if a.len() == width))
        .then_some(width)
}

/// RESP3 cho phép gắn "attribute" (siêu dữ liệu) vào một reply; ta bỏ nó và lấy dữ liệu chính.
fn unwrap_attribute(mut value: Value) -> Value {
    while let Value::Attribute { data, .. } = value {
        value = *data;
    }
    value
}

/// Một ô của bảng: `nil` là NULL, giá trị đơn là chuỗi thường, giá trị lồng là JSON gọn.
/// Nhận `value` theo giá trị để chuỗi byte của reply được chuyển thẳng thành `String`.
fn cell(value: Value) -> Option<String> {
    Some(match unwrap_attribute(value) {
        Value::Nil => return None,
        Value::BulkString(bytes) => bytes_text(bytes),
        Value::SimpleString(s) => s,
        Value::VerbatimString { text, .. } => text,
        Value::Okay => "OK".to_owned(),
        Value::Int(n) => itoa::Buffer::new().format(n).to_owned(),
        Value::Double(f) => double_text(f),
        Value::Boolean(b) => b.to_string(),
        Value::BigNumber(digits) => String::from_utf8_lossy(&digits).into_owned(),
        Value::ServerError(e) => server_error_text(&e),
        // Mảng/set/map/push lồng nhau thành JSON gọn; kiểu mới của crate (enum `non_exhaustive`)
        // cũng đi đường này và ra `"<unsupported>"` thay vì làm hỏng build.
        composite => {
            let mut out = String::new();
            json(&mut out, &composite, 0);
            out
        }
    })
}

/// Chuỗi byte của Redis thành `String`: UTF-8 hợp lệ thì giữ nguyên (không chép), còn lại hex.
fn bytes_text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|e| hex(e.as_bytes()))
}

/// Double theo kiểu Redis: `inf`, `-inf`, `nan`; số hữu hạn in bằng `ryu` (dạng ngắn nhất mà đọc lại ra đúng giá trị, luôn có phần thập phân: `1.0`, `3.0`).
fn double_text(f: f64) -> String {
    if f.is_nan() {
        "nan".to_owned()
    } else if f.is_infinite() {
        (if f < 0.0 { "-inf" } else { "inf" }).to_owned()
    } else {
        ryu::Buffer::new().format_finite(f).to_owned()
    }
}

/// Lỗi của server nằm trong reply: `CODE chi tiết` (như dòng `(error)` của `redis-cli`).
pub fn server_error_text(e: &redis::ServerError) -> String {
    match e.details() {
        Some(detail) => format!("{} {detail}", e.code()),
        None => e.code().to_owned(),
    }
}

/// Ghi `value` thành JSON gọn vào `out`. `depth` là độ sâu hiện tại (so với `MAX_DEPTH`).
fn json(out: &mut String, value: &Value, depth: usize) {
    if depth > MAX_DEPTH {
        out.push_str("\"...\"");
        return;
    }
    match value {
        Value::Nil => out.push_str("null"),
        Value::Int(n) => out.push_str(itoa::Buffer::new().format(*n)),
        Value::Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Double(f) if f.is_finite() => out.push_str(ryu::Buffer::new().format_finite(*f)),
        // JSON không có `inf`/`nan`: ghi thành chuỗi.
        Value::Double(f) => json_string(out, &double_text(*f)),
        Value::BulkString(bytes) => match std::str::from_utf8(bytes) {
            Ok(s) => json_string(out, s),
            Err(_) => json_string(out, &hex(bytes)),
        },
        Value::SimpleString(s) => json_string(out, s),
        Value::VerbatimString { text, .. } => json_string(out, text),
        Value::Okay => json_string(out, "OK"),
        Value::BigNumber(digits) => json_string(out, &String::from_utf8_lossy(digits)),
        Value::ServerError(e) => json_string(out, &server_error_text(e)),
        Value::Attribute { data, .. } => json(out, data, depth),
        Value::Array(items) | Value::Set(items) | Value::Push { data: items, .. } => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                json(out, item, depth + 1);
            }
            out.push(']');
        }
        Value::Map(pairs) => {
            out.push('{');
            for (i, (k, v)) in pairs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                json_string(out, &key_text(k, depth));
                out.push(':');
                json(out, v, depth + 1);
            }
            out.push('}');
        }
        _ => json_string(out, "<unsupported>"),
    }
}

/// Khoá của map trong JSON phải là chuỗi: lấy dạng chữ của giá trị (khoá lồng thì dùng JSON của nó).
fn key_text(key: &Value, depth: usize) -> String {
    match key {
        Value::BulkString(bytes) => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_owned(),
            Err(_) => hex(bytes),
        },
        Value::SimpleString(s) => s.clone(),
        Value::VerbatimString { text, .. } => text.clone(),
        Value::Int(n) => itoa::Buffer::new().format(*n).to_owned(),
        other => {
            // Khoá phức hợp (RESP3 cho phép mảng/map làm khoá) nằm sâu hơn map chứa nó một tầng, nên
            // khoá lồng khoá vẫn bị chặn bởi `MAX_DEPTH` (không đệ quy vô hạn).
            let mut s = String::new();
            json(&mut s, other, depth + 1);
            s
        }
    }
}

/// Chuỗi JSON có dấu nháy, escape giống `serde_json`: `"` `\` và ký tự < 0x20 (`\n \r \t \b \f`
/// hoặc `\u00XX`). Đoạn không cần escape được chép nguyên một lần thay vì từng ký tự.
fn json_string(out: &mut String, s: &str) {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    out.push('"');
    let mut start = 0;
    for (i, &b) in s.as_bytes().iter().enumerate() {
        let short = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x08 => "\\b",
            0x0c => "\\f",
            0..=0x1f => "",
            _ => continue,
        };
        // Byte cần escape luôn là ASCII nên `i` và `i + 1` là ranh giới ký tự hợp lệ.
        out.push_str(&s[start..i]);
        if short.is_empty() {
            out.push_str("\\u00");
            out.push(DIGITS[usize::from(b >> 4)] as char);
            out.push(DIGITS[usize::from(b & 0x0f)] as char);
        } else {
            out.push_str(short);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/redis/value.rs"]
mod tests;
