//! Tách một đoạn SQL nhiều câu thành từng câu, cho PostgreSQL, MySQL/MariaDB và SQL Server.
//!
//! Vị trí trong luồng: driver mạng gọi `split` trong actor trước khi chạy một `execute`; mỗi
//! khoảng byte trả về là một câu, chạy lần lượt và có `StatementResult` riêng. SQLite không dùng
//! file này vì SQLite tự tách bằng prepare-tail (xem `sqlite::split`).
//!
//! Cách tách theo từng DB:
//! - PostgreSQL: tokenizer của `sqlparser` (không parse cả câu). Chuỗi `'..'`, `E'..'`,
//!   `"ident"`, `$$..$$`, `$tag$..$tag$` và comment (kể cả lồng nhau) đều là một token nên `;`
//!   bên trong không tách. Extended protocol của PostgreSQL chỉ nhận một câu mỗi lần nên bắt buộc
//!   phải tách ở Rust.
//! - MySQL/MariaDB: bộ quét tự viết vì tokenizer của `sqlparser` không hiểu lệnh `DELIMITER`
//!   của client `mysql` (ví dụ `DELIMITER $$`) và coi `#` là toán tử. Hiểu chuỗi có `\` escape,
//!   backtick, comment `#`, `-- `, `/* */` và `DELIMITER`.
//! - SQL Server: tách theo dòng chỉ có `GO` (không phân biệt hoa thường), không tách theo `;`.
//!   `GO` nằm trong chuỗi, `[ident]` hay comment (có lồng nhau) thì không tách. Dạng `GO <số>`
//!   (lặp lại) không được hỗ trợ: dòng đó được gửi nguyên cho server.
//!
//! Khoảng trả về không gồm dấu kết câu (`;` hay `GO`), đã cắt khoảng trắng hai đầu và bỏ comment
//! đứng trước câu. Đoạn rỗng hoặc chỉ có comment thì không có câu nào. Tokenizer lỗi (PostgreSQL)
//! thì cả đoạn là một câu để server báo lỗi chính xác.
//!
//! Khái niệm Rust: `Range<usize>` là khoảng `start..end` theo byte, dùng để cắt `&sql[range]`
//! mà không copy chuỗi (giống `s[a:b]` của Go).

use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::tokenizer::{Location, Token, Tokenizer};
use std::ops::Range;

/// DB cần tách câu.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dialect {
    Postgres,
    MySql,
    SqlServer,
}

/// Tách `sql` thành các câu; mỗi phần tử là khoảng byte của một câu trong `sql`.
pub fn split(dialect: Dialect, sql: &str) -> Vec<Range<usize>> {
    match dialect {
        Dialect::Postgres => postgres(sql),
        Dialect::MySql | Dialect::SqlServer => scan(sql, dialect),
    }
}

/// Gom các câu: `first` là byte đầu tiên có nội dung thật (không phải khoảng trắng/comment)
/// của câu đang đọc, `end` chốt câu đó.
struct Splitter<'a> {
    sql: &'a str,
    first: Option<usize>,
    out: Vec<Range<usize>>,
}

impl<'a> Splitter<'a> {
    fn new(sql: &'a str) -> Self {
        Self {
            sql,
            first: None,
            out: Vec::new(),
        }
    }

    /// Đánh dấu byte `at` có nội dung; chỉ lần đầu của mỗi câu có tác dụng.
    fn mark(&mut self, at: usize) {
        self.first.get_or_insert(at);
    }

    /// Chốt câu đang đọc, kết thúc trước byte `at` (bỏ khoảng trắng cuối); chưa có nội dung
    /// thì không thêm gì.
    fn end(&mut self, at: usize) {
        if let Some(start) = self.first.take() {
            let end = start + self.sql[start..at].trim_end().len();
            self.out.push(start..end);
        }
    }
}

/// Đổi `Location` (dòng, cột đều đếm từ 1, cột đếm theo ký tự) của tokenizer sang byte offset.
///
/// Token đến theo thứ tự tăng dần nên con trỏ chỉ đi tới: nhảy dòng bằng `find('\n')` rồi đi
/// theo ký tự tới đúng cột. Tổng chi phí O(độ dài SQL), không duyệt lại từ đầu dòng cho mỗi token
/// (SQL một dòng dài sẽ thành O(n²) nếu làm vậy).
struct OffsetCursor<'a> {
    sql: &'a str,
    /// Dòng (từ 1) và cột (từ 1) con trỏ đang đứng, kèm byte offset tương ứng.
    line: u32,
    col: u32,
    byte: usize,
}

