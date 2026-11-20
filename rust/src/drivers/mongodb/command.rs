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
mod tests {
    use super::*;
    use mongodb::bson::raw::RawBsonRef;
    use mongodb::bson::spec::BinarySubtype;

    /// Văn bản chỉ có đúng một lệnh hợp lệ.
    fn only(text: &str) -> Command {
        let parsed = parse(text);
        assert_eq!(parsed.error, None, "{text}");
        assert_eq!(parsed.commands.len(), 1, "{text}");
        parsed.commands.into_iter().next().unwrap()
    }

    /// Lỗi cú pháp của `text` (panic nếu không có lỗi).
    fn error_of(text: &str) -> ParseError {
        parse(text)
            .error
            .unwrap_or_else(|| panic!("không có lỗi: {text}"))
    }

    /// Tên các khoá cấp ngoài cùng của lệnh sau `to_raw`.
    fn keys(c: &mut Command, page: usize) -> Vec<String> {
        let raw = c.to_raw(page).unwrap();
        raw.iter().map(|e| e.unwrap().0.to_owned()).collect()
    }

    // ---- tách lệnh ----

    #[test]
    fn empty_and_separator_only_text_has_no_commands_and_no_error() {
        for text in [
            "",
            " ",
            "\n\t\r\n",
            ";",
            ";;;",
            " ; \n ;; ",
            "\u{a0}\u{3000}",
        ] {
            assert_eq!(parse(text), Parsed::default(), "{text:?}");
        }
    }

