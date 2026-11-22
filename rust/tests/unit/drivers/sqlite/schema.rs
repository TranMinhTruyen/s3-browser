use super::check_constraints;

/// DDL hỏng hoặc không phải CREATE TABLE thì không có CHECK.
#[test]
fn broken_or_non_create_ddl_gives_empty() {
    for ddl in [
        "",
        "CREATE TABLE (",
        "garbage ((",
        "SELECT 1",
        "CREATE VIEW v AS SELECT 1",
    ] {
        assert!(check_constraints(ddl).is_empty(), "{ddl}");
    }
}

/// Lấy được CHECK mức cột và mức table, kèm tên constraint nếu có.
#[test]
fn column_and_table_checks_are_extracted() {
    let c = check_constraints(
        "CREATE TABLE t(a INTEGER CHECK (a > 0), b INTEGER CONSTRAINT bpos CHECK (b > 1), \
             CONSTRAINT ab CHECK (a < b), CHECK (b < 100))",
    );
    assert!(c.iter().all(|x| x.kind == "CHECK"));
    assert_eq!(c.len(), 4);
    assert_eq!(c[0].columns, ["a"]);
    assert_eq!(c[0].name, None);
    assert!(c[0].expression.as_deref().unwrap().contains("a > 0"));
    assert_eq!(c[1].columns, ["b"]);
    assert_eq!(c[1].name.as_deref(), Some("bpos"));
    assert!(c[2].columns.is_empty());
    assert_eq!(c[2].name.as_deref(), Some("ab"));
    assert_eq!(c[3].name, None);
    assert!(c[3].expression.as_deref().unwrap().contains("b < 100"));
}

/// DDL hợp lệ nhưng không có CHECK thì rỗng.
#[test]
fn valid_ddl_without_check_is_empty() {
    assert!(check_constraints("CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT UNIQUE)").is_empty());
}
