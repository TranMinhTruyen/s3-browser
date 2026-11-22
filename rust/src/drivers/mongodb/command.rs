//! Đọc văn bản người dùng gõ thành các lệnh MongoDB (`runCommand`), dạng Extended JSON (Q24 = A).
//!
//! Vị trí trong luồng: `actor::execute` gọi `parse` với trường `sql` của request; mỗi lệnh thành
//! một `Command` rồi được chạy lần lượt bằng `Database::run_raw_command`/`run_raw_cursor_command`
//! của crate `mongodb`. Phần này thuần (không chạm mạng) nên test được riêng.
//!
//! Cú pháp: mỗi lệnh là một document JSON, phần tử đầu tiên là tên lệnh, ví dụ
//! `{"find": "users", "filter": {"age": {"$gt": 30}}}`. Nhiều lệnh viết liền nhau (cách nhau bằng
//! khoảng trắng, xuống dòng hoặc `;`) thì chạy lần lượt. Giá trị đặc biệt viết theo Extended JSON
//! (`{"$oid": "..."}`, `{"$date": "..."}`, `{"$numberLong": "..."}`, `{"$numberDecimal": "..."}`...)
//! và được đổi thành đúng kiểu BSON. Khoá `"$db"` (tuỳ chọn, chuỗi) chọn database chạy lệnh thay
//! cho database mặc định của connection, ví dụ `{"listDatabases": 1, "$db": "admin"}`; nó bị gỡ
//! khỏi lệnh trước khi gửi.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `serde_json::Deserializer` + `into_iter`: đọc *một chuỗi* giá trị JSON nối liền nhau từ cùng
//!   một văn bản; `byte_offset` cho biết giá trị vừa đọc kết thúc ở byte nào.
//! - `Document` của `bson` giữ thứ tự khoá như người dùng viết (tên lệnh phải đứng đầu).

use mongodb::bson::{Bson, Document, RawDocumentBuf};

/// Loại lệnh, quyết định cách chạy và dựng kết quả (suy ra từ tên lệnh).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `find`: trả cursor, kích thước batch là `batchSize` ở cấp ngoài cùng.
    Find,
    /// `aggregate`, `listCollections`, `listIndexes`: trả cursor, kích thước batch là
    /// `cursor.batchSize`.
    Cursor,
    /// `insert`, `update`, `delete`: kết quả là số document bị ảnh hưởng (`n`).
    Write,
    /// Mọi lệnh khác (`ping`, `count`, `findAndModify`, `listDatabases`...): một dòng chứa cả
    /// document trả lời.
    Plain,
}

/// Một lệnh đã đọc xong.
#[derive(Debug, Clone, PartialEq)]
pub struct Command {
    /// Nội dung lệnh đã cắt khoảng trắng (đưa vào `StatementResult.sql`).
    pub text: String,
    pub kind: Kind,
    /// Database chạy lệnh nếu người dùng đặt `"$db"`; `None` thì dùng database mặc định.
    pub db: Option<String>,
    doc: Document,
}

/// Lỗi cú pháp ở một lệnh.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Phần văn bản còn lại tính từ lệnh lỗi (đã cắt khoảng trắng), đưa vào `StatementResult.sql`.
    pub text: String,
    /// Mô tả lỗi kèm dòng/cột trong toàn văn bản.
    pub message: String,
}

/// Kết quả đọc cả văn bản: các lệnh đọc được trước chỗ lỗi (nếu có) và lỗi đầu tiên. Lệnh đứng
/// trước chỗ lỗi vẫn chạy (giống SQL: câu 1 chạy rồi câu 2 mới báo lỗi cú pháp), các lệnh sau lỗi
/// không chạy.
#[derive(Debug, Default, PartialEq)]
pub struct Parsed {
    pub commands: Vec<Command>,
    pub error: Option<ParseError>,
}

/// Gợi ý gắn vào mọi lỗi cú pháp, vì người quen mongosh hay gõ `db.users.find()`.
const HINT: &str = "a command is a JSON document such as {\"find\": \"users\"}";

