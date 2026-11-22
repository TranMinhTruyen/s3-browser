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
use crate::drivers::common::hex;
use crate::protocol::Column;
use crate::registry::Interrupt;
use libsqlite3_sys as ffi;
use sqlx::sqlite::LockedSqliteHandle;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::ptr::{self, NonNull};
use std::slice;

/// Handle chỉ dùng để `sqlite3_interrupt` từ thread khác. `NonNull` là con trỏ thô đảm bảo không null;
/// `Copy` cho phép sao chép rẻ như số nguyên.
///
/// Con trỏ thô không mang lifetime nên compiler không biết connection đã đóng chưa; hợp đồng do
/// người tạo (`of`, là `unsafe fn`) giữ: handle chỉ được giữ khi connection còn sống. Registry
/// thực hiện bằng cách gỡ handle (dưới lock) trước khi connection bị đóng và chỉ gọi `interrupt`
/// dưới cùng lock đó.
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
    ///
    /// # Safety
    /// Handle trả về là bản sao con trỏ, không còn gắn với connection. Người gọi phải đảm bảo
    /// không còn dùng (`interrupt`) nó sau khi connection bị đóng/drop, ví dụ bằng cách gỡ nó
    /// khỏi nơi lưu (registry) trước khi đóng connection.
    pub unsafe fn of(handle: &mut LockedSqliteHandle<'_>) -> Self {
        Self(handle.as_raw_handle())
    }

    /// Ngắt câu SQL đang chạy trên connection; câu đó sẽ trả lỗi `interrupted`.
    pub fn interrupt(&self) {
        // SAFETY: hợp đồng của `of` đảm bảo connection còn sống; `sqlite3_interrupt` an toàn đa luồng.
        unsafe { ffi::sqlite3_interrupt(self.0.as_ptr()) }
    }
}

/// Cho registry ngắt câu đang chạy qua trait chung `Interrupt` (gọi hàm `interrupt` ở trên).
impl Interrupt for InterruptHandle {
    fn interrupt(&self) {
        InterruptHandle::interrupt(self);
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
/// `Stmt` sở hữu luôn `LockedSqliteHandle` (khoá connection) nên câu không thể sống lâu hơn khoá
/// của connection: compiler chặn mọi cách để connection đóng trong lúc câu còn tồn tại. Lifetime
/// `'c` là thời gian mượn connection.
///
/// `Drop` finalize câu (RAII, giống `defer` của Go) rồi các field mới được drop, trong đó
/// `_handle` nhả khoá. Thứ tự này bắt buộc: sqlx panic nếu `sqlite3_close` còn thấy câu chưa
/// finalize, và finalize cần connection còn nguyên.
pub struct Stmt<'c> {
    ptr: NonNull<ffi::sqlite3_stmt>,
    /// Số cột, đọc một lần lúc prepare.
    ncols: c_int,
    /// Chỉ để giữ khoá worker của sqlx (không đọc). Khai báo sau `ptr`/`ncols`; `Drop::drop` của
    /// `Stmt` chạy trước khi field này bị drop.
    _handle: LockedSqliteHandle<'c>,
}

// `Send`: cho phép chuyển `Stmt` giữa các thread (task tokio có thể đổi thread sau mỗi `.await`).
// SAFETY: sqlx mở connection ở chế độ multi-thread (SQLITE_OPEN_NOMUTEX, không phải serialized):
// handle/stmt dùng được từ thread khác miễn không có hai thread dùng đồng thời. `Stmt` giữ
// `LockedSqliteHandle` nên worker thread của sqlx bị chặn, và chỉ một task (actor của connection)
// dùng `Stmt` tại một thời điểm; không có bản sao con trỏ nào khác. Không `Sync`: không chia sẻ `&Stmt`.
unsafe impl Send for Stmt<'_> {}

impl Drop for Stmt<'_> {
    fn drop(&mut self) {
        // SAFETY: `ptr` do `prepare` cấp, chưa finalize (chỉ finalize ở đây, `Stmt` không `Clone`);
        // `_handle` còn giữ khoá nên connection còn sống.
        unsafe { ffi::sqlite3_finalize(self.ptr.as_ptr()) };
    }
}

impl<'c> Stmt<'c> {
    /// Prepare đúng một câu (đã được `prepare_next` xác nhận là câu có cột). Nhận `handle` theo
    /// giá trị (move) và cất vào `Stmt` để khoá sống cùng câu. Lỗi thì `handle` được nhả lại.
    pub fn prepare(mut handle: LockedSqliteHandle<'c>, sql: &[u8]) -> Result<Self, String> {
        let (stmt, _) = prepare_raw(handle.as_raw_handle().as_ptr(), sql)?;
        let ptr = NonNull::new(stmt).ok_or_else(|| "empty statement".to_owned())?;
        // SAFETY: `ptr` vừa được prepare, chưa finalize.
        let ncols = unsafe { ffi::sqlite3_column_count(ptr.as_ptr()) };
        Ok(Self {
            ptr,
            ncols,
            _handle: handle,
        })
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
                    Some(hex(bytes(p, ffi::sqlite3_column_bytes(stmt, i))))
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
#[path = "../../../tests/unit/drivers/sqlite/raw.rs"]
mod tests;