    #[test]
    fn one_command_keeps_its_trimmed_text_and_defaults() {
        let c = only("  \n {\"find\": \"users\"} \n ");
        assert_eq!(c.text, r#"{"find": "users"}"#);
        assert_eq!(c.kind, Kind::Find);
        assert_eq!(c.db, None);
    }

    #[test]
    fn several_commands_separated_by_spaces_newlines_and_semicolons() {
        for text in [
            r#"{"ping":1}{"ping":2}{"ping":3}"#,
            r#"{"ping":1} {"ping":2} {"ping":3}"#,
            "{\"ping\":1}\n{\"ping\":2}\r\n{\"ping\":3}",
            r#"{"ping":1};{"ping":2};{"ping":3}"#,
            r#"{"ping":1};;{"ping":2} ; ; {"ping":3};"#,
            ";{\"ping\":1}\n;\n{\"ping\":2}\u{3000}{\"ping\":3}\u{a0};",
        ] {
            let parsed = parse(text);
            assert_eq!(parsed.error, None, "{text:?}");
            let texts: Vec<_> = parsed.commands.iter().map(|c| c.text.as_str()).collect();
            assert_eq!(
                texts,
                [r#"{"ping":1}"#, r#"{"ping":2}"#, r#"{"ping":3}"#],
                "{text:?}"
            );
        }
    }

    #[test]
    fn semicolon_and_braces_inside_strings_do_not_split() {
        let c = only(r#"{"find": "a;b}{c", "filter": {"x": ";"}}"#);
        assert_eq!(c.kind, Kind::Find);
        assert_eq!(c.text, r#"{"find": "a;b}{c", "filter": {"x": ";"}}"#);
    }

    #[test]
    fn many_commands_in_order() {
        let text: String = (0..300).map(|i| format!("{{\"ping\": {i}}}\n")).collect();
        let parsed = parse(&text);
        assert_eq!(parsed.error, None);
        assert_eq!(parsed.commands.len(), 300);
        assert_eq!(parsed.commands[299].text, r#"{"ping": 299}"#);
    }

    // ---- loại lệnh ----

    #[test]
    fn kind_comes_from_the_first_key() {
        let expected = [
            ("find", Kind::Find),
            ("aggregate", Kind::Cursor),
            ("listCollections", Kind::Cursor),
            ("listIndexes", Kind::Cursor),
            ("insert", Kind::Write),
            ("update", Kind::Write),
            ("delete", Kind::Write),
            ("ping", Kind::Plain),
            ("count", Kind::Plain),
            ("findAndModify", Kind::Plain),
            ("listDatabases", Kind::Plain),
            ("buildInfo", Kind::Plain),
            ("serverStatus", Kind::Plain),
            ("Find", Kind::Plain),
            ("", Kind::Plain),
        ];
        for (name, kind) in expected {
            let c = only(&format!("{{\"{name}\": 1}}"));
            assert_eq!(c.kind, kind, "{name}");
        }
        // Chỉ khoá ĐẦU là tên lệnh, `find` đứng sau không đổi loại.
        assert_eq!(only(r#"{"count": "c", "find": 1}"#).kind, Kind::Plain);
        assert_eq!(only(r#"{"filter": {}, "find": "c"}"#).kind, Kind::Plain);
    }

    // ---- $db ----

    #[test]
    fn db_key_selects_the_database_and_is_removed_from_the_command() {
        let mut c = only(r#"{"listDatabases": 1, "$db": "admin"}"#);
        assert_eq!(c.db.as_deref(), Some("admin"));
        assert_eq!(c.kind, Kind::Plain);
        assert_eq!(keys(&mut c, 10), ["listDatabases"]);
        // Dù đứng đầu thì `$db` không phải tên lệnh.
        let mut c = only(r#"{"$db": "shop", "find": "orders"}"#);
        assert_eq!(c.db.as_deref(), Some("shop"));
        assert_eq!(c.kind, Kind::Find);
        assert_eq!(keys(&mut c, 10), ["find", "batchSize"]);
        // Text giữ nguyên người dùng gõ (kể cả `$db`).
        assert_eq!(c.text, r#"{"$db": "shop", "find": "orders"}"#);
    }

    #[test]
    fn db_key_must_be_a_non_empty_string() {
        for value in ["\"\"", "1", "null", "true", "[\"a\"]", "{\"a\": 1}"] {
            let text = format!("{{\"ping\": 1, \"$db\": {value}}}");
            let e = error_of(&text);
            assert_eq!(e.message, "\"$db\" must be a non-empty string", "{value}");
            assert_eq!(e.text, text);
            assert!(parse(&text).commands.is_empty());
        }
    }

    // ---- lệnh rỗng / khoá trùng ----

    #[test]
    fn empty_command_is_an_error_with_the_hint() {
        for text in ["{}", "  {}  ", r#"{"$db": "x"}"#] {
            let parsed = parse(text);
            assert!(parsed.commands.is_empty(), "{text}");
            let e = parsed.error.unwrap();
            assert_eq!(
                e.message,
                "empty command: a command is a JSON document such as {\"find\": \"users\"}",
                "{text}"
            );
            assert_eq!(e.text, text.trim());
        }
    }

    #[test]
    fn commands_before_an_empty_command_are_kept_and_later_ones_dropped() {
        let parsed = parse(r#"{"ping": 1} {} {"ping": 2}"#);
        assert_eq!(parsed.commands.len(), 1);
        let e = parsed.error.unwrap();
        assert!(e.message.starts_with("empty command"), "{e:?}");
        // `text` của lỗi là phần còn lại tính từ lệnh lỗi, gồm cả lệnh sau nó.
        assert_eq!(e.text, r#"{} {"ping": 2}"#);
    }

    #[test]
    fn duplicate_keys_last_value_wins() {
        let mut c = only(r#"{"find": "first", "filter": {"a": 1}, "find": "second"}"#);
        let raw = c.to_raw(5).unwrap();
        assert_eq!(raw.get("find").unwrap(), Some(RawBsonRef::String("second")));
        assert_eq!(keys(&mut c, 5), ["find", "filter", "batchSize"]);
    }

    // ---- lỗi cú pháp ----

    const HINT: &str = "(a command is a JSON document such as {\"find\": \"users\"})";

    #[test]
    fn syntax_error_has_reason_position_and_hint() {
        let e = error_of(r#"{"find": }"#);
        assert_eq!(
            e.message,
            format!("invalid command: expected value at line 1 column 10 {HINT}")
        );
        assert_eq!(e.text, r#"{"find": }"#);
    }

    #[test]
    fn syntax_error_in_the_middle_keeps_the_commands_before_it() {
        let parsed = parse(r#"{"ping": 1} ; {"ping": 2} {"find": } {"ping": 3}"#);
        assert_eq!(parsed.commands.len(), 2);
        let e = parsed.error.unwrap();
        // Cột tính trên cả văn bản, không phải trong riêng lệnh lỗi.
        assert_eq!(
            e.message,
            format!("invalid command: expected value at line 1 column 36 {HINT}")
        );
        assert_eq!(e.text, r#"{"find": } {"ping": 3}"#);
    }

    #[test]
    fn syntax_error_position_counts_lines_in_the_whole_text() {
        let e = error_of("{\"ping\": 1}\n\n{\"find\": }");
        assert!(e.message.contains("at line 3 column 10 "), "{}", e.message);
        // Lỗi nằm ở dòng thứ hai của chính lệnh lỗi.
        let e = error_of("{\"ping\": 1}\n{\"find\":\n  }");
        assert!(e.message.contains("at line 3 column 3 "), "{}", e.message);
    }

    #[test]
    fn crlf_line_breaks_count_as_one_line() {
        let lf = error_of("{\"ping\": 1}\n{\"find\": }").message;
        let crlf = error_of("{\"ping\": 1}\r\n{\"find\": }").message;
        assert_eq!(lf, crlf);
        assert!(crlf.contains("at line 2 column 10 "), "{crlf}");
        let e = error_of("{\"ping\": 1}\r\n\r\n{\"find\":\r\n  }");
        assert!(e.message.contains("at line 4 column 3 "), "{}", e.message);
    }

    #[test]
    fn unicode_before_the_error_does_not_shift_or_panic() {
        // Cột của `serde_json` tính theo byte; cột báo cho người dùng phải bằng cột của chính lệnh
        // lỗi cộng độ dài byte của phần đứng trước, không lệch vì ký tự nhiều byte.
        let prefix = "{\"tên\": \"Việt 日本 😀\"} ";
        let alone = error_of(r#"{"find": }"#).message;
        let full = error_of(&format!("{prefix}{{\"find\": }}")).message;
        let col = |m: &str| -> usize {
            m.split(" column ")
                .nth(1)
                .unwrap()
                .split(' ')
                .next()
                .unwrap()
                .parse()
                .unwrap()
        };
        assert_eq!(col(&full), col(&alone) + prefix.len(), "{full}");
        assert!(full.contains("at line 1 "), "{full}");
        // Lỗi nằm trong chuỗi Unicode của chính lệnh lỗi vẫn không panic.
        let e = error_of("{\"find\": \"日本\u{0}\"}");
        assert!(e.message.starts_with("invalid command: "), "{}", e.message);
        // Xuống dòng sau Unicode.
        let e = error_of("{\"a\": \"😀\"}\n{\"find\": }");
        assert!(e.message.contains("at line 2 column 10 "), "{}", e.message);
    }

    #[test]
    fn root_array_is_not_a_command() {
        let e = error_of(r#"[{"find": "users"}]"#);
        assert!(
            e.message.contains("invalid type: sequence"),
            "{}",
            e.message
        );
        assert!(e.message.ends_with(HINT), "{}", e.message);
        assert!(parse(r#"[1]"#).commands.is_empty());
    }

    #[test]
    fn root_scalars_and_garbage_are_errors() {
        for text in [
            "1",
            "\"find\"",
            "null",
            "true",
            "find",
            "db.users.find()",
            "{'a': 1}",
        ] {
            let e = error_of(text);
            assert!(
                e.message.starts_with("invalid command: "),
                "{text}: {}",
                e.message
            );
            assert!(e.message.ends_with(HINT), "{text}");
            assert_eq!(e.text, text);
        }
    }

    #[test]
    fn trailing_garbage_after_a_command_is_an_error_after_that_command() {
        let parsed = parse(r#"{"ping": 1} xyz"#);
        assert_eq!(parsed.commands.len(), 1);
        let e = parsed.error.unwrap();
        assert_eq!(e.text, "xyz");
        assert_eq!(
            e.message,
            format!("invalid command: expected value at line 1 column 13 {HINT}")
        );
    }

    #[test]
    fn unterminated_and_truncated_commands() {
        for text in [
            r#"{"find": "users""#,
            r#"{"find":"#,
            r#"{"find": "a"#,
            "{",
            r#"{"a": [1, 2"#,
        ] {
            let e = error_of(text);
            assert!(
                e.message.contains("EOF while parsing"),
                "{text}: {}",
                e.message
            );
        }
    }

    #[test]
    fn deep_nesting_is_rejected_with_recursion_limit_exceeded() {
        let text = format!("{{\"a\": {}1{}}}", "[".repeat(300), "]".repeat(300));
        let e = error_of(&text);
        assert!(
            e.message.contains("recursion limit exceeded"),
            "{}",
            e.message
        );
        assert!(e.message.ends_with(HINT));
    }

    // ---- số và Extended JSON ----

    #[test]
    fn numbers_become_int32_int64_or_double() {
        let mut c = only(
            r#"{"ping": 1, "a": 3000000000, "b": 1, "c": 2.0, "d": -2147483647, "e": 2147483648,
                "f": -9223372036854775808, "g": 1e3, "h": 0, "i": -0.0}"#,
        );
        let raw = c.to_raw(10).unwrap();
        let get = |k: &str| raw.get(k).unwrap().unwrap();
        assert_eq!(get("a"), RawBsonRef::Int64(3_000_000_000));
        assert_eq!(get("b"), RawBsonRef::Int32(1));
        assert_eq!(get("c"), RawBsonRef::Double(2.0));
        // Số âm luôn thành int64 (cách `bson` đọc `i64` âm của `serde_json`): xem
        // `known_limit_negative_integers_are_int64`; giá trị vẫn đúng.
        assert_eq!(get("d"), RawBsonRef::Int64(-2_147_483_647));
        assert_eq!(get("e"), RawBsonRef::Int64(2_147_483_648));
        assert_eq!(get("f"), RawBsonRef::Int64(i64::MIN));
        assert_eq!(get("g"), RawBsonRef::Double(1000.0));
        assert_eq!(get("h"), RawBsonRef::Int32(0));
        assert!(matches!(get("i"), RawBsonRef::Double(d) if d == 0.0 && d.is_sign_negative()));
    }

    /// GIỚI HẠN ĐÃ BIẾT (do cách `bson` đọc số của `serde_json`, không phải bug riêng của driver):
    /// số nguyên ÂM nhỏ như `-1` thành int64 chứ không phải int32. Lệnh vẫn đúng về giá trị (server
    /// so sánh số theo giá trị), chỉ khác kiểu lưu khi `insert`. Khi sửa được thì đổi test này.
    #[test]
    fn known_limit_negative_integers_are_int64() {
        let mut c = only(r#"{"ping": 1, "a": -1, "b": 1}"#);
        let raw = c.to_raw(10).unwrap();
        assert_eq!(raw.get("a").unwrap(), Some(RawBsonRef::Int64(-1)));
        assert_eq!(raw.get("b").unwrap(), Some(RawBsonRef::Int32(1)));
    }

    #[test]
    fn integers_beyond_i64_are_never_truncated() {
        // 2^63 (vừa u64, không vừa i64): `bson` từ chối thay vì thành số âm.
        let e = error_of(r#"{"ping": 1, "big": 9223372036854775808}"#);
        assert!(e.message.starts_with("invalid command: "), "{}", e.message);
        assert!(e.message.contains("cannot represent"), "{}", e.message);
        // 2^64 không vừa cả u64: JSON coi là số thực, không mất dấu hay bị cắt.
        let mut c = only(r#"{"ping": 1, "big": 18446744073709551616}"#);
        let raw = c.to_raw(10).unwrap();
        assert_eq!(
            raw.get("big").unwrap(),
            Some(RawBsonRef::Double(18_446_744_073_709_551_616.0))
        );
    }

    #[test]
    fn extended_json_values_become_their_bson_types() {
        let mut c = only(
            r#"{"insert": "c", "documents": [{
                "_id": {"$oid": "507f1f77bcf86cd799439011"},
                "at": {"$date": "2024-01-02T03:04:05.678Z"},
                "dec": {"$numberDecimal": "1.50"},
                "long": {"$numberLong": "42"},
                "int": {"$numberInt": "7"},
                "dbl": {"$numberDouble": "2.5"},
                "uuid": {"$uuid": "123e4567-e89b-12d3-a456-426614174000"},
                "bin": {"$binary": {"base64": "AQID", "subType": "00"}},
                "re": {"$regularExpression": {"pattern": "^a", "options": "i"}},
                "min": {"$minKey": 1}, "max": {"$maxKey": 1}
            }]}"#,
        );
        assert_eq!(c.kind, Kind::Write);
        let raw = c.to_raw(10).unwrap();
        let docs = match raw.get("documents").unwrap().unwrap() {
            RawBsonRef::Array(a) => a,
            other => panic!("{other:?}"),
        };
        let first = match docs.get(0).unwrap().unwrap() {
            RawBsonRef::Document(d) => d,
            other => panic!("{other:?}"),
        };
        let get = |k: &str| first.get(k).unwrap().unwrap();
        assert!(
            matches!(get("_id"), RawBsonRef::ObjectId(o) if o.to_hex() == "507f1f77bcf86cd799439011")
        );
        assert!(
            matches!(get("at"), RawBsonRef::DateTime(d) if d.timestamp_millis() == 1_704_164_645_678)
        );
        assert!(matches!(get("dec"), RawBsonRef::Decimal128(d) if d.to_string() == "1.50"));
        assert_eq!(get("long"), RawBsonRef::Int64(42));
        assert_eq!(get("int"), RawBsonRef::Int32(7));
        assert_eq!(get("dbl"), RawBsonRef::Double(2.5));
        assert!(matches!(get("uuid"), RawBsonRef::Binary(b)
            if b.subtype == BinarySubtype::Uuid && b.bytes.len() == 16 && b.bytes[0] == 0x12));
        assert!(matches!(get("bin"), RawBsonRef::Binary(b)
            if b.subtype == BinarySubtype::Generic && b.bytes == [1, 2, 3]));
        assert!(
            matches!(get("re"), RawBsonRef::RegularExpression(r) if r.pattern == "^a" && r.options == "i")
        );
        assert_eq!(get("min"), RawBsonRef::MinKey);
        assert_eq!(get("max"), RawBsonRef::MaxKey);
    }

    #[test]
    fn invalid_extended_json_value_is_a_syntax_error() {
        for text in [
            r#"{"find": "c", "filter": {"_id": {"$oid": "zz"}}}"#,
            r#"{"find": "c", "filter": {"at": {"$date": "not a date"}}}"#,
            r#"{"find": "c", "filter": {"n": {"$numberLong": "abc"}}}"#,
        ] {
            let e = error_of(text);
            assert!(
                e.message.starts_with("invalid command: "),
                "{text}: {}",
                e.message
            );
            assert!(e.message.ends_with(HINT), "{text}");
        }
    }

    // ---- to_raw: batchSize ----

    #[test]
    fn find_gets_a_batch_size_equal_to_the_page_size_when_missing() {
        let mut c = only(r#"{"find": "users", "filter": {"a": 1}}"#);
        let raw = c.to_raw(777).unwrap();
        assert_eq!(raw.get("batchSize").unwrap(), Some(RawBsonRef::Int64(777)));
        assert_eq!(keys(&mut c, 777), ["find", "filter", "batchSize"]);
    }

    #[test]
    fn find_keeps_a_batch_size_given_by_the_user() {
        for given in ["5", "0", "1000000"] {
            let mut c = only(&format!("{{\"find\": \"users\", \"batchSize\": {given}}}"));
            let raw = c.to_raw(777).unwrap();
            let want: i32 = given.parse().unwrap();
            assert_eq!(
                raw.get("batchSize").unwrap(),
                Some(RawBsonRef::Int32(want)),
                "{given}"
            );
        }
    }

    #[test]
    fn aggregate_gets_a_cursor_with_batch_size_when_it_has_none() {
        let mut c = only(r#"{"aggregate": "users", "pipeline": []}"#);
        let raw = c.to_raw(50).unwrap();
        let cursor = match raw.get("cursor").unwrap().unwrap() {
            RawBsonRef::Document(d) => d,
            other => panic!("{other:?}"),
        };
        assert_eq!(
            cursor.get("batchSize").unwrap(),
            Some(RawBsonRef::Int64(50))
        );
        assert!(
            raw.get("batchSize").unwrap().is_none(),
            "không thêm batchSize cấp ngoài"
        );
    }

    #[test]
    fn aggregate_and_list_commands_fill_in_or_keep_cursor_batch_size() {
        // `cursor` rỗng: thêm batchSize.
        let mut c = only(r#"{"aggregate": "u", "pipeline": [], "cursor": {}}"#);
        let raw = c.to_raw(9).unwrap();
        let RawBsonRef::Document(cursor) = raw.get("cursor").unwrap().unwrap() else {
            panic!("cursor không phải document");
        };
        assert_eq!(cursor.get("batchSize").unwrap(), Some(RawBsonRef::Int64(9)));
        // Người dùng đã đặt: giữ nguyên, kiểu int32 như người dùng gõ.
        let mut c = only(r#"{"listCollections": 1, "cursor": {"batchSize": 3}}"#);
        let raw = c.to_raw(9).unwrap();
        let RawBsonRef::Document(cursor) = raw.get("cursor").unwrap().unwrap() else {
            panic!("cursor không phải document");
        };
        assert_eq!(cursor.get("batchSize").unwrap(), Some(RawBsonRef::Int32(3)));
        // `listIndexes` không có `cursor` cũng được thêm.
        let mut c = only(r#"{"listIndexes": "users"}"#);
        assert_eq!(keys(&mut c, 9), ["listIndexes", "cursor"]);
    }

    #[test]
    fn a_non_document_cursor_is_left_for_the_server_to_reject() {
        let mut c = only(r#"{"aggregate": "u", "pipeline": [], "cursor": 5}"#);
        let raw = c.to_raw(9).unwrap();
        assert_eq!(raw.get("cursor").unwrap(), Some(RawBsonRef::Int32(5)));
    }

    #[test]
    fn write_and_plain_commands_are_sent_unchanged() {
        for text in [
            r#"{"insert": "c", "documents": [{"a": 1}]}"#,
            r#"{"update": "c", "updates": []}"#,
            r#"{"delete": "c", "deletes": []}"#,
            r#"{"ping": 1}"#,
            r#"{"count": "c"}"#,
        ] {
            let mut c = only(text);
            let before = keys(&mut c, 10);
            assert!(!before.contains(&"batchSize".to_owned()), "{text}");
            assert!(!before.contains(&"cursor".to_owned()), "{text}");
        }
    }

    #[test]
    fn to_raw_is_idempotent_and_keeps_the_command_name_first() {
        let mut c = only(r#"{"find": "c"}"#);
        let first = c.to_raw(20).unwrap();
        let second = c.to_raw(99).unwrap();
        // Lần hai không đổi batchSize đã thêm ở lần một.
        assert_eq!(first.as_bytes(), second.as_bytes());
        assert_eq!(keys(&mut c, 20)[0], "find");
    }

    #[test]
    fn huge_page_size_saturates_instead_of_wrapping() {
        let mut c = only(r#"{"find": "c"}"#);
        let raw = c.to_raw(usize::MAX).unwrap();
        assert_eq!(
            raw.get("batchSize").unwrap(),
            Some(RawBsonRef::Int64(i64::MAX))
        );
    }
}
