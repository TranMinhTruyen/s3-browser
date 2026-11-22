//! Ghi một document BSON thô thành chuỗi Extended JSON (relaxed) gọn một dòng.
//!
//! Vị trí trong luồng: `actor` nhận từng document dạng byte thô từ crate `mongodb` (một lát
//! `RawDocument` trỏ thẳng vào buffer mạng, chưa giải mã) và gọi `document_to_string` để có chuỗi
//! cho ô `document` của dòng kết quả. Không đi qua `bson::Document`/`serde_json::Value`: mỗi
//! phần tử được đọc rồi ghi thẳng vào một `String` đã cấp sẵn dung lượng, nên mỗi document chỉ
//! cấp phát đúng một lần (Q33 = A: gọn, không xuống dòng, không khoảng trắng thừa).
//!
//! Dạng ghi theo đặc tả "Extended JSON v2, relaxed" của MongoDB, giống `Bson::into_relaxed_extjson`
//! của crate `bson` (dùng làm chuẩn trong test):
//! - Số thường (int32, int64, double hữu hạn) là số JSON; double `NaN`/`±Infinity` là
//!   `{"$numberDouble":"NaN"}`.
//! - ObjectId `{"$oid":"…"}`, ngày `{"$date":"2024-01-02T03:04:05.678Z"}` (chỉ trong năm 1970–9999,
//!   ngoài ra `{"$date":{"$numberLong":"<ms>"}}`), decimal128 `{"$numberDecimal":"…"}`, binary
//!   `{"$binary":{"base64":"…","subType":"00"}}`, regex, timestamp, code, symbol, `undefined`,
//!   `minKey`/`maxKey`, `dbPointer` theo cùng đặc tả.
//! - Chuỗi escape như `serde_json`: `"`, `\`, các ký tự điều khiển; ký tự Unicode giữ nguyên.
//!
//! Khác `bson`: double `NaN` âm vẫn ghi `"NaN"` (đặc tả không có `-NaN`); khoá trùng trong một
//! document được ghi đủ theo thứ tự trên dây (`Document` của `bson` sẽ gộp).
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `&RawDocument`/`&RawArray`: lát byte BSON được mượn (borrow) chứ không sao chép; duyệt chúng
//!   trả từng `RawBsonRef` trỏ vào cùng vùng nhớ đó (zero-copy).
//! - `?`: gặp `Err` thì thoát hàm ngay và trả lỗi đó (giống `if err != nil { return err }` của Go).
//! - Đệ quy: document lồng nhau gọi lại chính hàm ghi; `depth` chặn lồng quá sâu để không tràn
//!   stack (tràn stack làm sập cả process, `catch_unwind` không bắt được).

use crate::drivers::datetime::civil_from_days;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use mongodb::bson::raw::{Error as BsonError, RawArray, RawBsonRef, RawDocument};
use std::fmt::{self, Write as _};

/// Độ sâu lồng tối đa. Server giới hạn 100 tầng nên dữ liệu thật không chạm tới; chặn ở đây để
/// dữ liệu hỏng/độc không làm tràn stack.
const MAX_DEPTH: usize = 200;

/// Lỗi khi ghi: BSON hỏng hoặc quá sâu. Không chứa dữ liệu của document.
#[derive(Debug)]
pub enum EjsonError {
    /// Bytes không phải BSON hợp lệ (độ dài sai, UTF-8 sai, thiếu kết thúc...).
    Bson(BsonError),
    /// Document/mảng lồng quá `MAX_DEPTH` tầng.
    TooDeep,
    /// Giá trị không ghi được ra JSON (không xảy ra với dữ liệu hợp lệ).
    Unserializable,
}

impl fmt::Display for EjsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EjsonError::Bson(e) => write!(f, "malformed BSON: {e}"),
            EjsonError::TooDeep => f.write_str("document is nested too deeply"),
            EjsonError::Unserializable => f.write_str("value cannot be written as JSON"),
        }
    }
}

impl std::error::Error for EjsonError {}

impl From<BsonError> for EjsonError {
    fn from(e: BsonError) -> Self {
        EjsonError::Bson(e)
    }
}

