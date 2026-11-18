//! Mọi `unsafe` gọi SQLite C API nằm ở file này.
//!
//! Vị trí trong luồng: `actor` dùng `prepare_next`/`total_changes` để chạy từng câu và `Stmt` để
//! đọc dòng kết quả trực tiếp từ SQLite (nhanh hơn đi qua sqlx); `registry` giữ `InterruptHandle`
//! để huỷ câu đang chạy.
//!
//! `unsafe` là chỗ compiler không kiểm được tính đúng đắn (gọi hàm C, con trỏ thô); người viết
//! tự chịu trách nhiệm và ghi lý do ở `// SAFETY:`. Gom hết vào một file để dễ rà soát.
//!
//! Handle `sqlite3*` lấy từ `LockedSqliteHandle` của sqlx: các hàm bên dưới nhận chính
//! `LockedSqliteHandle` nên borrow checker đảm bảo connection còn sống và worker thread của
//! sqlx đang không dùng handle trong lúc ta gọi.

use super::value;
use crate::protocol::Column;
use libsqlite3_sys as ffi;
use sqlx::sqlite::LockedSqliteHandle;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::ptr::{self, NonNull};
use std::slice;

/// Handle chỉ dùng để `sqlite3_interrupt` từ thread khác. `NonNull` là con trỏ thô đảm bảo không null;
/// `Copy` cho phép sao chép rẻ như số nguyên.
///
/// Hợp đồng: registry gỡ handle (dưới lock) trước khi connection bị đóng và chỉ gọi
/// `interrupt` dưới cùng lock đó, nên handle luôn còn sống khi dùng.
#[derive(Clone, Copy)]
pub struct InterruptHandle(NonNull<ffi::sqlite3>);

// `Send`/`Sync` là dấu hiệu "được phép chuyển/chia sẻ giữa các thread"; con trỏ thô mặc định không có,
// nên ta tự khẳng định (unsafe) với lý do bên dưới.
// SAFETY: duy nhất thao tác trên con trỏ là `sqlite3_interrupt`, SQLite cho phép gọi từ mọi thread.
unsafe impl Send for InterruptHandle {}
// SAFETY: như trên, không có trạng thái Rust nào bị chia sẻ.
unsafe impl Sync for InterruptHandle {}

impl InterruptHandle {
    /// Lấy handle từ `LockedSqliteHandle` (sqlx giữ khoá worker thread trong lúc ta lấy con trỏ).
    pub fn of(handle: &mut LockedSqliteHandle<'_>) -> Self {
        Self(handle.as_raw_handle())
    }

    /// Ngắt câu SQL đang chạy trên connection; câu đó sẽ trả lỗi `interrupted`.
    pub fn interrupt(&self) {
        // SAFETY: xem hợp đồng của `InterruptHandle`; `sqlite3_interrupt` an toàn đa luồng.
        unsafe { ffi::sqlite3_interrupt(self.0.as_ptr()) }
    }
}

/// Kết quả prepare một câu đầu của chuỗi SQL.
pub struct Prepared {
    /// Số byte đã tiêu thụ (câu + `;` + khoảng trắng/comment đứng trước).
    pub consumed: usize,
    /// `None`: phần tiêu thụ chỉ là khoảng trắng/comment/`;` (không có câu lệnh).
    /// `Some(vec rỗng)`: câu không trả cột (INSERT, DDL...).
    pub columns: Option<Vec<Column>>,
}

/// Lấy thông báo lỗi gần nhất của connection `db` thành `String` (copy sang bộ nhớ của Rust).
fn last_error(db: *mut ffi::sqlite3) -> String {
    // SAFETY: `db` là handle hợp lệ do caller giữ; `sqlite3_errmsg` luôn trả chuỗi kết thúc NUL hợp lệ
    // đến lần gọi SQLite tiếp theo trên connection này, ta copy ngay.
    unsafe {
        let msg = ffi::sqlite3_errmsg(db);
        if msg.is_null() {
            "unknown SQLite error".to_owned()
        } else {
            CStr::from_ptr(msg).to_string_lossy().into_owned()
        }
    }
}