/// Tách và đọc các lệnh trong `text`. Văn bản rỗng cho `Parsed` rỗng.
pub fn parse(text: &str) -> Parsed {
    let mut commands = Vec::new();
    let mut pos = 0;
    loop {
        // Bỏ khoảng trắng và `;` giữa các lệnh.
        let rest = text[pos..].trim_start_matches(|c: char| c.is_whitespace() || c == ';');
        pos = text.len() - rest.len();
        if rest.is_empty() {
            return Parsed {
                commands,
                error: None,
            };
        }
        // Mỗi vòng đọc đúng một document từ chỗ `pos`.
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Document>();
        let outcome = match stream.next() {
            Some(Ok(doc)) => {
                let used = stream.byte_offset();
                build(rest[..used].trim(), doc).map(|c| (c, used))
            }
            Some(Err(e)) => Err(syntax_message(text, pos, &e)),
            // Không xảy ra vì `rest` không rỗng và không toàn khoảng trắng.
            None => {
                return Parsed {
                    commands,
                    error: None,
                };
            }
        };
        match outcome {
            Ok((command, used)) => {
                commands.push(command);
                pos += used;
            }
            Err(message) => {
                return Parsed {
                    commands,
                    error: Some(ParseError {
                        text: rest.trim().to_owned(),
                        message,
                    }),
                };
            }
        }
    }
}

/// Dựng `Command` từ document đã đọc: gỡ `$db`, xác định tên lệnh và loại.
fn build(text: &str, mut doc: Document) -> Result<Command, String> {
    let db = match doc.remove("$db") {
        None => None,
        Some(Bson::String(name)) if !name.is_empty() => Some(name),
        Some(_) => return Err("\"$db\" must be a non-empty string".to_owned()),
    };
    let Some(name) = doc.keys().next() else {
        return Err(format!("empty command: {HINT}"));
    };
    let kind = match name.as_str() {
        "find" => Kind::Find,
        "aggregate" | "listCollections" | "listIndexes" => Kind::Cursor,
        "insert" | "update" | "delete" => Kind::Write,
        _ => Kind::Plain,
    };
    Ok(Command {
        text: text.to_owned(),
        kind,
        db,
        doc,
    })
}

/// Thông báo lỗi cú pháp của `serde_json` với dòng/cột tính trong *toàn văn bản* (`serde_json`
/// chỉ biết phần văn bản bắt đầu từ lệnh đang đọc, tại byte `pos`).
fn syntax_message(text: &str, pos: usize, e: &serde_json::Error) -> String {
    let full = e.to_string();
    // `serde_json` luôn kết thúc thông báo bằng " at line N column M": bỏ đi để thay bằng vị trí
    // tuyệt đối.
    let reason = full
        .rsplit_once(" at line ")
        .map_or(full.as_str(), |(r, _)| r);
    let before = &text[..pos];
    let base_line = before.matches('\n').count() + 1;
    let base_col = before.len() - before.rfind('\n').map_or(0, |i| i + 1) + 1;
    let (line, column) = if e.line() <= 1 {
        (base_line, base_col + e.column().saturating_sub(1))
    } else {
        (base_line + e.line() - 1, e.column())
    };
    format!("invalid command: {reason} at line {line} column {column} ({HINT})")
}

impl Command {
    /// Document lệnh dạng BSON thô để gửi đi. Lệnh trả cursor mà người dùng chưa đặt kích thước
    /// batch thì thêm `page_size` (batch đầu của server mặc định chỉ 101 document nên một trang
    /// 10.000 dòng cần ~100 vòng `getMore`); người dùng đã đặt thì giữ nguyên.
    pub fn to_raw(&mut self, page_size: usize) -> Result<RawDocumentBuf, String> {
        let size = i64::try_from(page_size).unwrap_or(i64::MAX);
        match self.kind {
            Kind::Find => {
                if !self.doc.contains_key("batchSize") {
                    self.doc.insert("batchSize", size);
                }
            }
            Kind::Cursor => match self.doc.get_mut("cursor") {
                None => {
                    let mut cursor = Document::new();
                    cursor.insert("batchSize", size);
                    self.doc.insert("cursor", cursor);
                }
                Some(Bson::Document(cursor)) => {
                    if !cursor.contains_key("batchSize") {
                        cursor.insert("batchSize", size);
                    }
                }
                // `cursor` không phải document: để server báo lỗi đúng chỗ.
                Some(_) => {}
            },
            Kind::Write | Kind::Plain => {}
        }
        RawDocumentBuf::try_from(&self.doc).map_err(|e| format!("cannot encode command: {e}"))
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/mongodb/command.rs"]
mod tests;
