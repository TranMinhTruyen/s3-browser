//! Đổi cột và ô của kết quả MySQL/MariaDB (giao thức text) sang tên kiểu và chuỗi hiển thị.
//!
//! Vị trí trong luồng: `actor` gọi `column_kind`/`type_name` một lần cho mỗi result set (lúc có
//! mô tả cột) rồi `convert_row` cho từng dòng đọc từ server.
//!
//! Ở giao thức text mọi ô đã là chuỗi do server định dạng sẵn (số, ngày giờ, decimal...), nên
//! phần lớn ô chỉ cần "đổi `Vec<u8>` thành `String`": `String::from_utf8` mượn lại đúng vùng nhớ
//! đó (chỉ kiểm UTF-8, không sao chép), nên mỗi ô chỉ tốn một lần cấp phát, do `mysql_async`
//! làm khi đọc gói. Chỉ cột nhị phân (hex) và `BIT` (chuỗi 0/1) cần dựng chuỗi mới.

use crate::drivers::common::hex;
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::{Column, Row, Value};

/// Mã bộ ký tự `binary` (63): server dùng nó cho cột `BINARY`/`VARBINARY`/`BLOB`.
const BINARY_CHARSET: u16 = 63;

/// Độ dài tối đa (byte) của `TINYBLOB`/`BLOB`/`MEDIUMBLOB` tính theo cột; với `TEXT` server nhân
/// thêm số byte tối đa một ký tự (tới 4 cho utf8mb4) nên ngưỡng lấy theo mức đó:
/// tinytext 255x4, text 65535x4, mediumtext 16777215x4. Cột nhị phân luôn nằm dưới ngưỡng.
const TINY_MAX: u32 = 1_020;
const BLOB_MAX: u32 = 262_140;
const MEDIUM_MAX: u32 = 67_108_860;

/// Cách hiển thị một cột.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Server đã gửi chuỗi sẵn (chữ, số, ngày giờ, JSON...), dùng nguyên.
    Text,
    /// Dữ liệu nhị phân: hiện dạng `0x...` như `hex` của các driver khác.
    Hex,
    /// `BIT(n)`: server gửi byte thô, hiện `n` chữ số 0/1.
    Bit(u32),
}

/// Cách hiển thị của cột `col`.
pub fn column_kind(col: &Column) -> Kind {
    use ColumnType::*;
    let binary = col.character_set() == BINARY_CHARSET;
    match col.column_type() {
        MYSQL_TYPE_BIT => Kind::Bit(col.column_length()),
        MYSQL_TYPE_GEOMETRY => Kind::Hex,
        MYSQL_TYPE_TINY_BLOB
        | MYSQL_TYPE_MEDIUM_BLOB
        | MYSQL_TYPE_LONG_BLOB
        | MYSQL_TYPE_BLOB
        | MYSQL_TYPE_STRING
        | MYSQL_TYPE_VAR_STRING
        | MYSQL_TYPE_VARCHAR
            if binary =>
        {
            Kind::Hex
        }
        _ => Kind::Text,
    }
}

