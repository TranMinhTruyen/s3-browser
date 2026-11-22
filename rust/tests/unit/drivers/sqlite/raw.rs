use super::{InterruptHandle, Stmt, bytes, prepare_next, total_changes, value};
use crate::drivers::common::hex;
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{AssertSqlSafe, Connection, Row, TypeInfo, ValueRef};
use std::ffi::c_void;
use std::ptr;

type Cells = Vec<Option<String>>;

/// Connection in-memory mới cho mỗi test (độc lập, không phụ thuộc thứ tự chạy).
async fn mem() -> SqliteConnection {
    SqliteConnection::connect("sqlite::memory:").await.unwrap()
}

/// Đọc hết kết quả bằng đường mới (`Stmt`, giữ luôn handle).
async fn read_new(conn: &mut SqliteConnection, sql: &str) -> Result<Vec<Cells>, String> {
    let handle = conn.lock_handle().await.unwrap();
    let mut stmt = Stmt::prepare(handle, sql.as_bytes())?;
    let mut rows = Vec::new();
    while let Some(row) = stmt.next_row()? {
        rows.push(row);
    }
    Ok(rows)
}

/// Bản sao nguyên văn logic đọc ô của code cũ (sqlx `fetch` + `value::cell`), làm chuẩn so sánh.
fn old_cell(row: &SqliteRow, i: usize) -> Option<String> {
    let raw = row.try_get_raw(i).unwrap();
    if raw.is_null() {
        return None;
    }
    let name = raw.type_info().name().to_owned();
    Some(match name.as_str() {
        "INTEGER" => row.try_get_unchecked::<i64, _>(i).unwrap().to_string(),
        "REAL" => value::real(row.try_get_unchecked::<f64, _>(i).unwrap()),
        "BLOB" => hex(row.try_get_unchecked::<&[u8], _>(i).unwrap()),
        _ => String::from_utf8_lossy(row.try_get_unchecked::<&[u8], _>(i).unwrap()).into_owned(),
    })
}

async fn read_old(conn: &mut SqliteConnection, sql: &str) -> Vec<Cells> {
    let rows = sqlx::query(AssertSqlSafe(sql.to_owned()))
        .persistent(false)
        .fetch_all(conn)
        .await
        .unwrap();
    rows.iter()
        .map(|r| (0..r.len()).map(|i| old_cell(r, i)).collect())
        .collect()
}

fn s(v: &str) -> Option<String> {
    Some(v.to_owned())
}

/// Mỗi câu dưới đây phải cho đúng cùng kết quả ở đường cũ và đường mới.
const SAME_AS_OLD: &[&str] = &[
    "SELECT NULL",
    "SELECT 0, 1, -1, 9223372036854775807, -9223372036854775808, -9223372036854775807-1",
    "SELECT 1.0, -3.0, 0.1, 1.5, 1e15, -1e15, 1e20, 123456789.125, 1e-7, 0.0, -0.0, 3.0e14",
    "SELECT 1e999, -1e999, 9e999-9e999",
    "SELECT x'', zeroblob(0), x'00ff10', zeroblob(3000)",
    "SELECT unhex(replace(hex(zeroblob(1500)), '00', '00ff'))",
    "SELECT '', 'héllo 日本 😀', 'a'||char(0)||'b', char(0)",
    "SELECT CAST(x'ff61' AS TEXT), CAST(x'c328' AS TEXT), CAST(x'e282' AS TEXT)",
    "SELECT 1 AS a, 'x' AS b, NULL AS c, 2.5 AS d, x'ab' AS e",
    "SELECT replace(hex(zeroblob(2500)), '0', 'a')",
];

#[tokio::test]
async fn cells_match_old_sqlx_path() {
    let mut conn = mem().await;
    for sql in SAME_AS_OLD {
        let new = read_new(&mut conn, sql).await.unwrap();
        let old = read_old(&mut conn, sql).await;
        assert_eq!(new, old, "{sql}");
    }
}

#[tokio::test]
async fn integer_extremes() {
    let mut conn = mem().await;
    let rows = read_new(
        &mut conn,
        "SELECT -9223372036854775808, 9223372036854775807, 0, -1",
    )
    .await
    .unwrap();
    assert_eq!(
        rows,
        vec![vec![
            s("-9223372036854775808"),
            s("9223372036854775807"),
            s("0"),
            s("-1")
        ]]
    );
}

