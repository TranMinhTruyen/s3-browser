use super::{MAX_ERROR_SQL, first_statement, only_trivia};

/// Chuỗi chỉ có khoảng trắng/comment/`;` thì không còn câu lệnh.
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

/// Có ký tự câu lệnh thật (kể cả sau comment) thì còn câu lệnh.
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

/// Gọi `first_statement` rồi đổi lại thành `String` để dễ so sánh trong test.
fn first(s: &str) -> String {
    String::from_utf8_lossy(first_statement(s.as_bytes())).into_owned()
}

/// Cắt ngay sau `;` đầu tiên.
#[test]
fn first_statement_cuts_at_first_semicolon() {
    assert_eq!(first("SELEC 2; SELECT 3"), "SELEC 2;");
    assert_eq!(first(";x"), ";");
}

/// `;` trong chuỗi/identifier được bọc không tính là hết câu.
#[test]
fn first_statement_ignores_semicolon_in_quotes_and_brackets() {
    assert_eq!(first("a 'x;y' b; c"), "a 'x;y' b;");
    assert_eq!(first("a \"x;y\" b; c"), "a \"x;y\" b;");
    assert_eq!(first("a `x;y` b; c"), "a `x;y` b;");
    assert_eq!(first("a [x;y] b; c"), "a [x;y] b;");
}

/// `;` trong comment không tính là hết câu.
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

/// Không có `;` (hoặc chuỗi/comment không đóng) thì lấy hết.
#[test]
fn first_statement_without_semicolon_returns_all() {
    assert_eq!(first("SELEC 2"), "SELEC 2");
    assert_eq!(first(""), "");
    // chuỗi/comment không đóng: lấy hết
    assert_eq!(first("a 'x; b"), "a 'x; b");
    assert_eq!(first("a /* x; b"), "a /* x; b");
    assert_eq!(first("a -- x; b"), "a -- x; b");
}

/// Kết quả không bao giờ dài quá `MAX_ERROR_SQL` byte.
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
