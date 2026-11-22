//! Đọc văn bản người dùng gõ thành các lệnh Redis, tách token giống `redis-cli`.
//!
//! Vị trí trong luồng: `actor::execute` gọi `parse` với trường `sql` của request; mỗi dòng thành
//! một `Command` (danh sách đối số dạng byte) rồi được gửi lần lượt qua connection. Phần này
//! thuần (không chạm mạng) nên test được riêng.
//!
//! Cú pháp (theo `sdssplitargs` của Redis): mỗi dòng không rỗng là một lệnh; token cách nhau
//! bằng khoảng trắng. Chuỗi trong `"..."` hiểu `\n \r \t \b \a \\ \"` và `\xHH` (byte thô); chuỗi
//! trong `'...'` giữ nguyên mọi ký tự, chỉ có `\'`. Dấu nháy đóng phải theo sau bởi khoảng trắng
//! hoặc hết dòng. Lệnh đổi connection sang chế độ không bao giờ kết thúc (`SUBSCRIBE`,
//! `MONITOR`...) bị từ chối vì một request phải có kết quả.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `Vec<u8>` là chuỗi byte tuỳ ý (khác `String` luôn là UTF-8): đối số Redis là byte nhị phân,
//!   `\xHH` có thể tạo ra byte không phải UTF-8.
//! - `Peekable<Chars>`/`CharIndices`: duyệt từng ký tự và xem trước ký tự kế tiếp mà chưa lấy đi.

/// Các lệnh đổi connection sang chế độ không bao giờ kết thúc hoặc đổi hẳn giao thức, nên không
/// chạy được như một request có kết quả. Tên viết hoa.
const BLOCKED: [&str; 6] = [
    "SUBSCRIBE",
    "PSUBSCRIBE",
    "SSUBSCRIBE",
    "MONITOR",
    "SYNC",
    "PSYNC",
];

/// Một lệnh đã tách token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    /// Nội dung dòng đã cắt khoảng trắng (đưa vào `StatementResult.sql`).
    pub text: String,
    /// Tên lệnh rồi các đối số; luôn có ít nhất một phần tử.
    pub args: Vec<Vec<u8>>,
}

impl Command {
    /// Số DB mà lệnh này chuyển connection sang nếu nó là `SELECT <số>` hợp lệ, để actor nhớ và
    /// chọn lại khi phải nối lại connection.
    pub fn selected_db(&self) -> Option<i64> {
        let [name, db] = self.args.as_slice() else {
            return None;
        };
        if !name.eq_ignore_ascii_case(b"SELECT") {
            return None;
        }
        std::str::from_utf8(db).ok()?.parse().ok()
    }
}

/// Lỗi ở một dòng.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Dòng lỗi (đã cắt khoảng trắng), đưa vào `StatementResult.sql`.
    pub text: String,
    /// Mô tả lỗi kèm số dòng trong toàn văn bản.
    pub message: String,
}

/// Kết quả đọc cả văn bản: các lệnh đọc được trước chỗ lỗi và lỗi đầu tiên (nếu có). Lệnh đứng
/// trước chỗ lỗi vẫn chạy, các lệnh sau lỗi không chạy (giống SQL: câu 1 chạy rồi câu 2 mới
/// báo lỗi cú pháp).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Parsed {
    pub commands: Vec<Command>,
    pub error: Option<ParseError>,
}

