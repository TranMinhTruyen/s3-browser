//! `s3b_call` trước `s3b_init` trả lỗi `internal`, sau init thì chạy bình thường.
//! Đặt riêng một binary vì runtime là global của process.

use s3b_db::ffi::{s3b_call, s3b_free, s3b_init};
use serde_json::Value;
use std::{ptr, slice};

fn call(req: &[u8]) -> Value {
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    // SAFETY: tham số hợp lệ; buffer trả về đọc rồi giải phóng một lần.
    unsafe {
        assert_eq!(s3b_call(req.as_ptr(), req.len(), &mut out, &mut len), 0);
        let v = serde_json::from_slice(slice::from_raw_parts(out, len)).unwrap();
        s3b_free(out, len);
        v
    }
}

#[test]
fn call_before_init_is_internal_then_works() {
    let req = br#"{"id":1,"method":"nope","params":{}}"#;
    let v = call(req);
    assert_eq!(v["ok"], false);
    assert_eq!(v["error"]["code"], "internal");

    assert_eq!(s3b_init(), 0);
    let v = call(req);
    assert_eq!(v["error"]["code"], "invalidRequest");
}
