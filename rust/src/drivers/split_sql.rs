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
struct LineIndex<'a> {
    sql: &'a str,
    /// Byte offset đầu mỗi dòng.
    starts: Vec<usize>,
}

impl<'a> LineIndex<'a> {
    fn new(sql: &'a str) -> Self {
        let starts = std::iter::once(0)
            .chain(sql.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        Self { sql, starts }
    }

    /// Byte offset của `loc`; vị trí ngoài văn bản bị kẹp về cuối.
    fn offset(&self, loc: Location) -> usize {
        let line = usize::try_from(loc.line).unwrap_or(0).max(1);
        let Some(&start) = self.starts.get(line - 1) else {
            return self.sql.len();
        };
        let cols = usize::try_from(loc.column).unwrap_or(1).saturating_sub(1);
        let bytes: usize = self.sql[start..]
            .chars()
            .take(cols)
            .map(char::len_utf8)
            .sum();
        start + bytes
    }
}

/// PostgreSQL: cắt tại các token `;` của tokenizer.
fn postgres(sql: &str) -> Vec<Range<usize>> {
    let dialect = PostgreSqlDialect {};
    let Ok(tokens) = Tokenizer::new(&dialect, sql).tokenize_with_location() else {
        return whole(sql);
    };
    let lines = LineIndex::new(sql);
    let mut splitter = Splitter::new(sql);
    for t in &tokens {
        match t.token {
            Token::SemiColon => splitter.end(lines.offset(t.span.start)),
            // Comment cũng là `Whitespace` trong sqlparser.
            Token::Whitespace(_) | Token::EOF => {}
            _ => splitter.mark(lines.offset(t.span.start)),
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
mod tests {
    use super::*;

    /// Các câu tách được, đọc lại từ `sql` bằng khoảng byte (cũng kiểm khoảng nằm trên ranh giới ký tự).
    fn stmts(dialect: Dialect, sql: &str) -> Vec<&str> {
        split(dialect, sql).into_iter().map(|r| &sql[r]).collect()
    }

    fn pg(sql: &str) -> Vec<&str> {
        stmts(Dialect::Postgres, sql)
    }

    fn my(sql: &str) -> Vec<&str> {
        stmts(Dialect::MySql, sql)
    }

    fn ms(sql: &str) -> Vec<&str> {
        stmts(Dialect::SqlServer, sql)
    }

    // ---- PostgreSQL ----

    #[test]
    fn pg_basic_split_and_last_statement_without_semicolon() {
        assert_eq!(pg("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(pg("SELECT 1;SELECT 2;"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(
            pg("  SELECT 1  ;\n\n  SELECT 2  \n"),
            ["SELECT 1", "SELECT 2"]
        );
        assert_eq!(pg("SELECT 1"), ["SELECT 1"]);
    }

    #[test]
    fn pg_semicolon_in_string_literal_does_not_split() {
        assert_eq!(pg("SELECT 'a;b'; SELECT 2"), ["SELECT 'a;b'", "SELECT 2"]);
        assert_eq!(
            pg("SELECT 'it''s;x'; SELECT 2"),
            ["SELECT 'it''s;x'", "SELECT 2"]
        );
    }

    #[test]
    fn pg_semicolon_in_escape_string_does_not_split() {
        assert_eq!(
            pg(r"SELECT E'a\';b'; SELECT 2"),
            [r"SELECT E'a\';b'", "SELECT 2"]
        );
        assert_eq!(
            pg(r"SELECT e'x\\'; SELECT 2"),
            [r"SELECT e'x\\'", "SELECT 2"]
        );
    }

    #[test]
    fn pg_semicolon_in_quoted_identifier_does_not_split() {
        assert_eq!(
            pg(r#"SELECT "a;b" FROM "t;1"; SELECT 2"#),
            [r#"SELECT "a;b" FROM "t;1""#, "SELECT 2"]
        );
    }

    #[test]
    fn pg_dollar_quoted_bodies_do_not_split() {
        assert_eq!(
            pg(
                "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT f()"
            ),
            [
                "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql",
                "SELECT f()"
            ]
        );
        assert_eq!(
            pg("DO $body$ BEGIN PERFORM 1; PERFORM $$x;$$; END $body$; SELECT 2"),
            [
                "DO $body$ BEGIN PERFORM 1; PERFORM $$x;$$; END $body$",
                "SELECT 2"
            ]
        );
        // Thẻ khác nhau không kết thúc nhau: `$a$ ... $b$ ; ... $a$`.
        assert_eq!(
            pg("SELECT $a$ x $b$ ; y $a$; SELECT 2"),
            ["SELECT $a$ x $b$ ; y $a$", "SELECT 2"]
        );
    }

    #[test]
    fn pg_comments_hide_semicolons_and_are_dropped_before_statements() {
        assert_eq!(
            pg("-- a; b\nSELECT 1; /* c; d */ SELECT 2"),
            ["SELECT 1", "SELECT 2"]
        );
        // Comment lồng nhau: `;` bên trong cả hai tầng không tách.
        assert_eq!(
            pg("/* a /* b; */ c; */ SELECT 1; SELECT 2"),
            ["SELECT 1", "SELECT 2"]
        );
        assert_eq!(
            pg("SELECT 1 /* x; /* y; */ z; */; SELECT 2"),
            ["SELECT 1 /* x; /* y; */ z; */", "SELECT 2"]
        );
        // Comment sau `;` cuối không tạo câu.
        assert_eq!(pg("SELECT 1; -- done"), ["SELECT 1"]);
        assert_eq!(pg("SELECT 1; /* tail */"), ["SELECT 1"]);
    }

    #[test]
    fn pg_dash_comment_is_not_a_string_end() {
        assert_eq!(pg("SELECT '--'; SELECT 2"), ["SELECT '--'", "SELECT 2"]);
        assert_eq!(
            pg("SELECT 1 -- c\n; SELECT 2"),
            ["SELECT 1 -- c", "SELECT 2"]
        );
    }

    #[test]
    fn pg_empty_and_comment_only_have_no_statements() {
        for sql in [
            "",
            "   ",
            "\n\t\r\n",
            ";",
            ";;;",
            " ; ; ",
            "-- only a comment",
            "/* only */",
            "/* a */ -- b\n ; /* c */ ;",
        ] {
            assert!(pg(sql).is_empty(), "{sql:?} -> {:?}", pg(sql));
        }
    }

    #[test]
    fn pg_tokenizer_error_makes_the_whole_text_one_statement() {
        assert_eq!(pg("SELECT 'abc; SELECT 2"), ["SELECT 'abc; SELECT 2"]);
        assert_eq!(
            pg("  SELECT 1; /* never closed ; SELECT 2  \n"),
            ["SELECT 1; /* never closed ; SELECT 2"]
        );
        assert_eq!(pg("SELECT $$ open; SELECT 2"), ["SELECT $$ open; SELECT 2"]);
        // Chỉ chứa khoảng trắng + token hỏng vẫn là một câu (server báo lỗi).
        assert_eq!(pg(" 'x "), ["'x"]);
    }

    #[test]
    fn pg_ranges_are_correct_byte_offsets_for_unicode() {
        let sql = "SELECT 'Việt;Nam', 'ünï'; SELECT '日本;語' /* ✓ */; -- ✓\nSELECT '😀;😀'";
        assert_eq!(
            pg(sql),
            [
                "SELECT 'Việt;Nam', 'ünï'",
                "SELECT '日本;語' /* ✓ */",
                "SELECT '😀;😀'"
            ]
        );
        // Ký tự nhiều byte ngay trước dấu `;`, trên nhiều dòng, có CRLF.
        let sql = "SELECT 'é'\r\n;\r\nSELECT 'ñ日😀'\r\n;SELECT 3";
        assert_eq!(pg(sql), ["SELECT 'é'", "SELECT 'ñ日😀'", "SELECT 3"]);
    }

    #[test]
    fn pg_string_spanning_lines_keeps_following_offsets_right() {
        let sql = "SELECT 'line1\nline2;\nline3é'; SELECT 2";
        assert_eq!(pg(sql), ["SELECT 'line1\nline2;\nline3é'", "SELECT 2"]);
    }

    #[test]
    fn pg_ranges_are_ordered_non_overlapping_and_trimmed() {
        let sql = "  SELECT 1 ;  \n -- c\n INSERT INTO t VALUES ('é') ;\n\nSELECT 3  ";
        let ranges = split(Dialect::Postgres, sql);
        assert_eq!(ranges.len(), 3);
        let mut prev_end = 0;
        for r in &ranges {
            assert!(r.start >= prev_end && r.start < r.end);
            let s = &sql[r.clone()];
            assert_eq!(s, s.trim());
            prev_end = r.end;
        }
    }

    // ---- MySQL / MariaDB ----

    #[test]
    fn my_basic_split() {
        assert_eq!(my("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(my("SELECT 1;\n\nSELECT 2;\n"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(my(";;"), Vec::<&str>::new());
    }

    #[test]
    fn my_hash_comment_hides_semicolons() {
        assert_eq!(my("SELECT 1; # c; x\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(my("# only a comment"), Vec::<&str>::new());
        // `#` trong chuỗi hay identifier không phải comment.
        assert_eq!(
            my("SELECT '#;'; SELECT `#;`"),
            ["SELECT '#;'", "SELECT `#;`"]
        );
    }

    #[test]
    fn my_dash_comment_needs_whitespace_after() {
        assert_eq!(my("SELECT 1; -- c; x\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(my("SELECT 1; --\tc; x\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        // `1--1` là phép tính, không phải comment: `;` vẫn tách.
        assert_eq!(my("SELECT 1--1; SELECT 2"), ["SELECT 1--1", "SELECT 2"]);
        // `--` ở cuối chuỗi là comment rỗng.
        assert_eq!(my("SELECT 1; --"), ["SELECT 1"]);
    }

    #[test]
    fn my_block_comment_does_not_nest() {
        assert_eq!(
            my("SELECT 1 /* a; */; SELECT 2"),
            ["SELECT 1 /* a; */", "SELECT 2"]
        );
        // MySQL không lồng: `*/` đầu tiên kết thúc comment, nên `;` sau đó tách.
        assert_eq!(
            my("SELECT 1 /* a /* b */ ; SELECT 2"),
            ["SELECT 1 /* a /* b */", "SELECT 2"]
        );
    }

    #[test]
    fn my_backtick_identifier_hides_semicolon() {
        assert_eq!(
            my("SELECT `a;b` FROM `t``;x`; SELECT 2"),
            ["SELECT `a;b` FROM `t``;x`", "SELECT 2"]
        );
    }

    #[test]
    fn my_backslash_escape_in_strings() {
        assert_eq!(
            my(r"SELECT 'it\'s;x'; SELECT 2"),
            [r"SELECT 'it\'s;x'", "SELECT 2"]
        );
        assert_eq!(
            my(r#"SELECT "a\";b"; SELECT 2"#),
            [r#"SELECT "a\";b""#, "SELECT 2"]
        );
        assert_eq!(my(r"SELECT 'a\\'; SELECT 2"), [r"SELECT 'a\\'", "SELECT 2"]);
        // Dấu nháy viết đôi vẫn là ký tự thường.
        assert_eq!(
            my("SELECT 'a''b;c'; SELECT 2"),
            ["SELECT 'a''b;c'", "SELECT 2"]
        );
    }

    #[test]
    fn my_delimiter_command_for_procedures() {
        let sql = "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nCALL p();";
        assert_eq!(
            my(sql),
            [
                "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
                "CALL p()"
            ]
        );
    }

    #[test]
    fn my_delimiter_variants() {
        // Chữ thường, dấu nhiều ký tự, `\r\n`.
        let sql = "delimiter //\r\nSELECT 1; SELECT 2//\r\nSELECT 3//\r\ndelimiter ;\r\nSELECT 4;";
        assert_eq!(my(sql), ["SELECT 1; SELECT 2", "SELECT 3", "SELECT 4"]);
        // Dấu mới nằm trong chuỗi/comment thì không tách.
        assert_eq!(
            my("DELIMITER $$\nSELECT '$$', `$$` /* $$ */ # $$\n$$\nSELECT 2$$"),
            ["SELECT '$$', `$$` /* $$ */ # $$", "SELECT 2"]
        );
        // `;` không còn là dấu kết câu sau khi đổi.
        assert_eq!(
            my("DELIMITER $$\nSELECT 1; SELECT 2$$"),
            ["SELECT 1; SELECT 2"]
        );
    }

    #[test]
    fn my_delimiter_at_end_of_text_and_without_argument() {
        assert_eq!(my("SELECT 1;\nDELIMITER $$"), ["SELECT 1"]);
        assert_eq!(my("SELECT 1;\nDELIMITER"), ["SELECT 1"]);
        assert_eq!(my("DELIMITER"), Vec::<&str>::new());
        assert_eq!(my("DELIMITER $$"), Vec::<&str>::new());
        // Không có đối số: giữ dấu cũ.
        assert_eq!(
            my("DELIMITER\nSELECT 1; SELECT 2"),
            ["SELECT 1", "SELECT 2"]
        );
        // Lệnh cắt câu đang dở (không có `;`) ngay trước nó.
        assert_eq!(
            my("SELECT 1\nDELIMITER $$\nSELECT 2$$"),
            ["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn my_delimiter_only_at_line_start_and_as_whole_word() {
        assert_eq!(
            my("SELECT delimiter FROM t; SELECT 2"),
            ["SELECT delimiter FROM t", "SELECT 2"]
        );
        assert_eq!(
            my("SELECT\ndelimiter_col FROM t"),
            ["SELECT\ndelimiter_col FROM t"]
        );
        assert_eq!(my("SELECT 1;\ndelimiters\n;"), ["SELECT 1", "delimiters"]);
    }

    #[test]
    fn my_last_statement_without_delimiter_and_unterminated_tokens() {
        assert_eq!(my("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(my("SELECT 'abc; SELECT 2"), ["SELECT 'abc; SELECT 2"]);
        assert_eq!(my("SELECT `abc; SELECT 2"), ["SELECT `abc; SELECT 2"]);
        assert_eq!(
            my("SELECT 1 /* open; SELECT 2"),
            ["SELECT 1 /* open; SELECT 2"]
        );
        // Dấu `\` cuối chuỗi không làm tràn chỉ số.
        assert_eq!(my("SELECT 'a\\"), ["SELECT 'a\\"]);
    }

    #[test]
    fn my_unicode_offsets() {
        let sql = "SELECT 'Việt;Nam'; # ✓ ;\nSELECT `日本;語`, 'é😀'; SELECT 3";
        assert_eq!(
            my(sql),
            ["SELECT 'Việt;Nam'", "SELECT `日本;語`, 'é😀'", "SELECT 3"]
        );
        // Dòng bắt đầu bằng ký tự nhiều byte (không làm hỏng việc tìm `DELIMITER`).
        assert_eq!(
            my("SELECT 1;\n日本語日本語日本語 FROM t;"),
            ["SELECT 1", "日本語日本語日本語 FROM t"]
        );
        assert_eq!(
            my("DELIMITER $$\nSELECT 'é'$$\nSELECT 2$$"),
            ["SELECT 'é'", "SELECT 2"]
        );
    }

    #[test]
    fn my_empty_and_comment_only() {
        for sql in [
            "",
            "  \n",
            "-- c",
            "# c",
            "/* c */",
            "/* a */ # b\n -- c\n ;",
        ] {
            assert!(my(sql).is_empty(), "{sql:?}");
        }
    }

    // ---- SQL Server ----

    #[test]
    fn ms_go_on_its_own_line_splits() {
        assert_eq!(ms("SELECT 1\nGO\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(ms("SELECT 1\ngo\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(ms("SELECT 1\nGo\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(ms("SELECT 1\n   GO   \nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(ms("SELECT 1\n\tgO\t\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
        assert_eq!(
            ms("SELECT 1\r\nGO\r\nSELECT 2\r\nGO\r\n"),
            ["SELECT 1", "SELECT 2"]
        );
        assert_eq!(
            ms("SELECT 1\nGO -- batch end\nSELECT 2"),
            ["SELECT 1", "SELECT 2"]
        );
        assert_eq!(ms("SELECT 1\nGO--x\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn ms_go_at_start_and_end_of_text() {
        assert_eq!(ms("GO\nSELECT 1"), ["SELECT 1"]);
        assert_eq!(ms("SELECT 1\nGO"), ["SELECT 1"]);
        assert_eq!(ms("GO"), Vec::<&str>::new());
        assert_eq!(ms("GO\nGO\n  go  "), Vec::<&str>::new());
        assert_eq!(ms("SELECT 1\nGO\nGO\nSELECT 2"), ["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn ms_go_inside_string_comment_or_bracket_does_not_split() {
        assert_eq!(ms("SELECT 'a\nGO\nb'"), ["SELECT 'a\nGO\nb'"]);
        assert_eq!(ms("SELECT \"a\nGO\nb\""), ["SELECT \"a\nGO\nb\""]);
        assert_eq!(ms("SELECT [a\nGO\nb] FROM t"), ["SELECT [a\nGO\nb] FROM t"]);
        assert_eq!(ms("SELECT 1 /* a\nGO\nb */"), ["SELECT 1 /* a\nGO\nb */"]);
        assert_eq!(
            ms("SELECT 1 -- x\n-- GO\nFROM t"),
            ["SELECT 1 -- x\n-- GO\nFROM t"]
        );
    }

    #[test]
    fn ms_block_comments_nest() {
        assert_eq!(
            ms("/* a /* b\nGO\n*/ c\nGO\n*/\nSELECT 1\nGO\nSELECT 2"),
            ["SELECT 1", "SELECT 2"]
        );
        // Comment chưa đóng nuốt hết phần còn lại.
        assert_eq!(
            ms("SELECT 1 /* a /* b */\nGO\nSELECT 2"),
            ["SELECT 1 /* a /* b */\nGO\nSELECT 2"]
        );
    }

    #[test]
    fn ms_goto_and_go_with_arguments_do_not_split() {
        assert_eq!(ms("GOTO label"), ["GOTO label"]);
        assert_eq!(
            ms("SELECT 1\nGOTO end\nSELECT 2"),
            ["SELECT 1\nGOTO end\nSELECT 2"]
        );
        assert_eq!(
            ms("SELECT 1\nGOSUB\nSELECT 2"),
            ["SELECT 1\nGOSUB\nSELECT 2"]
        );
        assert_eq!(ms("SELECT 1\nGO;\nSELECT 2"), ["SELECT 1\nGO;\nSELECT 2"]);
        // `GO <số>` không hỗ trợ: dòng đó được gửi nguyên cho server.
        assert_eq!(ms("SELECT 1\nGO 5\nSELECT 2"), ["SELECT 1\nGO 5\nSELECT 2"]);
        // `GO` không đứng đầu dòng thì không phải lệnh.
        assert_eq!(ms("SELECT 1 GO\nSELECT 2"), ["SELECT 1 GO\nSELECT 2"]);
        assert_eq!(ms("SELECT go FROM t"), ["SELECT go FROM t"]);
    }

    #[test]
    fn ms_semicolon_does_not_split() {
        assert_eq!(ms("SELECT 1; SELECT 2"), ["SELECT 1; SELECT 2"]);
        assert_eq!(
            ms("INSERT INTO t VALUES (1);\nSELECT * FROM t;\nGO\nSELECT 3;"),
            ["INSERT INTO t VALUES (1);\nSELECT * FROM t;", "SELECT 3;"]
        );
    }

    #[test]
    fn ms_hash_is_a_temp_table_prefix_not_a_comment() {
        assert_eq!(ms("#tmp\nGO\nSELECT 2"), ["#tmp", "SELECT 2"]);
        assert_eq!(ms("SELECT * FROM #t\nGO"), ["SELECT * FROM #t"]);
    }

    #[test]
    fn ms_doubled_quotes_and_double_dash_comment() {
        assert_eq!(ms("SELECT 'it''s\nGO\nx'"), ["SELECT 'it''s\nGO\nx'"]);
        assert_eq!(
            ms("SELECT 1 --x\nGO\nSELECT 2"),
            ["SELECT 1 --x", "SELECT 2"]
        );
        // Trong T-SQL `\` không phải ký tự escape.
        assert_eq!(
            ms("SELECT 'a\\'\nGO\nSELECT 2"),
            ["SELECT 'a\\'", "SELECT 2"]
        );
    }

    #[test]
    fn ms_comment_only_and_empty() {
        for sql in [
            "",
            "\n",
            "-- c",
            "/* c */",
            "/* a */\nGO\n-- b\nGO",
            "GO -- only",
        ] {
            assert!(ms(sql).is_empty(), "{sql:?}");
        }
    }

    #[test]
    fn ms_unicode_offsets() {
        assert_eq!(
            ms("SELECT N'Việt Nam'\nGO\nSELECT N'日本語😀'\nGO\nSELECT 'é'"),
            ["SELECT N'Việt Nam'", "SELECT N'日本語😀'", "SELECT 'é'"]
        );
        // Dòng bắt đầu bằng ký tự nhiều byte: `GO`/`DELIMITER` không được cắt giữa ký tự.
        assert_eq!(ms("SELECT 1\né\nGO\nSELECT 2"), ["SELECT 1\né", "SELECT 2"]);
        assert_eq!(ms("日本語\nGO\n語"), ["日本語", "語"]);
    }

    #[test]
    fn ms_unterminated_tokens_run_to_end() {
        assert_eq!(
            ms("SELECT 'abc\nGO\nSELECT 2"),
            ["SELECT 'abc\nGO\nSELECT 2"]
        );
        assert_eq!(
            ms("SELECT [abc\nGO\nSELECT 2"),
            ["SELECT [abc\nGO\nSELECT 2"]
        );
    }

    // ---- chung ----

    #[test]
    fn all_dialects_ranges_are_valid_slices_for_hostile_input() {
        let inputs = [
            "é",
            "'é",
            "é'",
            "\\é",
            "`é",
            "[é",
            "/*é",
            "-- é",
            "#é",
            "DELIMITER é\nSELECT 1é\nSELECT 2é",
            "GO\né\nGO",
            "😀;😀",
            "\n\n;\n\n",
            "SELECT 1;\r\n\r\nGO\r\n",
        ];
        for sql in inputs {
            for d in [Dialect::Postgres, Dialect::MySql, Dialect::SqlServer] {
                for r in split(d, sql) {
                    assert!(r.start < r.end && r.end <= sql.len(), "{d:?} {sql:?} {r:?}");
                    // Cắt được (đúng ranh giới ký tự) và không còn khoảng trắng hai đầu.
                    let s = &sql[r];
                    assert_eq!(s, s.trim(), "{d:?} {sql:?}");
                }
            }
        }
    }
}
