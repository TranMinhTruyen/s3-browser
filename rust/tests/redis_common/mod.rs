//! Helper cho test cần Redis thật (container `s3b-test-redis` của `test-env/`).
//!
//! Mật khẩu KHÔNG nằm trong code: đọc lúc chạy từ biến môi trường `S3B_REDIS_PASSWORD` hoặc dòng
//! `DB_PASSWORD=` của `test-env/db/db.env`. Server không tới được (Docker chưa chạy, thiếu mật
//! khẩu) thì test in `SKIP ...` rồi kết thúc đạt, để máy không có Docker vẫn chạy được `cargo test`.
//! Không in mật khẩu ra output và không đặt `Debug` cho `Server` để không vô tình bị in.
//!
//! Server test mở hai cổng: thường (`REDIS_PORT`, mặc định 10035) và TLS (`REDIS_TLS_PORT`, mặc
//! định 10036), cùng một mật khẩu, không có username. Redis không có "database" như SQL nên mỗi
//! test dùng số DB trong khoảng 11..=15 (không đụng DB 0) và key có tiền tố `s3b_test_` kèm pid và
//! số thứ tự; `Conn` xoá các key đã xin qua `Conn::key` khi bị drop nên các test độc lập nhau.
#![allow(dead_code)]

use crate::common::{
    MAX_BYTES, call, call_with_id, exec, exec_page, fetch, fetch_page, next_id, ok, skip_or_fail,
};
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const HOST: &str = "127.0.0.1";
/// Cổng mặc định của `test-env/` khi không đọc được `db.env`.
const DEFAULT_PORT: u16 = 10035;
const DEFAULT_TLS_PORT: u16 = 10036;
/// DB dành cho test: 11..=15.
const FIRST_DB: u64 = 11;
const DB_COUNT: u64 = 5;

static NEXT_DB: AtomicU64 = AtomicU64::new(0);

/// Thư mục `test-env/` ở gốc repo.
pub fn test_env() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("test-env")
}

/// File CA của server test (đường dẫn tuyệt đối).
pub fn ca_file() -> String {
    test_env()
        .join("certs")
        .join("ca.pem")
        .to_string_lossy()
        .into_owned()
}

