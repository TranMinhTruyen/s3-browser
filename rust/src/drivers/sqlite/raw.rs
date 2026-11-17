//! Mọi `unsafe` gọi SQLite C API nằm ở file này.
//!
//! Vị trí trong luồng: `actor` dùng `prepare_next`/`total_changes` để chạy từng câu, `registry`
//! giữ `InterruptHandle` để huỷ câu đang chạy.
//!
//! `unsafe` là chỗ compiler không kiểm được tính đúng đắn (gọi hàm C, con trỏ thô); người viết
//! tự chịu trách nhiệm và ghi lý do ở `// SAFETY:`. Gom hết vào một file để dễ rà soát.
//!
//! Handle `sqlite3*` lấy từ `LockedSqliteHandle` của sqlx: các hàm bên dưới nhận chính
//! `LockedSqliteHandle` nên borrow checker đảm bảo connection còn sống và worker thread của
//! sqlx đang không dùng handle trong lúc ta gọi.

use crate::protocol::Column;
use libsqlite3_sys as ffi;
use sqlx::sqlite::LockedSqliteHandle;
use std::ffi::{CStr, c_char, c_int};
use std::ptr::{self, NonNull};

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

/// Prepare câu đầu của `sql`, lấy metadata cột rồi finalize ngay (không chạy câu).
/// Lỗi cú pháp, thiếu table... trả `Err(thông báo SQLite)`.
pub fn prepare_next(handle: &mut LockedSqliteHandle<'_>, sql: &[u8]) -> Result<Prepared, String> {
    let db = handle.as_raw_handle().as_ptr();
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

/// Tổng số dòng đã thay đổi trên connection (so trước/sau để biết câu có ghi dữ liệu không).
pub fn total_changes(handle: &mut LockedSqliteHandle<'_>) -> i32 {
    let db = handle.as_raw_handle().as_ptr();
    // SAFETY: `db` hợp lệ trong lúc `handle` còn được mượn.
    unsafe { ffi::sqlite3_total_changes(db) }
}