/// Document thành chuỗi Extended JSON gọn. Cấp sẵn dung lượng bằng cỡ BSON × ~1,3 vì JSON có
/// tên khoá/dấu câu nhưng số nguyên 8 byte thường ngắn hơn trong chữ, nên hiếm khi phải nới.
pub fn document_to_string(doc: &RawDocument) -> Result<String, EjsonError> {
    let size = doc.as_bytes().len();
    let mut out = String::with_capacity(size + size / 3);
    write_document(&mut out, doc)?;
    Ok(out)
}

/// Ghi `doc` vào cuối `out`.
pub fn write_document(out: &mut String, doc: &RawDocument) -> Result<(), EjsonError> {
    document(out, doc, 0)
}

fn document(out: &mut String, doc: &RawDocument, depth: usize) -> Result<(), EjsonError> {
    if depth > MAX_DEPTH {
        return Err(EjsonError::TooDeep);
    }
    out.push('{');
    let mut first = true;
    for entry in doc {
        let (key, value) = entry?;
        if !first {
            out.push(',');
        }
        first = false;
        string(out, key);
        out.push(':');
        value_at(out, value, depth)?;
    }
    out.push('}');
    Ok(())
}

fn array(out: &mut String, arr: &RawArray, depth: usize) -> Result<(), EjsonError> {
    if depth > MAX_DEPTH {
        return Err(EjsonError::TooDeep);
    }
    out.push('[');
    let mut first = true;
    for item in arr {
        if !first {
            out.push(',');
        }
        first = false;
        value_at(out, item?, depth)?;
    }
    out.push(']');
    Ok(())
}

/// Ghi một giá trị; `depth` là tầng của document/mảng chứa nó.
fn value_at(out: &mut String, value: RawBsonRef<'_>, depth: usize) -> Result<(), EjsonError> {
    match value {
        RawBsonRef::Double(f) => double(out, f),
        RawBsonRef::String(s) => string(out, s),
        RawBsonRef::Array(a) => array(out, a, depth + 1)?,
        RawBsonRef::Document(d) => document(out, d, depth + 1)?,
        RawBsonRef::Boolean(b) => out.push_str(if b { "true" } else { "false" }),
        RawBsonRef::Null => out.push_str("null"),
        RawBsonRef::Int32(i) => out.push_str(itoa::Buffer::new().format(i)),
        RawBsonRef::Int64(i) => out.push_str(itoa::Buffer::new().format(i)),
        RawBsonRef::ObjectId(oid) => {
            out.push_str("{\"$oid\":\"");
            push_hex(out, &oid.bytes());
            out.push_str("\"}");
        }
        RawBsonRef::DateTime(d) => date(out, d.timestamp_millis()),
        RawBsonRef::Decimal128(d) => {
            out.push_str("{\"$numberDecimal\":\"");
            // `write!` vào `String` không bao giờ lỗi; `let _ =` bỏ kết quả `Result` thừa.
            let _ = write!(out, "{d}");
            out.push_str("\"}");
        }
        RawBsonRef::Binary(b) => {
            out.push_str("{\"$binary\":{\"base64\":\"");
            STANDARD.encode_string(b.bytes, out);
            out.push_str("\",\"subType\":\"");
            push_hex(out, &[u8::from(b.subtype)]);
            out.push_str("\"}}");
        }
        RawBsonRef::RegularExpression(r) => {
            out.push_str("{\"$regularExpression\":{\"pattern\":");
            string(out, r.pattern);
            out.push_str(",\"options\":");
            // Đặc tả yêu cầu các cờ theo thứ tự chữ cái.
            let mut flags: Vec<char> = r.options.chars().collect();
            flags.sort_unstable();
            string(out, &flags.into_iter().collect::<String>());
            out.push_str("}}");
        }
        RawBsonRef::JavaScriptCode(code) => {
            out.push_str("{\"$code\":");
            string(out, code);
            out.push('}');
        }
        RawBsonRef::JavaScriptCodeWithScope(c) => {
            out.push_str("{\"$code\":");
            string(out, c.code);
            out.push_str(",\"$scope\":");
            document(out, c.scope, depth + 1)?;
            out.push('}');
        }
        RawBsonRef::Timestamp(t) => {
            let _ = write!(
                out,
                "{{\"$timestamp\":{{\"t\":{},\"i\":{}}}}}",
                t.time, t.increment
            );
        }
        RawBsonRef::Symbol(s) => {
            out.push_str("{\"$symbol\":");
            string(out, s);
            out.push('}');
        }
        RawBsonRef::Undefined => out.push_str("{\"$undefined\":true}"),
        RawBsonRef::MinKey => out.push_str("{\"$minKey\":1}"),
        RawBsonRef::MaxKey => out.push_str("{\"$maxKey\":1}"),
        // Trường của `RawDbPointerRef` không công khai; kiểu này đã bị MongoDB bỏ và không còn
        // xuất hiện trong dữ liệu thật, nên nhờ `Serialize` của crate (cho đúng dạng `$dbPointer`).
        RawBsonRef::DbPointer(p) => {
            let json = serde_json::to_string(&p).map_err(|_| EjsonError::Unserializable)?;
            out.push_str(&json);
        }
    }
    Ok(())
}

