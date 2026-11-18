//! Tokio runtime duy nhất của thư viện, tạo một lần ở `s3b_init`.
//!
//! Runtime là bộ chạy các tác vụ async (giống scheduler goroutine của Go): `dispatch` đưa
//! mỗi request vào đây. Chỉ có một runtime cho cả DLL, không tạo mới mỗi lần gọi.

use std::sync::OnceLock;
use tokio::runtime::{Builder, Runtime};

/// Biến toàn cục giữ runtime. `OnceLock` chỉ cho gán đúng một lần (giống `sync.Once` của Go)
/// và đọc an toàn từ nhiều thread sau đó.
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Tạo runtime nếu chưa có; gọi nhiều lần vô hại.
/// Trả `Err(thông báo)` nếu hệ điều hành không cho tạo thread. `Result` là cách Rust trả lỗi
/// thay cho exception: caller buộc phải xử lý `Ok`/`Err`.
pub fn init() -> Result<(), String> {
    if RUNTIME.get().is_some() {
        return Ok(());
    }
    let rt = Builder::new_multi_thread()
        .enable_all()
        .thread_name("s3b-db")
        .build()
        .map_err(|e| e.to_string())?;
    // Hai luồng init đồng thời: bản thua bị drop, bản thắng được dùng.
    let _ = RUNTIME.set(rt);
    Ok(())
}

/// Runtime đã tạo, hoặc `None` nếu `s3b_init` chưa được gọi. `&'static` nghĩa là tham chiếu
/// sống suốt đời chương trình (vì nằm trong biến `static`).
pub fn get() -> Option<&'static Runtime> {
    RUNTIME.get()
}
