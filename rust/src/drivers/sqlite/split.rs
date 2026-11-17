//! Phát hiện phần SQL còn lại chỉ gồm khoảng trắng, comment và `;`.
//!
//! Việc tách câu thật do SQLite làm (prepare-tail, xem `raw::prepare_next`); hàm này chỉ để biết
//! câu vừa prepare có phải câu cuối không mà không cần prepare câu sau (câu sau có thể phụ thuộc
//! câu trước nên chưa prepare được).

/// `true` nếu `rest` không còn câu lệnh nào.
pub fn only_trivia(rest: &[u8]) -> bool {
    let mut i = 0;
    while i < rest.len() {
        match rest[i] {
            b if b.is_ascii_whitespace() || b == b';' => i += 1,
            b'-' if rest.get(i + 1) == Some(&b'-') => {
                // Comment dòng: tới hết dòng.
                i = rest[i..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map_or(rest.len(), |p| i + p + 1);
            }
            b'/' if rest.get(i + 1) == Some(&b'*') => {
                // Comment khối; không đóng thì SQLite coi tới hết chuỗi.
                i = rest[i + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(rest.len(), |p| i + 2 + p + 2);
            }
            _ => return false,
        }
    }
    true
}

/// Số byte tối đa giữ lại khi cắt câu lỗi.
const MAX_ERROR_SQL: usize = 500;

/// Phần đầu của `rest` tới hết câu đầu tiên (`;` ngoài chuỗi/identifier/comment), tối đa
/// `MAX_ERROR_SQL` byte; dùng để hiện câu lỗi mà không kéo theo cả phần SQL còn lại.
pub fn first_statement(rest: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < rest.len() && i < MAX_ERROR_SQL {
        match rest[i] {
            b';' => return &rest[..=i],
            q @ (b'\'' | b'"' | b'`' | b'[') => {
                let close = if q == b'[' { b']' } else { q };
                i = rest[i + 1..]
                    .iter()
                    .position(|&b| b == close)
                    .map_or(rest.len(), |p| i + 1 + p + 1);
            }
            b'-' if rest.get(i + 1) == Some(&b'-') => {
                i = rest[i..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map_or(rest.len(), |p| i + p + 1);
            }
            b'/' if rest.get(i + 1) == Some(&b'*') => {
                i = rest[i + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(rest.len(), |p| i + 2 + p + 2);
            }
            _ => i += 1,
        }
    }
    &rest[..i.min(MAX_ERROR_SQL).min(rest.len())]
}

#[cfg(test)]
mod tests {
    use super::{MAX_ERROR_SQL, first_statement, only_trivia};

    #[test]
    fn trivia_only() {
        for s in [
            "",
            "   \n\t",
            ";",
            " ; ; ",
            "-- note",
            "-- note\n",
            "/* x */",
            "/* ; */ ;",
            "/* khong dong",
            "-- a\n/* b */ ;\n-- c",
        ] {
            assert!(only_trivia(s.as_bytes()), "{s:?}");
        }
    }

    #[test]
    fn has_statement() {
        for s in [
            "SELECT 1",
            " ; SELECT 1",
            "-- c\nSELECT 1",
            "/* c */ SELECT 1",
            "- 1",
            "/ 1",
            "-- c\n/* d */ x",
        ] {
            assert!(!only_trivia(s.as_bytes()), "{s:?}");
        }
    }

    fn first(s: &str) -> String {
        String::from_utf8_lossy(first_statement(s.as_bytes())).into_owned()
    }

    #[test]
    fn first_statement_cuts_at_first_semicolon() {
        assert_eq!(first("SELEC 2; SELECT 3"), "SELEC 2;");
        assert_eq!(first(";x"), ";");
    }

    #[test]
    fn first_statement_ignores_semicolon_in_quotes_and_brackets() {
        assert_eq!(first("a 'x;y' b; c"), "a 'x;y' b;");
        assert_eq!(first("a \"x;y\" b; c"), "a \"x;y\" b;");
        assert_eq!(first("a `x;y` b; c"), "a `x;y` b;");
        assert_eq!(first("a [x;y] b; c"), "a [x;y] b;");
    }

    #[test]
    fn first_statement_ignores_semicolon_in_comments() {
        assert_eq!(
            first(
                "a -- x;y
 b; c"
            ),
            "a -- x;y
 b;"
        );
        assert_eq!(first("a /* x;y */ b; c"), "a /* x;y */ b;");
    }

    #[test]
    fn first_statement_without_semicolon_returns_all() {
        assert_eq!(first("SELEC 2"), "SELEC 2");
        assert_eq!(first(""), "");
        // chuỗi/comment không đóng: lấy hết
        assert_eq!(first("a 'x; b"), "a 'x; b");
        assert_eq!(first("a /* x; b"), "a /* x; b");
        assert_eq!(first("a -- x; b"), "a -- x; b");
    }

    #[test]
    fn first_statement_caps_at_max_bytes() {
        let long = "a".repeat(MAX_ERROR_SQL + 100);
        assert_eq!(first_statement(long.as_bytes()).len(), MAX_ERROR_SQL);
        // `;` sau giới hạn thì không lấy
        let s = format!("{};", "a".repeat(MAX_ERROR_SQL));
        assert_eq!(first_statement(s.as_bytes()).len(), MAX_ERROR_SQL);
        // `;` ngay trong giới hạn
        let s = format!("{};x", "a".repeat(MAX_ERROR_SQL - 1));
        assert_eq!(first_statement(s.as_bytes()).len(), MAX_ERROR_SQL);
        // chuỗi dài vượt giới hạn cũng bị cắt
        let s = format!("'{}'; x", "a".repeat(MAX_ERROR_SQL + 10));
        assert_eq!(first_statement(s.as_bytes()).len(), MAX_ERROR_SQL);
    }
}