/// Đổi chuỗi C (kết thúc bằng NUL) thành `String`; con trỏ null thành chuỗi rỗng.
fn c_str(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: SQLite trả chuỗi NUL-terminated hợp lệ tới khi statement bị finalize; ta copy trước đó.
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// Prepare câu đầu của `sql`. Trả `(stmt, số byte đã tiêu thụ)`; `stmt` null khi phần tiêu thụ
/// chỉ là khoảng trắng/comment/`;`. Người gọi chịu trách nhiệm finalize `stmt` khác null.
fn prepare_raw(
    db: *mut ffi::sqlite3,
    sql: &[u8],
) -> Result<(*mut ffi::sqlite3_stmt, usize), String> {
    let len = c_int::try_from(sql.len()).map_err(|_| "statement is too long".to_owned())?;
    // Hai biến này là tham số ra của hàm C: SQLite ghi kết quả vào địa chỉ ta đưa.
    let mut stmt: *mut ffi::sqlite3_stmt = ptr::null_mut();
    let mut tail: *const c_char = ptr::null();
    // SAFETY: `db` hợp lệ (xem đầu file); `sql` có đúng `len` byte, SQLite chỉ đọc trong khoảng đó;
    // `stmt` và `tail` là con trỏ ra hợp lệ. `tail` trỏ vào trong `sql`.
    let rc = unsafe { ffi::sqlite3_prepare_v2(db, sql.as_ptr().cast(), len, &mut stmt, &mut tail) };
    if rc != ffi::SQLITE_OK {
        return Err(last_error(db));
    }
    // `tail` trỏ vào cuối câu vừa prepare trong `sql`; hiệu hai địa chỉ là số byte đã dùng.
    let consumed = if tail.is_null() {
        sql.len()
    } else {
        (tail as usize)
            .saturating_sub(sql.as_ptr() as usize)
            .min(sql.len())
    };
    Ok((stmt, consumed))
}

/// Prepare câu đầu của `sql`, lấy metadata cột rồi finalize ngay (không chạy câu).
/// Lỗi cú pháp, thiếu table... trả `Err(thông báo SQLite)`.
pub fn prepare_next(handle: &mut LockedSqliteHandle<'_>, sql: &[u8]) -> Result<Prepared, String> {
    let (stmt, consumed) = prepare_raw(handle.as_raw_handle().as_ptr(), sql)?;
    // `stmt` null: phần vừa tiêu thụ không có câu lệnh (chỉ khoảng trắng/comment/`;`).
    if stmt.is_null() {
        return Ok(Prepared {
            consumed,
            columns: None,
        });
    }
    // SAFETY: `stmt` khác null, vừa được prepare và chưa finalize; các chuỗi tên copy trước khi finalize.
    let columns = unsafe {
        let n = ffi::sqlite3_column_count(stmt);
        let cols = (0..n)
            .map(|i| Column {
                name: c_str(ffi::sqlite3_column_name(stmt, i)),
                ty: c_str(ffi::sqlite3_column_decltype(stmt, i)),
            })
            .collect();
        ffi::sqlite3_finalize(stmt);
        cols
    };
    Ok(Prepared {
        consumed,
        columns: Some(columns),
    })
}

/// Câu SELECT đã prepare, đọc dần từng dòng bằng `sqlite3_step`.
///
/// `Drop` finalize câu (RAII, giống `defer` của Go). Bắt buộc drop trước khi connection đóng:
/// sqlx panic nếu `sqlite3_close` còn thấy câu chưa finalize. Actor đảm bảo bằng cách giữ `Stmt`
/// cùng `LockedSqliteHandle` (mượn connection) trong `Held`, `Stmt` khai báo trước nên drop trước.
pub struct Stmt {
    ptr: NonNull<ffi::sqlite3_stmt>,
    /// Số cột, đọc một lần lúc prepare.
    ncols: c_int,
}

// `Send`: cho phép chuyển `Stmt` giữa các thread (task tokio có thể đổi thread sau mỗi `.await`).
// SAFETY: SQLite build ở chế độ serialized (SQLITE_THREADSAFE=1, mặc định của libsqlite3-sys), cho
// phép dùng handle/stmt từ nhiều thread miễn không đồng thời; `Stmt` chỉ do actor của connection
// dùng, mỗi lúc một thread, và không có bản sao con trỏ nào khác. Không `Sync`: không chia sẻ `&Stmt`.
unsafe impl Send for Stmt {}

impl Drop for Stmt {
    fn drop(&mut self) {
        // SAFETY: `ptr` do `prepare` cấp, chưa finalize (chỉ finalize ở đây, `Stmt` không `Clone`).
        unsafe { ffi::sqlite3_finalize(self.ptr.as_ptr()) };
    }
}

impl Stmt {
    /// Prepare đúng một câu (đã được `prepare_next` xác nhận là câu có cột). Giữ `handle` mượn
    /// trong lúc gọi để worker của sqlx không dùng handle đồng thời.
    pub fn prepare(handle: &mut LockedSqliteHandle<'_>, sql: &[u8]) -> Result<Self, String> {
        let (stmt, _) = prepare_raw(handle.as_raw_handle().as_ptr(), sql)?;
        let ptr = NonNull::new(stmt).ok_or_else(|| "empty statement".to_owned())?;
        // SAFETY: `ptr` vừa được prepare, chưa finalize.
        let ncols = unsafe { ffi::sqlite3_column_count(ptr.as_ptr()) };
        Ok(Self { ptr, ncols })
    }

    /// Chạy tới dòng kế và đổi mọi ô sang chuỗi. `Ok(None)` là hết dòng.
    /// Gộp `step` và đọc ô vào một hàm để không bao giờ đọc ô khi chưa đứng ở một dòng.
    /// Câu bị `sqlite3_interrupt` trả lỗi `interrupted`; caller nhận ra là huỷ qua cờ `cancel`.
    pub fn next_row(&mut self) -> Result<Option<Vec<Option<String>>>, String> {
        // SAFETY: `ptr` còn sống (xem `Drop`).
        match unsafe { ffi::sqlite3_step(self.ptr.as_ptr()) } {
            ffi::SQLITE_ROW => {}
            ffi::SQLITE_DONE => return Ok(None),
            // SAFETY: `ptr` còn sống; `sqlite3_db_handle` trả connection chứa câu này.
            _ => {
                return Err(last_error(unsafe {
                    ffi::sqlite3_db_handle(self.ptr.as_ptr())
                }));
            }
        }
        Ok(Some((0..self.ncols).map(|i| self.cell(i)).collect()))
    }

    /// Ô `i` của dòng hiện tại: NULL -> `None`; INTEGER/REAL/TEXT -> chuỗi; BLOB -> hex đầy đủ.
    /// SQLite gõ kiểu theo từng ô nên phải hỏi kiểu lưu thực bằng `sqlite3_column_type`.
    fn cell(&self, i: c_int) -> Option<String> {
        let stmt = self.ptr.as_ptr();
        // SAFETY: gọi sau `SQLITE_ROW` nên stmt đang đứng ở một dòng; `i < ncols`. Con trỏ blob/text
        // chỉ hợp lệ tới lần `step`/`finalize` kế tiếp nên ta copy ngay sang `String`. Với TEXT/BLOB
        // phải gọi `column_text`/`column_blob` trước rồi mới `column_bytes` (quy định của SQLite).
        unsafe {
            match ffi::sqlite3_column_type(stmt, i) {
                ffi::SQLITE_NULL => None,
                ffi::SQLITE_INTEGER => Some(ffi::sqlite3_column_int64(stmt, i).to_string()),
                ffi::SQLITE_FLOAT => Some(value::real(ffi::sqlite3_column_double(stmt, i))),
                ffi::SQLITE_BLOB => {
                    let p = ffi::sqlite3_column_blob(stmt, i);
                    Some(value::hex(bytes(p, ffi::sqlite3_column_bytes(stmt, i))))
                }
                // TEXT: chuyển lossy để TEXT không phải UTF-8 hợp lệ vẫn hiển thị được.
                _ => {
                    let p = ffi::sqlite3_column_text(stmt, i).cast::<c_void>();
                    let b = bytes(p, ffi::sqlite3_column_bytes(stmt, i));
                    Some(String::from_utf8_lossy(b).into_owned())
                }
            }
        }
    }
}

/// Slice `len` byte từ `p`; `p` null (blob/text rỗng) hoặc `len` <= 0 cho slice rỗng.
///
/// # Safety
/// `p` null hoặc trỏ tới ít nhất `len` byte đọc được, sống đủ lâu cho `'a`.
unsafe fn bytes<'a>(p: *const c_void, len: c_int) -> &'a [u8] {
    match usize::try_from(len) {
        // SAFETY: theo hợp đồng của hàm; `p` đã kiểm khác null.
        Ok(n) if n > 0 && !p.is_null() => unsafe { slice::from_raw_parts(p.cast(), n) },
        _ => &[],
    }
}

/// Tổng số dòng đã thay đổi trên connection (so trước/sau để biết câu có ghi dữ liệu không).
pub fn total_changes(handle: &mut LockedSqliteHandle<'_>) -> i32 {
    let db = handle.as_raw_handle().as_ptr();
    // SAFETY: `db` hợp lệ trong lúc `handle` còn được mượn.
    unsafe { ffi::sqlite3_total_changes(db) }
}

#[cfg(test)]
mod tests {
    use super::{InterruptHandle, Stmt, bytes, prepare_next, total_changes, value};
    use sqlx::sqlite::{SqliteConnection, SqliteRow};
    use sqlx::{AssertSqlSafe, Connection, Row, TypeInfo, ValueRef};
    use std::ffi::c_void;
    use std::ptr;

    type Cells = Vec<Option<String>>;

    /// Connection in-memory mới cho mỗi test (độc lập, không phụ thuộc thứ tự chạy).
    async fn mem() -> SqliteConnection {
        SqliteConnection::connect("sqlite::memory:").await.unwrap()
    }

    /// Đọc hết kết quả bằng đường mới (`Stmt`). `stmt` khai báo sau `handle` nên drop trước.
    async fn read_new(conn: &mut SqliteConnection, sql: &str) -> Result<Vec<Cells>, String> {
        let mut handle = conn.lock_handle().await.unwrap();
        let mut stmt = Stmt::prepare(&mut handle, sql.as_bytes())?;
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
            "BLOB" => value::hex(row.try_get_unchecked::<&[u8], _>(i).unwrap()),
            _ => {
                String::from_utf8_lossy(row.try_get_unchecked::<&[u8], _>(i).unwrap()).into_owned()
            }
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
        let mut handle = conn.lock_handle().await.unwrap();
        let syntax = Stmt::prepare(&mut handle, b"SELEC 1").err().unwrap();
        assert!(syntax.contains("syntax error"), "{syntax}");
        let missing = Stmt::prepare(&mut handle, b"SELECT * FROM nope")
            .err()
            .unwrap();
        assert!(missing.contains("nope"), "{missing}");
        // Chỉ khoảng trắng/comment/`;` không có câu lệnh để prepare.
        for sql in ["", "   ", "-- c\n", ";"] {
            let e = Stmt::prepare(&mut handle, sql.as_bytes()).err().unwrap();
            assert_eq!(e, "empty statement", "{sql:?}");
        }
    }

    /// Lỗi ở giữa kết quả: dòng trước đọc được, dòng sau trả `Err` có thông báo của SQLite.
    #[tokio::test]
    async fn step_error_surfaces_message() {
        let mut conn = mem().await;
        let mut handle = conn.lock_handle().await.unwrap();
        let mut stmt = Stmt::prepare(
            &mut handle,
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
            let mut handle = conn.lock_handle().await.unwrap();
            let mut stmt = Stmt::prepare(
                &mut handle,
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
        let handle = InterruptHandle::of(&mut conn.lock_handle().await.unwrap());
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
            let ih = InterruptHandle::of(&mut handle);
            let mut stmt = Stmt::prepare(
                &mut handle,
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
        assert_send::<Stmt>();
    }
}
