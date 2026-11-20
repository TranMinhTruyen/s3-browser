//! Helper cho test cần SQL Server thật (container `s3b-test-mssql` của `test-env/`, 2022).
//!
//! Mật khẩu KHÔNG nằm trong code: đọc lúc chạy từ biến môi trường `S3B_MSSQL_PASSWORD` hoặc dòng
//! `DB_PASSWORD=` của `test-env/db/db.env`. Server không tới được (Docker chưa chạy, thiếu mật
//! khẩu) thì test in `SKIP ...` rồi kết thúc đạt, để máy không có Docker vẫn chạy được `cargo test`.
//! Không in mật khẩu ra output và không đặt `Debug` cho `Server` để không vô tình bị in.
#![allow(dead_code)]

use crate::common::{
    MAX_BYTES, call, call_with_id, exec, exec_page, fetch, fetch_page, next_id, ok,
};
use serde_json::{Map, Value, json};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const HOST: &str = "127.0.0.1";

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

/// Thông tin tới server test. Không `derive(Debug)` vì có mật khẩu.
pub struct Server {
    pub port: u16,
    user: String,
    password: String,
}

/// Server nếu dùng được, ngược lại in `SKIP` và trả `None` (test gọi `return`).
pub fn server(test: &str) -> Option<Server> {
    let password = std::env::var("S3B_MSSQL_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env_file_value("DB_PASSWORD"));
    let Some(password) = password else {
        println!(
            "SKIP sqlserver {test}: chưa có mật khẩu (S3B_MSSQL_PASSWORD hoặc test-env/db/db.env)"
        );
        return None;
    };
    let port = std::env::var("S3B_MSSQL_PORT")
        .ok()
        .or_else(|| env_file_value("MSSQL_PORT"))
        .and_then(|p| p.parse().ok())
        .unwrap_or(10033);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_err() {
        println!(
            "SKIP sqlserver {test}: không nối được {HOST}:{port} (chạy test-env/docker-compose-db.yml)"
        );
        return None;
    }
    let user = env_file_value("MSSQL_USER").unwrap_or_else(|| "sa".to_owned());
    Some(Server {
        port,
        user,
        password,
    })
}

/// Sinh cho mỗi `fn name(s: &Server) { ... }` một `#[test]` bỏ qua (in `SKIP`) khi không có server.
/// Thêm `#[ignore = "..."]` ở trước `fn` để đánh dấu test chậm.
#[macro_export]
macro_rules! mssql {
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

impl Server {
    /// Params của `open` tới database `master` với TLS `mode` (có `caFile` để mode verify chạy được).
    pub fn params(&self, mode: &str) -> Value {
        json!({
            "driver": "sqlserver", "host": HOST, "port": self.port, "username": self.user,
            "password": self.password, "database": "master",
            "tls": {"mode": mode, "caFile": ca_file()}
        })
    }

    /// Như `params` nhưng ghi đè các field trong `over` (giá trị `null` nghĩa là bỏ field).
    pub fn params_with(&self, mode: &str, over: Value) -> Value {
        let mut p = self.params(mode);
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

    /// Response thô của `open`.
    pub fn open(&self, mode: &str) -> Value {
        call("open", self.params(mode))
    }

    /// Mở connection thành công (panic nếu lỗi); tự `close` khi drop.
    pub fn connect(&self, mode: &str) -> Conn {
        let r = self.open(mode);
        Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
        }
    }

    /// Connection mặc định cho phần lớn test: không TLS.
    pub fn conn(&self) -> Conn {
        self.connect("disable")
    }

    /// Mở từ params đã chỉnh (panic nếu lỗi).
    pub fn conn_with(&self, mode: &str, over: Value) -> Conn {
        let r = call("open", self.params_with(mode, over));
        Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
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

/// Một connection đã mở; đóng khi drop (bỏ qua lỗi nếu test đã tự đóng).
pub struct Conn {
    pub id: u64,
}

impl Conn {
    pub fn exec(&self, sql: &str) -> Value {
        exec(self.id, sql)
    }

    pub fn exec_page(&self, sql: &str, page: u64, max_bytes: u64) -> Value {
        exec_page(self.id, sql, page, max_bytes)
    }

    pub fn fetch(&self, cursor: u64) -> Value {
        fetch(self.id, cursor)
    }

    pub fn fetch_page(&self, cursor: u64, page: u64, max_bytes: u64) -> Value {
        fetch_page(self.id, cursor, page, max_bytes)
    }

    /// Ô đầu tiên của câu đầu tiên (chuỗi, hoặc `null` nếu NULL).
    pub fn first(&self, sql: &str) -> Value {
        first_cell(&self.exec(sql))
    }

    /// Chạy `sql` ở thread riêng với `id` biết trước để `s3b_cancel(id)` huỷ được.
    pub fn exec_in_thread(&self, id: u64, sql: &str) -> JoinHandle<Value> {
        let (conn, sql) = (self.id, sql.to_owned());
        std::thread::spawn(move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": sql, "pageSize": 10, "maxPageBytes": MAX_BYTES}),
            )
        })
    }

    /// Định danh `connection_id` (GUID) của connection phía server. Khác `@@SPID`: server TÁI DÙNG số
    /// SPID ngay sau khi session cũ đóng nên không dùng SPID để chứng minh "đã nối lại".
    pub fn link(&self) -> String {
        self.first("SELECT CAST(connection_id AS varchar(40)) FROM sys.dm_exec_connections WHERE session_id = @@SPID")
            .as_str()
            .unwrap()
            .to_owned()
    }

    /// `@@SPID` của connection này (id session phía server).
    pub fn spid(&self) -> String {
        self.first("SELECT CAST(@@SPID AS int)")
            .as_str()
            .unwrap()
            .to_owned()
    }
}

impl Drop for Conn {
    fn drop(&mut self) {
        call("close", json!({"connId": self.id}));
    }
}

/// Ô đầu tiên của câu đầu tiên của một response `execute`; câu không phải `rows` thì trả
/// chuỗi mô tả để assert fail kèm lý do.
pub fn first_cell(r: &Value) -> Value {
    let st = &ok(r)["statements"][0];
    if st["kind"] != "rows" {
        return json!(format!("NOT ROWS: {st}"));
    }
    st["rows"][0][0].clone()
}

/// Câu đầu của response là thông báo "connection was reset" (xem `Session::ensure_connected`): lần
/// nối lại sau khi bỏ cursor mà không phải do người dùng huỷ. Câu đó và các câu sau không chạy.
pub fn is_reset_notice(r: &Value) -> bool {
    ok(r)["statements"][0]["error"]["message"]
        .as_str()
        .is_some_and(|m| m.starts_with("connection was reset"))
}

/// Số dòng của câu thứ `i`.
pub fn row_count(r: &Value, i: usize) -> usize {
    ok(r)["statements"][i]["rows"].as_array().unwrap().len()
}

/// `n` dòng (x, 'row x'). Không cần CTE đệ quy: đánh số dòng của tích hai bảng hệ thống (mỗi bảng
/// hàng nghìn dòng) nên `n` tới hàng triệu vẫn được.
pub fn series_ms(n: u64) -> String {
    format!(
        "SELECT TOP ({n}) CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS int) AS x, \
         CONCAT('row ', ROW_NUMBER() OVER (ORDER BY (SELECT NULL))) AS t \
         FROM sys.all_objects a CROSS JOIN sys.all_objects b"
    )
}

/// Nguồn dòng khổng lồ chạy ngay, có `marker` để nhận ra câu ở server (tích 3 bảng hệ thống,
/// hàng chục tỷ dòng nên không bao giờ hết trong thời gian test).
pub fn endless_rows(marker: &str) -> String {
    format!(
        "SELECT a.object_id AS x, '{marker}' AS m \
         FROM sys.all_objects a, sys.all_objects b, sys.all_objects c"
    )
}

/// Chờ tới khi điều kiện đúng (thăm dò), tối đa `limit`; panic kèm `what` nếu hết hạn.
pub fn wait_for(limit: Duration, what: &str, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !cond() {
        assert!(Instant::now() < deadline, "hết hạn chờ: {what}");
        std::thread::yield_now();
    }
}

/// Số request đang chạy ở server mà text batch chứa `marker` (không tính chính câu hỏi này).
fn active_count(monitor: &Conn, marker: &str) -> Value {
    monitor.first(&format!(
        "SELECT CAST(COUNT(*) AS int) FROM sys.dm_exec_requests r \
         CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t \
         WHERE r.session_id <> @@SPID AND t.text LIKE '%{marker}%'"
    ))
}

/// Cho tới khi một batch có `marker` đang chạy ở server (đã chạy thật), tối đa 10 s. Chờ theo
/// ĐIỀU KIỆN (thăm dò `sys.dm_exec_requests`), không ngủ cố định: huỷ chỉ có nghĩa khi câu đã ở
/// server, mà trạng thái đó chỉ quan sát được từ connection khác.
pub fn wait_until_active(monitor: &Conn, marker: &str) {
    wait_for(Duration::from_secs(10), marker, || {
        active_count(monitor, marker) == "1"
    });
}

/// Không còn batch nào có `marker` chạy ở server, tối đa 10 s.
pub fn wait_until_gone(monitor: &Conn, marker: &str) {
    wait_for(Duration::from_secs(10), marker, || {
        active_count(monitor, marker) == "0"
    });
}

/// Marker duy nhất cho một lần chạy (để `wait_until_active` không nhầm câu của test khác).
pub fn marker(prefix: &str) -> String {
    format!("{prefix}_{}_{}", std::process::id(), next_id())
}

/// Còn connection có `link` (GUID `connection_id`, xem `Conn::link`) ở server không (dùng để biết
/// đóng TCP đã dọn phiên). Không tra theo SPID: server tái dùng số SPID cho session mới (kể cả
/// của test khác chạy song song), nên "SPID cũ còn tồn tại" không có nghĩa session cũ chưa đóng.
pub fn link_exists(monitor: &Conn, link: &str) -> bool {
    monitor.first(&format!(
        "SELECT CAST(COUNT(*) AS int) FROM sys.dm_exec_connections WHERE connection_id = '{link}'"
    )) == "1"
}
