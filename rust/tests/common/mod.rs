//! Helper dùng chung cho test tích hợp: gọi thật qua 4 hàm FFI và dựng file DB tạm.
#![allow(dead_code)]

use s3b_db::ffi::{s3b_call, s3b_cancel, s3b_free, s3b_init};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{ptr, slice};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_DIR: AtomicU64 = AtomicU64::new(1);

pub const PAGE: u64 = 500;
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;

pub fn init() {
    assert_eq!(s3b_init(), 0);
}

pub fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// Gọi `s3b_call` với bytes thô, trả JSON response đã parse; buffer giải phóng bằng `s3b_free`.
pub fn call_raw(req: &[u8]) -> Value {
    init();
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    // SAFETY: req đọc được `req.len()` byte; out và len là ô ghi được.
    let rc = unsafe { s3b_call(req.as_ptr(), req.len(), &mut out, &mut len) };
    assert_eq!(rc, 0);
    assert!(!out.is_null());
    // SAFETY: (out, len) vừa do s3b_call cấp, chưa free.
    let v = serde_json::from_slice(unsafe { slice::from_raw_parts(out, len) }).unwrap();
    // SAFETY: đúng cặp con trỏ/độ dài của s3b_call.
    unsafe { s3b_free(out, len) };
    v
}

pub fn call_with_id(id: u64, method: &str, params: Value) -> Value {
    let req = json!({"id": id, "method": method, "params": params});
    call_raw(req.to_string().as_bytes())
}

pub fn call(method: &str, params: Value) -> Value {
    call_with_id(next_id(), method, params)
}

pub fn cancel(id: u64) {
    s3b_cancel(id);
}

/// Response phải `ok: true`; trả `result`.
pub fn ok(resp: &Value) -> &Value {
    assert_eq!(resp["ok"], true, "{resp}");
    &resp["result"]
}

/// Response phải `ok: false`; trả mã lỗi.
pub fn err_code(resp: &Value) -> &str {
    assert_eq!(resp["ok"], false, "{resp}");
    assert!(resp["error"]["message"].is_string(), "{resp}");
    resp["error"]["code"].as_str().unwrap()
}

/// Thư mục tạm, tự xoá khi drop.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "s3b_db_test_{}_{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn file(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Một DB SQLite tạm đã mở (file 0 byte là DB rỗng hợp lệ); đóng và xoá khi drop.
pub struct Db {
    pub dir: TempDir,
    pub path: String,
    pub conn: u64,
}

impl Db {
    pub fn new() -> Self {
        let dir = TempDir::new();
        let path = dir.file("t.db");
        std::fs::File::create(&path).unwrap();
        let conn = open(&path, false);
        Self { dir, path, conn }
    }

    pub fn exec(&self, sql: &str) -> Value {
        exec(self.conn, sql)
    }

    /// Mở thêm một connection cùng file.
    pub fn open_more(&self) -> u64 {
        open(&self.path, false)
    }
}

impl Drop for Db {
    fn drop(&mut self) {
        call("close", json!({"connId": self.conn}));
    }
}

pub fn open(path: &str, read_only: bool) -> u64 {
    let r = call(
        "open",
        json!({"driver": "sqlite", "path": path, "readOnly": read_only}),
    );
    ok(&r)["connId"].as_u64().unwrap()
}

pub fn exec_page(conn: u64, sql: &str, page: u64, max_bytes: u64) -> Value {
    call(
        "execute",
        json!({"connId": conn, "sql": sql, "pageSize": page, "maxPageBytes": max_bytes}),
    )
}

pub fn exec(conn: u64, sql: &str) -> Value {
    exec_page(conn, sql, PAGE, MAX_BYTES)
}

pub fn fetch_page(conn: u64, cursor: u64, page: u64, max_bytes: u64) -> Value {
    call(
        "fetch",
        json!({"connId": conn, "cursorId": cursor, "pageSize": page, "maxPageBytes": max_bytes}),
    )
}

pub fn fetch(conn: u64, cursor: u64) -> Value {
    fetch_page(conn, cursor, PAGE, MAX_BYTES)
}

/// `statements` của một response execute thành công.
pub fn statements(resp: &Value) -> &Vec<Value> {
    ok(resp)["statements"].as_array().unwrap()
}

/// SQL sinh `n` dòng 1..=n.
pub fn series(n: u64) -> String {
    format!(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<{n}) SELECT x FROM c"
    )
}

pub const INFINITE: &str =
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c";

/// Chuyển tiếp TCP từ `127.0.0.2:<cổng tự chọn>` tới `127.0.0.1:target_port`. Chứng chỉ server test
/// chỉ có `localhost`, `127.0.0.1`, `::1` và tên service nên `127.0.0.2` là host "không có trong
/// SAN" (Docker chỉ publish cổng ở 127.0.0.1 nên không nối thẳng tới 127.0.0.2 được). Trả
/// `(host, cổng)`, `None` nếu máy không bind được 127.0.0.2. Thread chuyển tiếp chạy tới hết tiến
/// trình test.
pub fn host_outside_the_certificate(target_port: u16) -> Option<(String, u16)> {
    use std::net::{SocketAddr, TcpListener, TcpStream};
    let listener = TcpListener::bind(("127.0.0.2", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let target = SocketAddr::from(([127, 0, 0, 1], target_port));
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            let Ok(server) = TcpStream::connect(target) else {
                continue;
            };
            let (Ok(mut c_read), Ok(mut s_read)) = (client.try_clone(), server.try_clone()) else {
                continue;
            };
            let (mut c_write, mut s_write) = (client, server);
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut c_read, &mut s_write);
            });
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut s_read, &mut c_write);
            });
        }
    });
    Some(("127.0.0.2".to_owned(), port))
}