impl<'a> OffsetCursor<'a> {
    fn new(sql: &'a str) -> Self {
        Self {
            sql,
            line: 1,
            col: 1,
            byte: 0,
        }
    }

    /// Byte offset của `loc`; vị trí ngoài văn bản bị kẹp về cuối.
    fn offset(&mut self, loc: Location) -> usize {
        let line = u32::try_from(loc.line).unwrap_or(1).max(1);
        let col = u32::try_from(loc.column).unwrap_or(1).max(1);
        // Đi lùi (không xảy ra với token hợp lệ): quay về đầu văn bản cho đúng.
        if line < self.line || (line == self.line && col < self.col) {
            *self = Self::new(self.sql);
        }
        // Nhảy tới đầu dòng đích.
        while self.line < line {
            match self.sql[self.byte..].find('\n') {
                Some(i) => {
                    self.byte += i + 1;
                    self.line += 1;
                    self.col = 1;
                }
                None => return self.sql.len(),
            }
        }
        // Đi theo ký tự tới đúng cột; hết văn bản thì kẹp về cuối.
        while self.col < col {
            let Some(c) = self.sql[self.byte..].chars().next() else {
                return self.sql.len();
            };
            self.byte += c.len_utf8();
            self.col += 1;
            if c == '\n' {
                // Cột vượt quá dòng (không xảy ra với token hợp lệ): con trỏ lệch dòng, đặt lại từ đầu.
                let at = self.byte;
                *self = Self::new(self.sql);
                return at;
            }
        }
        self.byte
    }
}

/// PostgreSQL: cắt tại các token `;` của tokenizer.
fn postgres(sql: &str) -> Vec<Range<usize>> {
    let dialect = PostgreSqlDialect {};
    let Ok(tokens) = Tokenizer::new(&dialect, sql).tokenize_with_location() else {
        return whole(sql);
    };
    let mut cursor = OffsetCursor::new(sql);
    let mut splitter = Splitter::new(sql);
    for t in &tokens {
        match t.token {
            Token::SemiColon => splitter.end(cursor.offset(t.span.start)),
            // Comment cũng là `Whitespace` trong sqlparser.
            Token::Whitespace(_) | Token::EOF => {}
            // Chỉ token đầu câu cần offset; các token sau không đổi kết quả nên bỏ qua.
            _ if splitter.first.is_none() => splitter.mark(cursor.offset(t.span.start)),
            _ => {}
        }
    }
    splitter.end(sql.len());
    splitter.out
}

/// Cả đoạn là một câu (đã cắt khoảng trắng); rỗng thì không có câu nào.
fn whole(sql: &str) -> Vec<Range<usize>> {
    let mut splitter = Splitter::new(sql);
    if !sql.trim().is_empty() {
        splitter.mark(sql.len() - sql.trim_start().len());
    }
    splitter.end(sql.len());
    splitter.out
}

/// MySQL và SQL Server: quét từng byte, nhảy qua chuỗi/comment và tìm dấu kết câu.
/// Mọi ký tự đặc biệt đều là ASCII nên duyệt theo byte vẫn đúng với UTF-8.
fn scan(sql: &str, dialect: Dialect) -> Vec<Range<usize>> {
    let mysql = dialect == Dialect::MySql;
    let b = sql.as_bytes();
    let mut splitter = Splitter::new(sql);
    // Dấu kết câu của MySQL, đổi được bằng `DELIMITER`.
    let mut delimiter: &[u8] = b";";
    let mut line_start = true;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\n' {
            line_start = true;
            i += 1;
            continue;
        }
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        // Lệnh của client chiếm cả dòng: `DELIMITER x` (MySQL) hoặc `GO` (SQL Server).
        if std::mem::take(&mut line_start) {
            if mysql {
                if let Some((eol, arg)) = delimiter_line(sql, i) {
                    splitter.end(i);
                    if !arg.is_empty() {
                        delimiter = arg.as_bytes();
                    }
                    i = eol;
                    continue;
                }
            } else if let Some(eol) = go_line(sql, i) {
                splitter.end(i);
                i = eol;
                continue;
            }
        }
        if mysql && b[i..].starts_with(delimiter) {
            splitter.end(i);
            i += delimiter.len();
            continue;
        }
        // Comment: bỏ qua, không tính là nội dung.
        if let Some(next) = skip_comment(b, i, mysql) {
            i = next;
            continue;
        }
        splitter.mark(i);
        i = match c {
            b'\'' | b'"' => skip_quoted(b, i, c, mysql),
            b'`' if mysql => skip_quoted(b, i, c, false),
            b'[' if !mysql => skip_quoted(b, i, b']', false),
            _ => i + 1,
        };
    }
    splitter.end(sql.len());
    splitter.out
}

