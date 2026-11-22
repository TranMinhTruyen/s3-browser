//! Helper cho test cần MySQL / MariaDB thật (container `s3b-test-mysql`, `s3b-test-mariadb` của
//! `test-env/`). Mỗi test chạy cho CẢ HAI server bằng macro `both!`, sinh ra hai test con
//! `<tên>::mysql` và `<tên>::mariadb` để đếm riêng được.
//!
//! Mật khẩu KHÔNG nằm trong code: đọc lúc chạy từ biến môi trường `S3B_MYSQL_PASSWORD` hoặc dòng
//! `DB_PASSWORD=` của `test-env/db/db.env`. Server không tới được (Docker chưa chạy, thiếu mật
//! khẩu) thì test in `SKIP ...` rồi kết thúc đạt, để máy không có Docker vẫn chạy được `cargo test`.
//! Không in mật khẩu ra output và không đặt `Debug` cho `Server` để không vô tình bị in.
#![allow(dead_code)]

use crate::common::{
    MAX_BYTES, call, call_with_id, exec, exec_page, fetch, fetch_page, next_id, ok, skip_or_fail,
};
use serde_json::{Map, Value, json};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const HOST: &str = "127.0.0.1";

/// Hai server cùng giao thức; khác biệt hành vi nhỏ nên test cần biết đang chạy trên server nào.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Flavor {
    MySql,
    MariaDb,
}

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

/// Thông tin tới một server test. Không `derive(Debug)` vì có mật khẩu.
pub struct Server {
    pub flavor: Flavor,
    pub port: u16,
    user: String,
    password: String,
}

/// Server `flavor` nếu dùng được, ngược lại in `SKIP` và trả `None` (test gọi `return`).
pub fn server(flavor: Flavor, test: &str) -> Option<Server> {
    let (driver, port_env, port_key, user_key, default_port) = match flavor {
        Flavor::MySql => ("mysql", "S3B_MYSQL_PORT", "MYSQL_PORT", "MYSQL_USER", 10030),
        Flavor::MariaDb => (
            "mariadb",
            "S3B_MARIADB_PORT",
            "MARIADB_PORT",
            "MARIADB_USER",
            10031,
        ),
    };
    let password = std::env::var("S3B_MYSQL_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env_file_value("DB_PASSWORD"));
    let Some(password) = password else {
        skip_or_fail(&format!(
            "SKIP {driver} {test}: chưa có mật khẩu (S3B_MYSQL_PASSWORD hoặc test-env/db/db.env)"
        ));
        return None;
    };
    let port = std::env::var(port_env)
        .ok()
        .or_else(|| env_file_value(port_key))
        .and_then(|p| p.parse().ok())
        .unwrap_or(default_port);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_err() {
        skip_or_fail(&format!(
            "SKIP {driver} {test}: không nối được {HOST}:{port} (chạy test-env/docker-compose-db.yml)"
        ));
        return None;
    }
    let user = env_file_value(user_key).unwrap_or_else(|| "root".to_owned());
    Some(Server {
        flavor,
        port,
        user,
        password,
    })
}

/// Sinh cho mỗi `fn name(s: &Server) { ... }` một module có hai test: `mysql` và `mariadb`.
/// Thêm `#[ignore = "..."]` ở trước `fn` để đánh dấu cả hai.
#[macro_export]
macro_rules! both {
    ($($(#[$meta:meta])* fn $name:ident($s:ident: &Server) $body:block)*) => {
        $(
            mod $name {
                #[allow(unused_imports)]
                use super::*;
                fn run($s: &Server) $body
                #[test]
                $(#[$meta])*
                fn mysql() {
                    if let Some(s) = server(Flavor::MySql, stringify!($name)) {
                        run(&s);
                    }
                }
                #[test]
                $(#[$meta])*
                fn mariadb() {
                    if let Some(s) = server(Flavor::MariaDb, stringify!($name)) {
                        run(&s);
                    }
                }
            }
        )*
    };
}

impl Server {
    pub fn is_mariadb(&self) -> bool {
        self.flavor == Flavor::MariaDb
    }

    /// Tên driver trong `open.driver`.
    pub fn driver(&self) -> &'static str {
        match self.flavor {
            Flavor::MySql => "mysql",
            Flavor::MariaDb => "mariadb",
        }
    }

    /// Params của `open` tới database `s3b` với TLS `mode` (có `caFile` để mode verify chạy được).
    pub fn params(&self, mode: &str) -> Value {
        json!({
            "driver": self.driver(), "host": HOST, "port": self.port, "username": self.user,
            "password": self.password, "database": "s3b",
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

    /// `connection_id()` của connection này (cũng là id thread phía server).
    pub fn thread_id(&self) -> String {
        self.first("select connection_id()")
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

/// Số dòng của câu thứ `i`.
pub fn row_count(r: &Value, i: usize) -> usize {
    ok(r)["statements"][i]["rows"].as_array().unwrap().len()
}

/// `n` dòng (x, 'row x') bằng CTE đệ quy (cả MySQL 8 lẫn MariaDB 11 đều hỗ trợ). `@@cte_max_recursion_depth`
/// của MySQL mặc định 1000 nên đặt `option` khi cần nhiều hơn; MariaDB dùng `max_recursive_iterations`.
pub fn series_my(n: u64) -> String {
    format!(
        "with recursive c(x) as (select 1 union all select x+1 from c where x<{n}) \
         select x, concat('row ', x) as t from c"
    )
}

/// Đặt giới hạn đệ quy đủ lớn cho `series_my` trên connection `c` (theo từng server).
pub fn allow_deep_recursion(s: &Server, c: &Conn) {
    let sql = match s.flavor {
        Flavor::MySql => "set session cte_max_recursion_depth = 10000000",
        Flavor::MariaDb => "set session max_recursive_iterations = 10000000",
    };
    ok(&c.exec(sql));
}

/// Cho tới khi một câu có `marker` trong text đang chạy ở server (đã chạy thật), tối đa 10 s.
/// Đây là chờ theo ĐIỀU KIỆN (thăm dò `information_schema.processlist`), không phải ngủ cố định:
/// huỷ chỉ có nghĩa khi câu đã ở server, mà trạng thái đó chỉ quan sát được từ connection khác.
pub fn wait_until_active(monitor: &Conn, marker: &str) {
    let sql = format!(
        "select count(*) from information_schema.processlist where command = 'Query' \
         and id <> connection_id() and info like '%{marker}%'"
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while monitor.first(&sql) != "1" {
        assert!(Instant::now() < deadline, "câu {marker} không thấy chạy");
        std::thread::yield_now();
    }
}

/// Marker duy nhất cho một lần chạy (để `wait_until_active` không nhầm câu của test khác).
pub fn marker(prefix: &str) -> String {
    format!("{prefix}_{}_{}", std::process::id(), next_id())
}

/// Còn thread `tid` nào trong processlist không (dùng để biết `KILL` đã chạy).
pub fn thread_exists(monitor: &Conn, tid: &str) -> bool {
    monitor.first(&format!(
        "select count(*) from information_schema.processlist where id = {tid}"
    )) == "1"
}

/// Chờ tới khi điều kiện đúng (thăm dò), tối đa `limit`; panic kèm `what` nếu hết hạn.
pub fn wait_for(limit: Duration, what: &str, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !cond() {
        assert!(Instant::now() < deadline, "hết hạn chờ: {what}");
        std::thread::yield_now();
    }
}