/// Tách `text` thành các lệnh, mỗi dòng không rỗng một lệnh. Văn bản rỗng cho `Parsed` rỗng.
pub fn parse(text: &str) -> Parsed {
    let mut commands = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let fail = |reason: &str| ParseError {
            text: line.to_owned(),
            message: format!("line {}: {reason}", index + 1),
        };
        let args = match split_args(line) {
            Ok(args) => args,
            Err(reason) => {
                return Parsed {
                    commands,
                    error: Some(fail(reason)),
                };
            }
        };
        // Dòng không rỗng nên có ít nhất một token; `first` chỉ để tránh `unwrap`.
        let Some(first) = args.first() else { continue };
        if BLOCKED
            .iter()
            .any(|b| first.eq_ignore_ascii_case(b.as_bytes()))
        {
            return Parsed {
                commands,
                error: Some(fail("command is not supported (it never ends)")),
            };
        }
        // `CLIENT REPLY OFF|SKIP` làm server ngừng trả lời nên lệnh sau treo tới khi huỷ.
        let is_word = |i: usize, w: &str| {
            args.get(i)
                .is_some_and(|a| a.eq_ignore_ascii_case(w.as_bytes()))
        };
        if is_word(0, "CLIENT") && is_word(1, "REPLY") && args.len() > 2 && !is_word(2, "ON") {
            return Parsed {
                commands,
                error: Some(fail(
                    "CLIENT REPLY is not supported (the server stops replying)",
                )),
            };
        }
        commands.push(Command {
            text: line.to_owned(),
            args,
        });
    }
    Parsed {
        commands,
        error: None,
    }
}

/// Tách một dòng thành token. Lỗi: dấu nháy chưa đóng, hoặc dấu nháy đóng không theo sau bởi
/// khoảng trắng.
fn split_args(line: &str) -> Result<Vec<Vec<u8>>, &'static str> {
    let mut chars = line.chars().peekable();
    let mut args = Vec::new();
    loop {
        while chars.next_if(|c| c.is_whitespace()).is_some() {}
        let Some(&first) = chars.peek() else {
            return Ok(args);
        };
        let mut token = Vec::new();
        match first {
            '"' => {
                chars.next();
                double_quoted(&mut chars, &mut token)?;
            }
            '\'' => {
                chars.next();
                single_quoted(&mut chars, &mut token)?;
            }
            _ => {
                while let Some(c) = chars.next_if(|c| !c.is_whitespace()) {
                    push_char(&mut token, c);
                }
            }
        }
        args.push(token);
    }
}

/// Ghi một ký tự dưới dạng byte UTF-8 của nó vào `out`.
fn push_char(out: &mut Vec<u8>, c: char) {
    let mut buf = [0u8; 4];
    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
}

/// Sau dấu nháy đóng phải là khoảng trắng hoặc hết dòng (`"a"b` là lỗi, như `redis-cli`).
fn closed(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Result<(), &'static str> {
    match chars.peek() {
        Some(c) if !c.is_whitespace() => Err("closing quote must be followed by a space"),
        _ => Ok(()),
    }
}

/// Đọc phần trong `"..."` (dấu mở đã lấy), có escape.
fn double_quoted(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
    out: &mut Vec<u8>,
) -> Result<(), &'static str> {
    loop {
        match chars.next() {
            None => return Err("unterminated double quote"),
            Some('"') => return closed(chars),
            Some('\\') => {
                let Some(e) = chars.next() else {
                    return Err("unterminated double quote");
                };
                match e {
                    'x' => {
                        // `\xHH` chỉ có hiệu lực khi đủ hai chữ số hex; không thì giữ `x` như `redis-cli`.
                        let hi = chars.next_if(char::is_ascii_hexdigit);
                        let lo = hi.and_then(|_| chars.next_if(char::is_ascii_hexdigit));
                        match (hi, lo) {
                            (Some(h), Some(l)) => out.push((hex_value(h) << 4) | hex_value(l)),
                            (Some(h), None) => {
                                out.push(b'x');
                                push_char(out, h);
                            }
                            _ => out.push(b'x'),
                        }
                    }
                    'n' => out.push(b'\n'),
                    'r' => out.push(b'\r'),
                    't' => out.push(b'\t'),
                    'b' => out.push(0x08),
                    'a' => out.push(0x07),
                    other => push_char(out, other),
                }
            }
            Some(c) => push_char(out, c),
        }
    }
}

