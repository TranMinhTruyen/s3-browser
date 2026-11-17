//! 4 hàm C export cho Go. Mọi thân hàm bọc `catch_unwind`: panic không bao giờ đi qua ranh giới C.

use crate::{dispatch, registry, runtime};
use std::panic::catch_unwind;
use std::{ptr, slice};

/// Mã trả về: 0 thành công.
const OK: i32 = 0;
const ERR_ARG: i32 = 1;
const ERR_INIT: i32 = 2;
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
    catch_unwind(|| {
        if req_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
            return ERR_ARG;
        }
        // SAFETY: caller đảm bảo `req_ptr` đọc được `req_len` byte trong suốt lời gọi; ta copy ngay
        // nên không giữ con trỏ của Go sau khi hàm trả về.
        let req = unsafe { slice::from_raw_parts(req_ptr, req_len) }.to_vec();
        let out: Box<[u8]> = dispatch::call(req).into_boxed_slice();
        let len = out.len();
        // Quyền sở hữu chuyển cho Go cho tới khi `s3b_free(ptr, len)`.
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