/// Tên kiểu của cột để hiện ở tiêu đề (chữ thường như `information_schema`). Số nguyên có
/// `UNSIGNED` thì kèm ` unsigned`. MariaDB báo cột `JSON` là `longtext` (nó chỉ là bí danh).
pub fn type_name(col: &Column) -> &'static str {
    use ColumnType::*;
    let flags = col.flags();
    let unsigned = flags.contains(ColumnFlags::UNSIGNED_FLAG);
    let binary = col.character_set() == BINARY_CHARSET;
    // Chọn tên theo `binary` (nhị phân hay chữ).
    let pick = |bin: &'static str, text: &'static str| if binary { bin } else { text };
    match col.column_type() {
        MYSQL_TYPE_TINY if unsigned => "tinyint unsigned",
        MYSQL_TYPE_TINY => "tinyint",
        MYSQL_TYPE_SHORT if unsigned => "smallint unsigned",
        MYSQL_TYPE_SHORT => "smallint",
        MYSQL_TYPE_INT24 if unsigned => "mediumint unsigned",
        MYSQL_TYPE_INT24 => "mediumint",
        MYSQL_TYPE_LONG if unsigned => "int unsigned",
        MYSQL_TYPE_LONG => "int",
        MYSQL_TYPE_LONGLONG if unsigned => "bigint unsigned",
        MYSQL_TYPE_LONGLONG => "bigint",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "decimal",
        MYSQL_TYPE_FLOAT => "float",
        MYSQL_TYPE_DOUBLE => "double",
        MYSQL_TYPE_BIT => "bit",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "datetime",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        MYSQL_TYPE_YEAR => "year",
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_ENUM => "enum",
        MYSQL_TYPE_SET => "set",
        MYSQL_TYPE_GEOMETRY => "geometry",
        MYSQL_TYPE_NULL => "null",
        MYSQL_TYPE_VECTOR => "vector",
        // Server báo mọi biến thể blob/text là `BLOB`; chỉ độ dài tối đa của cột phân biệt được.
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB => {
            let len = col.column_length();
            if len <= TINY_MAX {
                pick("tinyblob", "tinytext")
            } else if len <= BLOB_MAX {
                pick("blob", "text")
            } else if len <= MEDIUM_MAX {
                pick("mediumblob", "mediumtext")
            } else {
                pick("longblob", "longtext")
            }
        }
        // `ENUM`/`SET` đi qua giao thức dưới dạng chuỗi kèm cờ riêng.
        MYSQL_TYPE_STRING | MYSQL_TYPE_VAR_STRING | MYSQL_TYPE_VARCHAR
            if flags.contains(ColumnFlags::ENUM_FLAG) =>
        {
            "enum"
        }
        MYSQL_TYPE_STRING | MYSQL_TYPE_VAR_STRING | MYSQL_TYPE_VARCHAR
            if flags.contains(ColumnFlags::SET_FLAG) =>
        {
            "set"
        }
        MYSQL_TYPE_STRING => pick("binary", "char"),
        MYSQL_TYPE_VAR_STRING | MYSQL_TYPE_VARCHAR => pick("varbinary", "varchar"),
        _ => "unknown",
    }
}

/// Chuỗi 0/1 của giá trị `BIT(bits)`: `bytes` là số big-endian, chỉ lấy `bits` bit thấp.
/// `bits = 0` (server không báo) hoặc lớn hơn số bit có thật thì lấy hết các bit có.
fn bit_string(bytes: &[u8], bits: u32) -> String {
    let total = bytes.len() * 8;
    let width = match usize::try_from(bits) {
        Ok(b) if b > 0 && b < total => b,
        _ => total,
    };
    // Bit thứ `p` tính từ bit cao nhất của chuỗi byte; bỏ `total - width` bit cao đầu tiên.
    (total - width..total)
        .map(|p| {
            if bytes.get(p / 8).is_some_and(|b| b & (0x80 >> (p % 8)) != 0) {
                '1'
            } else {
                '0'
            }
        })
        .collect()
}

/// Một ô thành chuỗi. `bytes` được dùng lại làm bộ nhớ của chuỗi khi là UTF-8 hợp lệ.
pub fn cell(kind: Kind, bytes: Vec<u8>) -> String {
    match kind {
        Kind::Text => String::from_utf8(bytes)
            // Không phải UTF-8 (ví dụ bộ ký tự lạ): thay byte hỏng bằng U+FFFD thay vì báo lỗi.
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()),
        Kind::Hex => hex(&bytes),
        Kind::Bit(bits) => bit_string(&bytes, bits),
    }
}

/// Một dòng thành các ô chuỗi (`None` = NULL), đổi tại chỗ không sao chép byte.
pub fn convert_row(row: Row, kinds: &[Kind]) -> Vec<Option<String>> {
    row.unwrap_raw()
        .into_iter()
        .zip(kinds)
        .map(|(value, &kind)| match value {
            Some(Value::Bytes(bytes)) => Some(cell(kind, bytes)),
            Some(Value::NULL) | None => None,
            // Giao thức text chỉ gửi chuỗi hoặc NULL; nhánh này để không panic nếu thư viện đổi.
            Some(other) => Some(other.as_sql(true)),
        })
        .collect()
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mysql/value.rs"]
mod tests;