/// Double: hữu hạn thì số JSON (cùng cách in với `serde_json`: `1.0`, `1e21`, `-0.0`);
/// `NaN`/`Infinity` không có trong JSON nên dùng dạng `$numberDouble`.
fn double(out: &mut String, f: f64) {
    if f.is_nan() {
        out.push_str("{\"$numberDouble\":\"NaN\"}");
    } else if f.is_infinite() {
        out.push_str(if f.is_sign_negative() {
            "{\"$numberDouble\":\"-Infinity\"}"
        } else {
            "{\"$numberDouble\":\"Infinity\"}"
        });
    } else {
        out.push_str(ryu::Buffer::new().format_finite(f));
    }
}

/// Ngày (mili giây từ 1970-01-01 UTC). Trong năm 1970–9999 ghi ISO 8601 UTC; ngoài khoảng đó
/// (trước 1970 hoặc sau năm 9999) ghi số mili giây, vì chuỗi ISO không biểu diễn được năm âm
/// hay quá 4 chữ số.
fn date(out: &mut String, millis: i64) {
    let days = millis.div_euclid(86_400_000);
    let in_day = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    if millis < 0 || year > 9999 {
        out.push_str("{\"$date\":{\"$numberLong\":\"");
        out.push_str(itoa::Buffer::new().format(millis));
        out.push_str("\"}}");
        return;
    }
    out.push_str("{\"$date\":\"");
    // `year` ở 1970..=9999 nên đổi sang `u32` luôn đúng; các phần của một ngày đều nhỏ hơn 2^31
    // nên `as u32` bên dưới không cắt.
    push_padded(out, u32::try_from(year).unwrap_or(0), 4);
    out.push('-');
    push_padded(out, month, 2);
    out.push('-');
    push_padded(out, day, 2);
    out.push('T');
    push_padded(out, (in_day / 3_600_000) as u32, 2);
    out.push(':');
    push_padded(out, (in_day / 60_000 % 60) as u32, 2);
    out.push(':');
    push_padded(out, (in_day / 1000 % 60) as u32, 2);
    let ms = (in_day % 1000) as u32;
    if ms != 0 {
        // Phần lẻ bỏ số 0 thừa ở cuối (`.5`, `.12`, `.123`), giống `Rfc3339` của crate `time`
        // mà `bson` dùng.
        let frac = [ms / 100, ms / 10 % 10, ms % 10];
        let len = if frac[2] != 0 {
            3
        } else if frac[1] != 0 {
            2
        } else {
            1
        };
        out.push('.');
        for d in &frac[..len] {
            out.push(char::from(b'0' + *d as u8));
        }
    }
    out.push_str("Z\"}");
}

/// Ghi `n` thành ít nhất `width` chữ số (đệm số 0 bên trái).
fn push_padded(out: &mut String, n: u32, width: usize) {
    let digits = itoa::Buffer::new().format(n).len();
    for _ in digits..width {
        out.push('0');
    }
    out.push_str(itoa::Buffer::new().format(n));
}

/// Byte thành chuỗi hex thường, hai ký tự mỗi byte.
fn push_hex(out: &mut String, bytes: &[u8]) {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for &b in bytes {
        out.push(DIGITS[usize::from(b >> 4)] as char);
        out.push(DIGITS[usize::from(b & 0x0f)] as char);
    }
}

/// Chuỗi JSON có dấu nháy, escape giống `serde_json`: `"` `\` và ký tự < 0x20 (`\n \r \t \b \f`
/// hoặc `\u00XX`). Đoạn không cần escape được chép nguyên một lần thay vì từng ký tự.
fn string(out: &mut String, s: &str) {
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
            push_hex(out, &[b]);
        } else {
            out.push_str(short);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mongodb/ejson.rs"]
mod tests;
