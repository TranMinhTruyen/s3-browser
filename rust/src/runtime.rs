//! Tokio runtime duy nhất của thư viện, tạo một lần ở `s3b_init`.

use std::sync::OnceLock;
use tokio::runtime::{Builder, Runtime};

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Tạo runtime nếu chưa có; gọi nhiều lần vô hại.
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

pub fn get() -> Option<&'static Runtime> {
    RUNTIME.get()
}
