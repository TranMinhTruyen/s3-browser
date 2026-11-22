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

// ---- P1: một dòng rất dài ----

#[test]
fn pg_one_huge_line_with_unicode_splits_in_linear_time_and_matches_the_small_version() {
    // Câu `SELECT 'ầbc', ...` lặp tới ~200 KB trên MỘT dòng, rồi câu thứ hai.
    let item = "'ầbc', ";
    let mut first = String::from("SELECT ");
    while first.len() < 200_000 {
        first.push_str(item);
    }
    first.push('1');
    let sql = format!("{first}; SELECT 'ầ'");

    let started = std::time::Instant::now();
    let ranges = split(Dialect::Postgres, &sql);
    let elapsed = started.elapsed();

    assert_eq!(ranges.len(), 2);
    assert_eq!(&sql[ranges[0].clone()], first);
    assert_eq!(&sql[ranges[1].clone()], "SELECT 'ầ'");
    // Bản O(n²) cũ mất hàng giây ở cỡ này; bản debug tuyến tính chỉ vài chục ms.
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "{elapsed:?}"
    );

    // Khớp kết quả của bản nhỏ cùng cấu trúc.
    let small = "SELECT 'ầbc', 1; SELECT 'ầ'";
    assert_eq!(pg(small), ["SELECT 'ầbc', 1", "SELECT 'ầ'"]);
}

#[test]
fn pg_unicode_before_a_semicolon_on_the_same_line_keeps_byte_offsets_right() {
    let sql = "SELECT 'ầ'; SELECT 'ễ'; SELECT 3";
    assert_eq!(pg(sql), ["SELECT 'ầ'", "SELECT 'ễ'", "SELECT 3"]);
    // Nhiều dòng xen kẽ với unicode.
    let sql = "SELECT 'ầ';
SELECT
 'ễ', 'ặ';

SELECT 3";
    assert_eq!(
        pg(sql),
        [
            "SELECT 'ầ'",
            "SELECT
 'ễ', 'ặ'",
            "SELECT 3"
        ]
    );
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