#[tokio::test]
async fn real_formats() {
    let mut conn = mem().await;
    let rows = read_new(
        &mut conn,
        "SELECT 1.0, -3.0, 0.1, 1.5, 1e15, 1e20, 1e999, -1e999",
    )
    .await
    .unwrap();
    assert_eq!(
        rows,
        vec![vec![
            s("1.0"),
            s("-3.0"),
            s("0.1"),
            s("1.5"),
            s("1000000000000000"),
            s("100000000000000000000"),
            s("Inf"),
            s("-Inf"),
        ]]
    );
}

/// SQLite không biểu diễn được NaN: mọi phép tính ra NaN đều thành NULL (không có đường tới "NaN").
#[tokio::test]
async fn nan_from_sql_is_null() {
    let mut conn = mem().await;
    let rows = read_new(&mut conn, "SELECT 9e999-9e999").await.unwrap();
    assert_eq!(rows, vec![vec![None]]);
}

#[tokio::test]
async fn blob_empty_and_full_hex() {
    let mut conn = mem().await;
    let rows = read_new(
        &mut conn,
        "SELECT x'', zeroblob(0), x'00ff10', zeroblob(3000), \
             unhex(replace(hex(zeroblob(1500)), '00', '00ff'))",
    )
    .await
    .unwrap();
    let r = &rows[0];
    assert_eq!(r[0], s("0x"));
    assert_eq!(r[1], s("0x"));
    assert_eq!(r[2], s("0x00ff10"));
    assert_eq!(r[3], Some(format!("0x{}", "00".repeat(3000))));
    assert_eq!(r[4], Some(format!("0x{}", "00ff".repeat(1500))));
}

#[tokio::test]
async fn text_with_nul_and_invalid_utf8() {
    let mut conn = mem().await;
    let rows = read_new(
        &mut conn,
        "SELECT '', 'a'||char(0)||'b', CAST(x'ff61' AS TEXT), CAST(x'c328' AS TEXT), NULL",
    )
    .await
    .unwrap();
    assert_eq!(
        rows,
        vec![vec![s(""), s("a\0b"), s("\u{fffd}a"), s("\u{fffd}("), None]]
    );
}

/// Cột không khai báo kiểu: mỗi dòng một kiểu lưu, kiểu được hỏi theo từng ô.
#[tokio::test]
async fn untyped_column_mixed_storage() {
    let mut conn = mem().await;
    sqlx::query("CREATE TABLE m(v)")
        .execute(&mut conn)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO m VALUES(1),(2.5),('x'),(x'ab'),(NULL),(9223372036854775807),(-0.5),('')",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    let sql = "SELECT v FROM m ORDER BY rowid";
    let new = read_new(&mut conn, sql).await.unwrap();
    assert_eq!(new, read_old(&mut conn, sql).await);
    let flat: Cells = new.into_iter().map(|mut r| r.remove(0)).collect();
    assert_eq!(
        flat,
        vec![
            s("1"),
            s("2.5"),
            s("x"),
            s("0xab"),
            None,
            s("9223372036854775807"),
            s("-0.5"),
            s("")
        ]
    );
}

