//! 4 hàm C export cho Go. Mọi thân hàm bọc `catch_unwind`: panic không bao giờ đi qua ranh giới C.
//!
//! Vị trí trong luồng: Go -> `ffi` (file này) -> `dispatch` -> driver. File này chỉ lo ranh giới
//! C: kiểm con trỏ, copy dữ liệu, cấp/giải phóng buffer; không có logic nghiệp vụ.
//!
//! Khái niệm Rust dùng ở đây:
//! - `extern "C"` + `#[unsafe(no_mangle)]`: hàm có ABI C và giữ nguyên tên để Go tìm theo tên.
//! - `unsafe`: chỗ compiler không kiểm được (con trỏ thô do Go đưa); mỗi chỗ có `// SAFETY:`
//!   nói vì sao đúng.
//! - `catch_unwind`: bắt panic (giống `recover` của Go); panic mà lan ra ngoài hàm C sẽ làm
//!   chết cả app. Nó trả `Err` nếu có panic, ta đổi thành mã `ERR_PANIC`.

use crate::{dispatch, registry, runtime};
use std::panic::catch_unwind;
use std::{ptr, slice};

/// Mã trả về: 0 là thành công.
const OK: i32 = 0;
/// Tham số là con trỏ null.
const ERR_ARG: i32 = 1;
/// Không tạo được runtime.
const ERR_INIT: i32 = 2;
/// Có panic bên trong hàm.
const ERR_PANIC: i32 = -1;

/// Tạo runtime tokio (một lần). Gọi nhiều lần vô hại. Trả 0 nếu thành công.
#[unsafe(no_mangle)]
pub extern "C" fn s3b_init() -> i32 {
    catch_unwind(|| match runtime::init() {
        Ok(()) => OK,
        Err(_) => ERR_INIT,
    })
    .unwrap_or(ERR_PANIC)
}

/// Xử lý một request JSON và chặn tới khi xong. Trả 0 khi `out` chứa JSON response (cả khi lỗi
/// nghiệp vụ); khác 0 khi tham số là con trỏ null hoặc có panic. Buffer trả về chỉ giải phóng
/// bằng `s3b_free`.
///
/// # Safety
/// `req_ptr` trỏ tới `req_len` byte đọc được; `out_ptr` và `out_len` trỏ tới ô ghi được.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn s3b_call(
    req_ptr: *const u8,
    req_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    // `|| { ... }` là closure (hàm ẩn danh); `return` bên trong chỉ thoát closure, không thoát hàm ngoài.
    catch_unwind(|| {
        if req_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
            return ERR_ARG;
        }
        // SAFETY: caller đảm bảo `req_ptr` đọc được `req_len` byte trong suốt lời gọi; ta copy ngay
        // nên không giữ con trỏ của Go sau khi hàm trả về.
        let req = unsafe { slice::from_raw_parts(req_ptr, req_len) }.to_vec();
        // `Box<[u8]>` là mảng byte nằm trên heap có chủ sở hữu duy nhất (ownership).
        let out: Box<[u8]> = dispatch::call(req).into_boxed_slice();
        let len = out.len();
        // `into_raw` bỏ quyền sở hữu: Rust không tự giải phóng nữa, Go giữ tới khi `s3b_free(ptr, len)`.
        let ptr = Box::into_raw(out).cast::<u8>();
        // SAFETY: `out_ptr` và `out_len` không null và ghi được theo hợp đồng.
        unsafe {
            *out_ptr = ptr;
            *out_len = len;
        }
        OK
    })
    .unwrap_or(ERR_PANIC)
}

/// Huỷ request `id` đang chạy; id lạ hoặc đã xong thì bỏ qua.
#[unsafe(no_mangle)]
pub extern "C" fn s3b_cancel(id: u64) {
    let _ = catch_unwind(|| registry::global().cancel(id));
}

/// Giải phóng buffer do `s3b_call` cấp.
///
/// # Safety
/// `ptr`/`len` đúng là cặp `out_ptr`/`out_len` mà `s3b_call` đã trả và chưa được giải phóng.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn s3b_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(|| {
        // SAFETY: theo hợp đồng, `ptr` và `len` là của một `Box<[u8]>` do `s3b_call` tạo.
        drop(unsafe { Box::from_raw(ptr::slice_from_raw_parts_mut(ptr, len)) });
    });
}