/// Nếu `i` là đầu một comment thì trả vị trí ngay sau nó (comment dòng dừng trước `\n`;
/// không đóng thì tới hết chuỗi).
fn skip_comment(b: &[u8], i: usize, mysql: bool) -> Option<usize> {
    let rest = &b[i..];
    let line_comment = match rest {
        [b'#', ..] => mysql,
        // MySQL chỉ coi `--` là comment khi theo sau là khoảng trắng hoặc hết chuỗi (`1--1` là phép tính).
        [b'-', b'-', after @ ..] => !mysql || after.first().is_none_or(u8::is_ascii_whitespace),
        _ => false,
    };
    if line_comment {
        return Some(
            rest.iter()
                .position(|&c| c == b'\n')
                .map_or(b.len(), |p| i + p),
        );
    }
    if !rest.starts_with(b"/*") {
        return None;
    }
    // SQL Server cho comment khối lồng nhau, MySQL thì không.
    let mut depth = 1;
    let mut j = i + 2;
    while j < b.len() {
        if b[j..].starts_with(b"*/") {
            depth -= 1;
            j += 2;
            if depth == 0 || mysql {
                return Some(j);
            }
        } else if !mysql && b[j..].starts_with(b"/*") {
            depth += 1;
            j += 2;
        } else {
            j += 1;
        }
    }
    Some(b.len())
}

/// Vị trí ngay sau dấu đóng của chuỗi/identifier mở ở `b[i]`. Dấu đóng viết đôi là ký tự thường
/// (`'it''s'`); `backslash` bật thêm `\x` của MySQL. Không đóng thì tới hết chuỗi.
fn skip_quoted(b: &[u8], i: usize, close: u8, backslash: bool) -> usize {
    let mut j = i + 1;
    while j < b.len() {
        match b[j] {
            b'\\' if backslash => j += 2,
            c if c == close && b.get(j + 1) == Some(&close) => j += 2,
            c if c == close => return j + 1,
            _ => j += 1,
        }
    }
    b.len()
}

/// Nếu dòng bắt đầu ở `i` là `DELIMITER <x>` (MySQL) thì trả (vị trí hết dòng, `<x>`); `<x>`
/// rỗng nghĩa là giữ dấu cũ.
fn delimiter_line(sql: &str, i: usize) -> Option<(usize, &str)> {
    const KEYWORD: &str = "delimiter";
    let head = sql.get(i..i + KEYWORD.len())?;
    let after = sql.as_bytes().get(i + KEYWORD.len());
    if !head.eq_ignore_ascii_case(KEYWORD) || !after.is_none_or(u8::is_ascii_whitespace) {
        return None;
    }
    let eol = sql[i..].find('\n').map_or(sql.len(), |p| i + p);
    let arg = sql[i + KEYWORD.len()..eol].split_whitespace().next();
    Some((eol, arg.unwrap_or("")))
}

/// Nếu dòng bắt đầu ở `i` chỉ có `GO` (và comment `--` tuỳ chọn) thì trả vị trí hết dòng.
fn go_line(sql: &str, i: usize) -> Option<usize> {
    let head = sql.get(i..i + 2)?;
    if !head.eq_ignore_ascii_case("go") {
        return None;
    }
    let eol = sql[i..].find('\n').map_or(sql.len(), |p| i + p);
    let rest = sql[i + 2..eol].trim();
    (rest.is_empty() || rest.starts_with("--")).then_some(eol)
}

#[cfg(test)]
#[path = "../../tests/unit/drivers/split_sql.rs"]
mod tests;