#[tokio::test]
async fn zero_rows_is_ok_none() {
    let mut conn = mem().await;
    assert!(
        read_new(&mut conn, "SELECT 1 WHERE 0")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn prepare_errors() {
    let mut conn = mem().await;
    // `prepare` nhận handle theo giá trị và nhả lại khi lỗi, nên mỗi lần khoá một handle mới.
    let handle = conn.lock_handle().await.unwrap();
    let syntax = Stmt::prepare(handle, b"SELEC 1").err().unwrap();
    assert!(syntax.contains("syntax error"), "{syntax}");
    let handle = conn.lock_handle().await.unwrap();
    let missing = Stmt::prepare(handle, b"SELECT * FROM nope").err().unwrap();
    assert!(missing.contains("nope"), "{missing}");
    // Chỉ khoảng trắng/comment/`;` không có câu lệnh để prepare.
    for sql in ["", "   ", "-- c\n", ";"] {
        let handle = conn.lock_handle().await.unwrap();
        let e = Stmt::prepare(handle, sql.as_bytes()).err().unwrap();
        assert_eq!(e, "empty statement", "{sql:?}");
    }
}

/// Lỗi ở giữa kết quả: dòng trước đọc được, dòng sau trả `Err` có thông báo của SQLite.
#[tokio::test]
async fn step_error_surfaces_message() {
    let mut conn = mem().await;
    let handle = conn.lock_handle().await.unwrap();
    let mut stmt = Stmt::prepare(
        handle,
        b"SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)",
    )
    .unwrap();
    assert_eq!(stmt.next_row().unwrap(), Some(vec![s("1")]));
    let e = stmt.next_row().unwrap_err();
    assert!(e.contains("integer overflow"), "{e}");
}

/// `Stmt` phải finalize khi drop (kể cả giữa chừng), nếu không `close` của sqlx panic.
#[tokio::test]
async fn drop_mid_result_then_close_is_clean() {
    let mut conn = mem().await;
    {
        let handle = conn.lock_handle().await.unwrap();
        let mut stmt = Stmt::prepare(
                handle,
                b"WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<10) SELECT x FROM c",
            )
            .unwrap();
        assert_eq!(stmt.next_row().unwrap(), Some(vec![s("1")]));
    }
    // Connection vẫn dùng được rồi đóng sạch.
    let rows = read_new(&mut conn, "SELECT 5").await.unwrap();
    assert_eq!(rows, vec![vec![s("5")]]);
    conn.close().await.unwrap();
}

/// `prepare_next`: số byte tiêu thụ, cột của câu có dòng, câu không cột, phần chỉ có trivia.
#[tokio::test]
async fn prepare_next_consumed_and_columns() {
    let mut conn = mem().await;
    let mut handle = conn.lock_handle().await.unwrap();

    let sql = b"SELECT 1 AS a, 'x' AS b; SELECT 2";
    let p = prepare_next(&mut handle, sql).unwrap();
    // Tiêu thụ tới hết `;` đầu tiên, phần còn lại là câu thứ hai.
    assert_eq!(&sql[..p.consumed], b"SELECT 1 AS a, 'x' AS b;");
    let cols = p.columns.unwrap();
    assert_eq!(
        cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        ["a", "b"]
    );

    // Câu cuối không có `;`: tiêu thụ hết.
    let p = prepare_next(&mut handle, b" SELECT 2").unwrap();
    assert_eq!(p.consumed, 9);
    assert_eq!(p.columns.unwrap().len(), 1);

    // Comment/khoảng trắng/`;` đứng trước câu được tính vào phần tiêu thụ của câu đó.
    let sql = b"-- c\n /* d */ ; SELECT 3";
    let p = prepare_next(&mut handle, sql).unwrap();
    assert_eq!(p.consumed, sql.len());

    // Câu không trả cột: `Some(rỗng)`.
    let p = prepare_next(&mut handle, b"CREATE TABLE t(a INTEGER);").unwrap();
    assert_eq!(p.columns.unwrap().len(), 0);

    // Chỉ trivia: `None` (không có câu lệnh).
    for sql in ["", "  ", "-- c", "/* c */", ";"] {
        let p = prepare_next(&mut handle, sql.as_bytes()).unwrap();
        assert!(p.columns.is_none(), "{sql:?}");
        assert_eq!(p.consumed, sql.len(), "{sql:?}");
    }
}

/// decltype lấy từ khai báo cột; biểu thức không có kiểu khai báo thì rỗng.
#[tokio::test]
async fn prepare_next_reports_decltype() {
    let mut conn = mem().await;
    sqlx::query("CREATE TABLE d(i INTEGER, t TEXT, u)")
        .execute(&mut conn)
        .await
        .unwrap();
    let mut handle = conn.lock_handle().await.unwrap();
    let p = prepare_next(&mut handle, b"SELECT i, t, u, i + 1 FROM d").unwrap();
    let types: Vec<String> = p.columns.unwrap().into_iter().map(|c| c.ty).collect();
    assert_eq!(types, ["INTEGER", "TEXT", "", ""]);
}

/// Lỗi prepare (cú pháp, thiếu table) trả thông báo SQLite, không panic.
#[tokio::test]
async fn prepare_next_errors_are_messages() {
    let mut conn = mem().await;
    let mut handle = conn.lock_handle().await.unwrap();
    let e = prepare_next(&mut handle, b"SELEC 1").err().unwrap();
    assert!(e.contains("syntax error"), "{e}");
    let e = prepare_next(&mut handle, b"SELECT * FROM nope")
        .err()
        .unwrap();
    assert!(e.contains("nope"), "{e}");
}

/// `total_changes` tăng theo số dòng ghi, không đổi với câu chỉ đọc.
#[tokio::test]
async fn total_changes_tracks_writes_only() {
    let mut conn = mem().await;
    sqlx::query("CREATE TABLE w(a)")
        .execute(&mut conn)
        .await
        .unwrap();
    let before = total_changes(&mut conn.lock_handle().await.unwrap());
    sqlx::query("INSERT INTO w VALUES(1),(2),(3)")
        .execute(&mut conn)
        .await
        .unwrap();
    let after = total_changes(&mut conn.lock_handle().await.unwrap());
    assert_eq!(after - before, 3);
    read_new(&mut conn, "SELECT * FROM w").await.unwrap();
    assert_eq!(total_changes(&mut conn.lock_handle().await.unwrap()), after);
}

/// `interrupt` lúc connection rảnh không làm hỏng câu chạy sau đó (SQLite chỉ áp interrupt cho
/// câu đang chạy); lặp nhiều lần vẫn vậy.
#[tokio::test]
async fn interrupt_when_idle_is_harmless() {
    let mut conn = mem().await;
    // SAFETY: `conn` sống tới hết test, `handle` không được dùng sau đó.
    let handle = unsafe { InterruptHandle::of(&mut conn.lock_handle().await.unwrap()) };
    for _ in 0..3 {
        handle.interrupt();
    }
    let rows = read_new(&mut conn, "SELECT 1, 2").await.unwrap();
    assert_eq!(rows, vec![vec![s("1"), s("2")]]);
}

/// `interrupt` giữa kết quả đang mở: lần `step` kế tiếp lỗi `interrupt`; sau khi bỏ `Stmt`
/// connection chạy lại bình thường.
#[tokio::test]
async fn interrupt_mid_result_fails_next_step_then_connection_recovers() {
    let mut conn = mem().await;
    {
        let mut handle = conn.lock_handle().await.unwrap();
        // SAFETY: `conn` sống hơn `ih`, `ih` chỉ dùng trong khối này.
        let ih = unsafe { InterruptHandle::of(&mut handle) };
        let mut stmt = Stmt::prepare(
            handle,
            b"WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c",
        )
        .unwrap();
        assert_eq!(stmt.next_row().unwrap(), Some(vec![s("1")]));
        ih.interrupt();
        let e = stmt.next_row().unwrap_err();
        assert!(e.contains("interrupt"), "{e}");
    }
    assert_eq!(
        read_new(&mut conn, "SELECT 2").await.unwrap(),
        vec![vec![s("2")]]
    );
}

/// `Stmt` sở hữu khoá handle: drop `Stmt` (giữa kết quả, hoặc sau khi `step` lỗi) phải nhả khoá
/// để lần `lock_handle` kế tiếp xong ngay (timeout chỉ là chốt chặn chống treo test), rồi đóng
/// connection sạch (câu đã finalize trước khi nhả khoá).
#[tokio::test]
async fn dropping_stmt_releases_lock_then_close_is_clean() {
    use std::time::Duration;
    let mut conn = mem().await;
    let wait = Duration::from_secs(10);

    // Drop giữa kết quả.
    let handle = conn.lock_handle().await.unwrap();
    let mut stmt = Stmt::prepare(handle, b"SELECT 1 UNION ALL SELECT 2").unwrap();
    assert_eq!(stmt.next_row().unwrap(), Some(vec![s("1")]));
    drop(stmt);
    let handle = tokio::time::timeout(wait, conn.lock_handle())
        .await
        .expect("khoá phải được nhả sau khi drop Stmt")
        .unwrap();

    // Drop sau khi `step` lỗi: khoá cũng được nhả.
    let mut stmt = Stmt::prepare(
        handle,
        b"SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)",
    )
    .unwrap();
    assert!(stmt.next_row().is_ok());
    assert!(stmt.next_row().is_err());
    drop(stmt);
    let handle = tokio::time::timeout(wait, conn.lock_handle())
        .await
        .expect("khoá phải được nhả sau khi drop Stmt lỗi")
        .unwrap();
    drop(handle);

    assert_eq!(
        read_new(&mut conn, "SELECT 7").await.unwrap(),
        vec![vec![s("7")]]
    );
    conn.close().await.unwrap();
}

/// `bytes`: con trỏ null hoặc độ dài <= 0 cho slice rỗng, không đọc bộ nhớ.
#[test]
fn bytes_null_or_non_positive_len_is_empty() {
    let data = [1u8, 2, 3];
    let p = data.as_ptr().cast::<c_void>();
    // SAFETY: `p` trỏ tới 3 byte hợp lệ; các trường hợp còn lại không dereference con trỏ.
    unsafe {
        assert_eq!(bytes(p, 3), &[1, 2, 3]);
        assert_eq!(bytes(p, 2), &[1, 2]);
        assert!(bytes(p, 0).is_empty());
        assert!(bytes(p, -1).is_empty());
        assert!(bytes(ptr::null(), 5).is_empty());
    }
}

#[test]
fn stmt_is_send() {
    fn assert_send<T: Send>() {}
    assert_send::<Stmt<'_>>();
}