/// Đọc phần trong `'...'` (dấu mở đã lấy): chỉ `\'` là escape.
fn single_quoted(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
    out: &mut Vec<u8>,
) -> Result<(), &'static str> {
    loop {
        match chars.next() {
            None => return Err("unterminated single quote"),
            Some('\'') => return closed(chars),
            Some('\\') if chars.peek() == Some(&'\'') => {
                chars.next();
                out.push(b'\'');
            }
            Some(c) => push_char(out, c),
        }
    }
}

/// Giá trị 0–15 của một chữ số hex (đã kiểm `is_ascii_hexdigit`).
fn hex_value(c: char) -> u8 {
    c.to_digit(16).map_or(0, |d| d as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Các đối số của lệnh duy nhất trong `text`.
    fn only(text: &str) -> Vec<Vec<u8>> {
        let p = parse(text);
        assert_eq!(p.error, None, "{text:?}");
        assert_eq!(p.commands.len(), 1, "{text:?}");
        p.commands.into_iter().next().unwrap().args
    }

    fn bytes(items: &[&[u8]]) -> Vec<Vec<u8>> {
        items.iter().map(|b| b.to_vec()).collect()
    }

    fn error_of(text: &str) -> ParseError {
        parse(text)
            .error
            .unwrap_or_else(|| panic!("phải lỗi: {text:?}"))
    }

    // ---- văn bản rỗng và dòng trống ----

    #[test]
    fn empty_text_has_no_commands_and_no_error() {
        assert_eq!(parse(""), Parsed::default());
    }

    #[test]
    fn blank_lines_are_skipped() {
        for text in [" ", "   ", "\n", "\n\n  \n\t\n", " \r\n \r\n"] {
            assert_eq!(parse(text), Parsed::default(), "{text:?}");
        }
    }

    #[test]
    fn one_command_per_non_empty_line_with_the_trimmed_text() {
        let p = parse("  GET a  \n\n\tSET b 1\t\nPING");
        assert_eq!(p.error, None);
        let texts: Vec<_> = p.commands.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["GET a", "SET b 1", "PING"]);
        assert_eq!(p.commands[1].args, bytes(&[b"SET", b"b", b"1"]));
    }

    #[test]
    fn crlf_line_endings_do_not_leave_a_carriage_return() {
        let p = parse("GET a\r\nGET b\r\n");
        assert_eq!(p.commands.len(), 2);
        assert_eq!(p.commands[0].text, "GET a");
        assert_eq!(p.commands[0].args, bytes(&[b"GET", b"a"]));
        assert_eq!(p.commands[1].args, bytes(&[b"GET", b"b"]));
    }

    #[test]
    fn any_run_of_spaces_and_tabs_separates_tokens() {
        assert_eq!(only("SET \t  k\t\tv"), bytes(&[b"SET", b"k", b"v"]));
    }

    #[test]
    fn a_single_word_is_a_command_without_arguments() {
        assert_eq!(only("PING"), bytes(&[b"PING"]));
    }

    // ---- nháy kép ----

    #[test]
    fn double_quotes_group_words_and_keep_spaces() {
        assert_eq!(
            only(r#"SET "a b  c" "x""#),
            bytes(&[b"SET", b"a b  c", b"x"])
        );
    }

    #[test]
    fn empty_quoted_strings_are_empty_arguments() {
        assert_eq!(only(r#"SET k """#), bytes(&[b"SET", b"k", b""]));
        assert_eq!(only("SET k ''"), bytes(&[b"SET", b"k", b""]));
        assert_eq!(only(r#""""#), bytes(&[b""]));
    }

    #[test]
    fn double_quote_escapes() {
        assert_eq!(
            only(r#"X "a\nb\rc\td\be\af\\g\"h""#),
            bytes(&[b"X", b"a\nb\rc\td\x08e\x07f\\g\"h"])
        );
    }

    #[test]
    fn unknown_escape_keeps_the_character_without_the_backslash() {
        assert_eq!(only(r#"X "\q\ \'""#), bytes(&[b"X", b"q '"]));
    }

    #[test]
    fn hex_escape_makes_a_raw_byte() {
        assert_eq!(only(r#"X "\x41\x4a\x4A""#), bytes(&[b"X", b"AJJ"]));
        assert_eq!(only(r#"X "\x00\x7f""#), bytes(&[b"X", &[0x00, 0x7f]]));
    }

    #[test]
    fn hex_escape_can_make_bytes_that_are_not_utf8() {
        assert_eq!(only(r#"X "\xff\xfe""#), bytes(&[b"X", &[0xff, 0xfe]]));
        assert_eq!(only(r#"X "\xc3\xa9""#), bytes(&[b"X", "é".as_bytes()]));
    }

    #[test]
    fn hex_escape_with_too_few_digits_keeps_the_text() {
        // Giống redis-cli: `\x` không đủ hai chữ số hex thì giữ `x` và các ký tự sau như thường.
        assert_eq!(only(r#"X "\x""#), bytes(&[b"X", b"x"]));
        assert_eq!(only(r#"X "\x4""#), bytes(&[b"X", b"x4"]));
        assert_eq!(only(r#"X "\xZZ""#), bytes(&[b"X", b"xZZ"]));
        assert_eq!(only(r#"X "\x4Z""#), bytes(&[b"X", b"x4Z"]));
        assert_eq!(only(r#"X "\xg1""#), bytes(&[b"X", b"xg1"]));
    }

    #[test]
    fn hex_escape_with_too_many_digits_takes_only_two() {
        assert_eq!(only(r#"X "\x414""#), bytes(&[b"X", b"A4"]));
        assert_eq!(only(r#"X "\x41\x42\x43""#), bytes(&[b"X", b"ABC"]));
    }

    #[test]
    fn non_ascii_text_is_kept_as_utf8_bytes() {
        assert_eq!(
            only("SET k\u{e9} \"t\u{1ebf}ng \u{1f600}\""),
            bytes(&[
                b"SET",
                "k\u{e9}".as_bytes(),
                "t\u{1ebf}ng \u{1f600}".as_bytes()
            ])
        );
        // Escape trước một ký tự nhiều byte giữ nguyên ký tự đó.
        assert_eq!(only("X \"\\\u{e9}\""), bytes(&[b"X", "\u{e9}".as_bytes()]));
    }

    #[test]
    fn single_quote_inside_double_quotes_is_a_normal_character() {
        assert_eq!(only(r#"X "it's""#), bytes(&[b"X", b"it's"]));
    }

    // ---- nháy đơn ----

    #[test]
    fn single_quotes_keep_everything_literally() {
        assert_eq!(
            only(r#"SET 'a b' 'x\ny\x41"z'"#),
            bytes(&[b"SET", b"a b", br#"x\ny\x41"z"#])
        );
    }

    #[test]
    fn only_backslash_quote_is_an_escape_in_single_quotes() {
        assert_eq!(only(r"X 'it\'s'"), bytes(&[b"X", b"it's"]));
        // `\\` không phải escape trong `'...'`: dấu `\` cuối đứng trước nháy đóng thành escape `\'`
        // nên chuỗi chưa đóng (đúng như `sdssplitargs`).
        assert_eq!(
            error_of(r"X 'a\\'").message,
            "line 1: unterminated single quote"
        );
        assert_eq!(only(r"X 'a\\ b'"), bytes(&[b"X", br"a\\ b"]));
        assert_eq!(only(r"X 'a\b'"), bytes(&[b"X", br"a\b"]));
    }

    // ---- token không nháy ----

    #[test]
    fn quote_characters_inside_an_unquoted_word_are_literal() {
        assert_eq!(only(r#"X a"b c"d"#), bytes(&[b"X", b"a\"b", b"c\"d"]));
        assert_eq!(only("X a'b"), bytes(&[b"X", b"a'b"]));
    }

    #[test]
    fn backslashes_in_an_unquoted_word_are_literal() {
        assert_eq!(only(r"X a\nb \x41"), bytes(&[b"X", br"a\nb", br"\x41"]));
    }

    #[test]
    fn arguments_are_binary_safe_and_may_be_huge() {
        let big = "a".repeat(1 << 20);
        let args = only(&format!("SET k {big}"));
        assert_eq!(args[2].len(), 1 << 20);
        let quoted = format!("SET k \"{}\"", "\\xff".repeat(100_000));
        let args = only(&quoted);
        assert_eq!(args[2], vec![0xff; 100_000]);
    }

    // ---- lỗi cú pháp ----

    #[test]
    fn unterminated_quotes_are_errors_with_the_line_text_and_number() {
        let e = error_of(r#"SET k "abc"#);
        assert_eq!(e.text, r#"SET k "abc"#);
        assert_eq!(e.message, "line 1: unterminated double quote");
        let e = error_of("SET k 'abc");
        assert_eq!(e.message, "line 1: unterminated single quote");
        assert_eq!(
            error_of(r#"X ""#).message,
            "line 1: unterminated double quote"
        );
        assert_eq!(error_of("X '").message, "line 1: unterminated single quote");
    }

    #[test]
    fn a_backslash_at_the_end_of_a_double_quoted_string_is_unterminated() {
        assert_eq!(
            error_of(r#"X "abc\"#).message,
            "line 1: unterminated double quote"
        );
        // `\"` là nháy thoát nên chuỗi vẫn chưa đóng.
        assert_eq!(
            error_of(r#"X "abc\""#).message,
            "line 1: unterminated double quote"
        );
    }

    #[test]
    fn a_closing_quote_must_be_followed_by_a_space_or_the_end() {
        for text in [
            r#"X "a"b"#,
            "X 'a'b",
            r#"X "a""b""#,
            "X 'a''b'",
            r#"X "a"'b'"#,
        ] {
            let e = error_of(text);
            assert_eq!(
                e.message, "line 1: closing quote must be followed by a space",
                "{text}"
            );
            assert_eq!(e.text, text);
        }
    }

    #[test]
    fn a_closing_quote_followed_by_a_tab_or_the_end_is_fine() {
        assert_eq!(only("X \"a\"\tb"), bytes(&[b"X", b"a", b"b"]));
        assert_eq!(only("X 'a'\t'b'"), bytes(&[b"X", b"a", b"b"]));
        assert_eq!(only(r#""a" "b""#), bytes(&[b"a", b"b"]));
    }

    #[test]
    fn commands_before_a_syntax_error_are_kept_and_the_ones_after_are_dropped() {
        let p = parse("GET a\nSET \"b\nPING\nGET c");
        let texts: Vec<_> = p.commands.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["GET a"]);
        let e = p.error.expect("lỗi ở dòng 2");
        assert_eq!(e.text, "SET \"b");
        assert_eq!(e.message, "line 2: unterminated double quote");
    }

    #[test]
    fn error_line_numbers_count_blank_lines_too() {
        let e = error_of("\n\n  GET \"x  \n");
        assert_eq!(e.message, "line 3: unterminated double quote");
        assert_eq!(e.text, "GET \"x", "text là dòng đã cắt khoảng trắng");
    }

    #[test]
    fn a_syntax_error_on_the_first_line_leaves_no_commands() {
        let p = parse("'oops\nPING");
        assert!(p.commands.is_empty());
        assert!(p.error.is_some());
    }

    // ---- CLIENT REPLY (Q3) ----

    #[test]
    fn client_reply_off_and_skip_are_rejected_in_any_letter_case() {
        for text in [
            "CLIENT REPLY OFF",
            "client reply off",
            "Client Reply Skip",
            "CLIENT REPLY SKIP",
            "  client   reply   off  ",
        ] {
            let p = parse(text);
            assert!(p.commands.is_empty(), "{text}");
            let e = p.error.expect(text);
            assert_eq!(e.text, text.trim());
            assert!(e.message.contains("CLIENT REPLY"), "{}", e.message);
        }
    }

    #[test]
    fn client_reply_on_and_other_client_commands_are_allowed() {
        assert_eq!(
            only("CLIENT REPLY ON"),
            bytes(&[b"CLIENT", b"REPLY", b"ON"])
        );
        assert_eq!(
            only("client reply on"),
            bytes(&[b"client", b"reply", b"on"])
        );
        assert_eq!(only("CLIENT ID"), bytes(&[b"CLIENT", b"ID"]));
        assert_eq!(
            only("CLIENT SETNAME x"),
            bytes(&[b"CLIENT", b"SETNAME", b"x"])
        );
        // Thiếu đối số: để server báo lỗi arity, không chặn ở đây.
        assert_eq!(only("CLIENT REPLY"), bytes(&[b"CLIENT", b"REPLY"]));
    }

    #[test]
    fn a_blocked_client_reply_stops_the_commands_after_it_but_keeps_the_ones_before() {
        let p = parse(
            "PING
CLIENT REPLY OFF
GET a",
        );
        assert_eq!(p.commands.len(), 1);
        assert_eq!(p.commands[0].text, "PING");
        assert!(p.error.is_some());
    }

    // ---- lệnh bị chặn ----

    #[test]
    fn never_ending_commands_are_rejected_in_any_letter_case() {
        for name in [
            "SUBSCRIBE",
            "PSUBSCRIBE",
            "SSUBSCRIBE",
            "MONITOR",
            "SYNC",
            "PSYNC",
        ] {
            for variant in [
                name.to_owned(),
                name.to_lowercase(),
                format!("{}{}", &name[..1], name[1..].to_lowercase()),
            ] {
                let text = format!("{variant} chan");
                let p = parse(&text);
                assert!(p.commands.is_empty(), "{text}");
                let e = p.error.expect(&text);
                assert_eq!(e.text, text);
                assert_eq!(
                    e.message,
                    "line 1: command is not supported (it never ends)"
                );
            }
        }
    }

    #[test]
    fn a_blocked_command_is_found_even_when_the_name_is_quoted() {
        let e = error_of(r#""subscribe" news"#);
        assert_eq!(
            e.message,
            "line 1: command is not supported (it never ends)"
        );
        assert!(parse("'MONITOR'").error.is_some());
    }

    #[test]
    fn commands_before_a_blocked_one_run_and_the_ones_after_do_not() {
        let p = parse("PING\nGET a\nMONITOR\nPING");
        assert_eq!(p.commands.len(), 2);
        assert_eq!(
            p.error.expect("MONITOR").message,
            "line 3: command is not supported (it never ends)"
        );
    }

    #[test]
    fn similar_names_and_arguments_are_not_blocked() {
        for text in [
            "SUBSCRIBEX a",
            "XSUBSCRIBE a",
            "GET subscribe",
            "PUBLISH chan msg",
            "PUBSUB CHANNELS",
            "UNSUBSCRIBE",
            "SYNCX",
            "SET monitor 1",
        ] {
            let p = parse(text);
            assert_eq!(p.error, None, "{text}");
            assert_eq!(p.commands.len(), 1, "{text}");
        }
    }

    // ---- selected_db ----

    fn db_of(text: &str) -> Option<i64> {
        parse(text).commands.first().and_then(Command::selected_db)
    }

    #[test]
    fn select_with_a_number_reports_the_database() {
        assert_eq!(db_of("SELECT 5"), Some(5));
        assert_eq!(db_of("select 0"), Some(0));
        assert_eq!(db_of("Select 15"), Some(15));
        assert_eq!(db_of(r#"SELECT "7""#), Some(7));
        assert_eq!(db_of("SELECT 9223372036854775807"), Some(i64::MAX));
    }

    #[test]
    fn select_with_a_wrong_shape_reports_nothing() {
        for text in [
            "SELECT",
            "SELECT a",
            "SELECT 1 2",
            "SELECT 1.5",
            "SELECT ''",
            "SELECT 99999999999999999999",
            r#"SELECT "\xff""#,
            "GET 5",
            "SELECTX 5",
            "SET SELECT 5",
        ] {
            assert_eq!(db_of(text), None, "{text}");
        }
    }
}
