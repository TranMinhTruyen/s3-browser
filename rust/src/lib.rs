//! Thư viện `s3b_db`: client database cho S3Browser, Go gọi qua 4 hàm C trong `ffi`.
//!
//! Luồng một request: Go -> `ffi` (hàm C, JSON) -> `dispatch` (chọn theo `method`)
//! -> `drivers::<db>` (chạy SQL) -> JSON trả ngược về Go.
//!
//! Trong Rust mỗi file là một module; `pub mod` bên dưới khai báo các module và cho phép
//! module khác (và test) dùng chúng.

/// Chọn xử lý theo `method`.
pub mod dispatch;
/// Driver theo loại database.
pub mod drivers;
/// Các hàm C export cho Go.
pub mod ffi;
/// Kiểu JSON và mã lỗi.
pub mod protocol;
/// Registry connection và request (phục vụ huỷ).
pub mod registry;
/// Tokio runtime dùng chung.
pub mod runtime;
