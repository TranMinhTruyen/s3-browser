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
#[path = "../../../tests/unit/drivers/redis/command.rs"]
mod tests;