/// Giá trị `KEY=value` trong `test-env/db/db.env`.
fn env_file_value(key: &str) -> Option<String> {
    let text = std::fs::read_to_string(test_env().join("db").join("db.env")).ok()?;
    let prefix = format!("{key}=");
    text.lines()
        .find_map(|l| l.strip_prefix(&prefix))
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Số DB kế tiếp trong 11..=15 (xoay vòng) để các test không dồn vào một DB.
pub fn next_db() -> u64 {
    FIRST_DB + NEXT_DB.fetch_add(1, Ordering::Relaxed) % DB_COUNT
}

fn reachable(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_ok()
}

/// Thông tin tới server test. Không `derive(Debug)` vì có mật khẩu.
pub struct Server {
    pub port: u16,
    pub tls_port: u16,
    password: String,
}

fn password() -> Option<String> {
    std::env::var("S3B_REDIS_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env_file_value("DB_PASSWORD"))
}

fn port_of(var: &str, key: &str, default: u16) -> u16 {
    std::env::var(var)
        .ok()
        .or_else(|| env_file_value(key))
        .and_then(|p| p.parse().ok())
        .unwrap_or(default)
}

/// Server (cổng thường) nếu dùng được, ngược lại in `SKIP` và trả `None` (test gọi `return`).
pub fn server(test: &str) -> Option<Server> {
    let Some(password) = password() else {
        skip_or_fail(&format!(
            "SKIP redis {test}: chưa có mật khẩu (S3B_REDIS_PASSWORD hoặc test-env/db/db.env)"
        ));
        return None;
    };
    let port = port_of("S3B_REDIS_PORT", "REDIS_PORT", DEFAULT_PORT);
    if !reachable(port) {
        skip_or_fail(&format!(
            "SKIP redis {test}: không nối được {HOST}:{port} (chạy test-env/docker-compose.yml)"
        ));
        return None;
    }
    let tls_port = port_of("S3B_REDIS_TLS_PORT", "REDIS_TLS_PORT", DEFAULT_TLS_PORT);
    Some(Server {
        port,
        tls_port,
        password,
    })
}

/// Như `server` nhưng đòi thêm cổng TLS nghe được.
pub fn tls_server(test: &str) -> Option<Server> {
    let s = server(test)?;
    if !reachable(s.tls_port) {
        skip_or_fail(&format!(
            "SKIP redis {test}: không nối được cổng TLS {HOST}:{} (chạy test-env/docker-compose.yml)",
            s.tls_port
        ));
        return None;
    }
    Some(s)
}

/// Sinh cho mỗi `fn name(s: &Server) { ... }` một `#[test]` bỏ qua (in `SKIP`) khi không có server.
/// Thêm `#[ignore = "..."]` ở trước `fn` để đánh dấu test chậm.
#[macro_export]
macro_rules! redis {
    ($($(#[$meta:meta])* fn $name:ident($s:ident: &Server) $body:block)*) => {
        $(
            #[test]
            $(#[$meta])*
            fn $name() {
                if let Some($s) = server(stringify!($name)) {
                    let $s = &$s;
                    $body
                }
            }
        )*
    };
}

/// Như `redis!` nhưng đòi cả cổng TLS (`tls_server`).
#[macro_export]
macro_rules! redis_tls {
    ($($(#[$meta:meta])* fn $name:ident($s:ident: &Server) $body:block)*) => {
        $(
            #[test]
            $(#[$meta])*
            fn $name() {
                if let Some($s) = tls_server(stringify!($name)) {
                    let $s = &$s;
                    $body
                }
            }
        )*
    };
}

impl Server {
    /// Params của `open` tới cổng `port`, DB `db`, TLS `mode` (có `caFile` để mode verify chạy được).
    pub fn params_on(&self, port: u16, mode: &str, db: u64) -> Value {
        json!({
            "driver": "redis", "host": HOST, "port": port, "password": self.password,
            "database": db.to_string(),
            "tls": {"mode": mode, "caFile": ca_file()}
        })
    }

    /// Params tới cổng thường, `disable`, một DB mới trong 11..=15.
    pub fn params(&self) -> Value {
        self.params_on(self.port, "disable", next_db())
    }

    /// Như `params` nhưng ghi đè các field trong `over` (giá trị `null` nghĩa là bỏ field).
    pub fn params_with(&self, over: Value) -> Value {
        merge(self.params(), over)
    }

    /// Như `params_on` rồi ghi đè `over`.
    pub fn params_on_with(&self, port: u16, mode: &str, db: u64, over: Value) -> Value {
        merge(self.params_on(port, mode, db), over)
    }

    /// Mở connection thành công (panic nếu lỗi) tới cổng thường, `disable`, DB mới.
    pub fn conn(&self) -> Conn {
        self.conn_with(json!({}))
    }

    /// Mở từ params đã chỉnh (panic nếu lỗi).
    pub fn conn_with(&self, over: Value) -> Conn {
        self.conn_from(self.params_with(over))
    }

    /// Mở từ params nguyên văn (panic nếu lỗi).
    pub fn conn_from(&self, params: Value) -> Conn {
        let db = params["database"]
            .as_str()
            .and_then(|d| d.parse().ok())
            .unwrap_or(0);
        let r = call("open", params);
        Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
            db,
            keys: RefCell::new(Vec::new()),
        }
    }

    /// Mật khẩu sai chắc chắn (khác mật khẩu thật).
    pub fn wrong_password(&self) -> String {
        format!("wrong-{}-x", self.password.len())
    }

    /// Mật khẩu thật, chỉ để kiểm response KHÔNG chứa nó.
    pub fn password_leaks_in(&self, response: &Value) -> bool {
        response.to_string().contains(&self.password)
    }
}

/// Ghi đè các field của `p` bằng `over` (giá trị `null` nghĩa là bỏ field).
pub fn merge(mut p: Value, over: Value) -> Value {
    let Some(map) = p.as_object_mut() else {
        return p;
    };
    for (k, v) in over.as_object().cloned().unwrap_or_else(Map::new) {
        if v.is_null() {
            map.remove(&k);
        } else {
            map.insert(k, v);
        }
    }
    p
}

/// Một connection đã mở; xoá các key đã xin qua `key` rồi đóng khi drop.
pub struct Conn {
    pub id: u64,
    /// DB lúc mở.
    pub db: u64,
    keys: RefCell<Vec<String>>,
}

impl Conn {
    pub fn exec(&self, text: &str) -> Value {
        exec(self.id, text)
    }

    pub fn exec_page(&self, text: &str, page: u64, max_bytes: u64) -> Value {
        exec_page(self.id, text, page, max_bytes)
    }

    pub fn fetch(&self, cursor: u64) -> Value {
        fetch(self.id, cursor)
    }

    pub fn fetch_page(&self, cursor: u64, page: u64, max_bytes: u64) -> Value {
        fetch_page(self.id, cursor, page, max_bytes)
    }

    /// Chạy `text` ở thread riêng với `id` biết trước để `s3b_cancel(id)` huỷ được.
    pub fn exec_in_thread(&self, id: u64, text: &str) -> JoinHandle<Value> {
        let (conn, text) = (self.id, text.to_owned());
        std::thread::spawn(move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": text, "pageSize": 10, "maxPageBytes": MAX_BYTES}),
            )
        })
    }

    /// Tên key duy nhất cho test, tự xoá khi `Conn` bị drop (kể cả khi test panic).
    pub fn key(&self, name: &str) -> String {
        let key = format!("s3b_test_{}_{}_{name}", std::process::id(), next_id());
        self.keys.borrow_mut().push(key.clone());
        key
    }

    /// Các ô (cột đầu) của câu đầu tiên; câu đó phải là `rows`.
    pub fn col(&self, text: &str) -> Vec<Option<String>> {
        col_of(&self.exec(text), 0)
    }

    /// Ô đầu tiên của câu đầu tiên.
    pub fn cell(&self, text: &str) -> Option<String> {
        self.col(text).into_iter().next().expect("không có dòng")
    }

    /// Ô đầu tiên dạng chuỗi (panic nếu NULL).
    pub fn text(&self, text: &str) -> String {
        self.cell(text).expect("ô là NULL")
    }

    /// Các client của server (kết quả `CLIENT LIST`), mỗi client một dòng `key=value ...`.
    pub fn client_list(&self) -> Vec<String> {
        self.text("CLIENT LIST")
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Dòng `CLIENT LIST` của client có `name=<name>`.
    pub fn client_named(&self, name: &str) -> Option<String> {
        let tag = format!(" name={name} ");
        self.client_list().into_iter().find(|l| l.contains(&tag))
    }
}

impl Conn {
    /// Bọc một connection đã mở sẵn (ví dụ qua `open_in_thread`) để có `exec`, `text`... và tự
    /// `close` khi drop.
    pub fn adopt(id: u64) -> Self {
        Self {
            id,
            db: 0,
            keys: RefCell::new(Vec::new()),
        }
    }

    /// Xoá các key đã xin qua `key` (kể cả khi test đã `SELECT` sang DB khác). Test sắp tự `close`
    /// connection thì gọi trước, vì sau khi đóng `Drop` không còn xoá được.
    pub fn cleanup(&self) {
        let keys = self.keys.take();
        if !keys.is_empty() {
            // `SELECT` trước vì test có thể đã đổi DB; `DEL` nhiều key trong một lệnh.
            exec(
                self.id,
                &format!(
                    "SELECT {}
DEL {}",
                    self.db,
                    keys.join(" ")
                ),
            );
        }
    }
}

impl Drop for Conn {
    fn drop(&mut self) {
        self.cleanup();
        call("close", json!({"connId": self.id}));
    }
}

/// Statement thứ `i` của một response `execute` thành công.
pub fn stmt(r: &Value, i: usize) -> &Value {
    &ok(r)["statements"][i]
}

/// Cột đầu của câu `i` (câu phải là `rows`).
pub fn col_of(r: &Value, i: usize) -> Vec<Option<String>> {
    let st = stmt(r, i);
    assert_eq!(st["kind"], "rows", "{st}");
    rows_col(&st["rows"], 0)
}

/// Cột `c` của một mảng dòng (`rows` của câu hoặc của `fetch`).
pub fn rows_col(rows: &Value, c: usize) -> Vec<Option<String>> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|row| row[c].as_str().map(str::to_owned))
        .collect()
}

/// Mã lỗi của một câu (rỗng nếu câu không lỗi).
pub fn code_of(statement: &Value) -> &str {
    statement["error"]["code"].as_str().unwrap_or("")
}

/// Thông báo lỗi của một câu (rỗng nếu câu không lỗi).
pub fn message_of(statement: &Value) -> &str {
    statement["error"]["message"].as_str().unwrap_or("")
}

/// Thông báo lỗi của response (`ok: false`).
pub fn message(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

/// Đi hết cursor của câu `st` (kết quả của `execute`) bằng `fetch` trang `page`; trả các dòng cột
/// đầu của từng trang (kể cả trang đầu của `st`). Response `fetch` không có `cursorId`: cursor
/// giữ nguyên id từ `execute` cho tới khi trang cuối báo `done`.
pub fn walk(c: &Conn, st: &Value, page: u64, max_bytes: u64) -> Vec<Vec<String>> {
    let first = |rows: &Value| -> Vec<String> {
        rows_col(rows, 0)
            .into_iter()
            .map(|v| v.expect("ô NULL"))
            .collect()
    };
    let mut pages = vec![first(&st["rows"])];
    if st["done"] == true {
        return pages;
    }
    let cursor = st["cursorId"]
        .as_u64()
        .expect("chưa done thì phải có cursor");
    for _ in 0..100_000 {
        let r = c.fetch_page(cursor, page, max_bytes);
        let r = ok(&r);
        pages.push(first(&r["rows"]));
        if r["done"] == true {
            return pages;
        }
    }
    panic!("cursor không bao giờ hết");
}

/// Chờ tới khi điều kiện đúng (thăm dò), tối đa `limit`; panic kèm `what` nếu hết hạn. Mỗi lần
/// thăm dò là một vòng mạng nên không cần ngủ.
pub fn wait_for(limit: Duration, what: &str, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !cond() {
        assert!(Instant::now() < deadline, "hết hạn chờ: {what}");
        std::thread::yield_now();
    }
}

/// Tên client duy nhất cho một lần chạy (để nhận ra ở `CLIENT LIST`).
pub fn client_name(prefix: &str) -> String {
    format!("{prefix}_{}_{}", std::process::id(), next_id())
}

/// Cho tới khi client tên `name` đang bị chặn ở server (cờ `b` của `CLIENT LIST`), tối đa 10 s.
pub fn wait_until_blocked(monitor: &Conn, name: &str) {
    wait_for(Duration::from_secs(10), name, || {
        monitor
            .client_named(name)
            .is_some_and(|l| l.contains(" flags=b "))
    });
}

/// Cho tới khi server không còn client tên `name` (kết nối đã đóng), tối đa 10 s.
pub fn wait_until_gone(monitor: &Conn, name: &str) {
    wait_for(Duration::from_secs(10), name, || {
        monitor.client_named(name).is_none()
    });
}
