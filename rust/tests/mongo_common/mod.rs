//! Helper cho test cần MongoDB thật (container `s3b-test-mongo` của `test-env/`).
//!
//! Mật khẩu KHÔNG nằm trong code: đọc lúc chạy từ biến môi trường `S3B_MONGO_PASSWORD` hoặc dòng
//! `DB_PASSWORD=` của `test-env/db/db.env`. Server không tới được (Docker chưa chạy, thiếu mật
//! khẩu) thì test in `SKIP ...` rồi kết thúc đạt, để máy không có Docker vẫn chạy được `cargo test`.
//! Không in mật khẩu ra output và không đặt `Debug` cho `Server` để không vô tình bị in.
//!
//! Server test chạy `allowTLS` (nhận cả kết nối thường lẫn TLS, không đòi chứng chỉ client).
//! Mỗi test dùng database riêng (`Conn::scratch_db`, tên có pid + số thứ tự) và xoá khi `Conn`
//! bị drop, nên các test độc lập nhau và không đụng database thật của server.
#![allow(dead_code)]

use crate::common::{
    MAX_BYTES, call, call_with_id, exec, exec_page, fetch, fetch_page, next_id, ok, skip_or_fail,
};
use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const HOST: &str = "127.0.0.1";

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
    let password = std::env::var("S3B_MONGO_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env_file_value("DB_PASSWORD"));
    let Some(password) = password else {
        skip_or_fail(&format!(
            "SKIP mongodb {test}: chưa có mật khẩu (S3B_MONGO_PASSWORD hoặc test-env/db/db.env)"
        ));
        return None;
    };
    let port = std::env::var("S3B_MONGO_PORT")
        .ok()
        .or_else(|| env_file_value("MONGO_PORT"))
        .and_then(|p| p.parse().ok())
        .unwrap_or(10034);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_err() {
        skip_or_fail(&format!(
            "SKIP mongodb {test}: không nối được {HOST}:{port} (chạy test-env/docker-compose-db.yml)"
        ));
        return None;
    }
    let user = env_file_value("MONGO_USER").unwrap_or_else(|| "root".to_owned());
    Some(Server {
        port,
        user,
        password,
    })
}

/// Sinh cho mỗi `fn name(s: &Server) { ... }` một `#[test]` bỏ qua (in `SKIP`) khi không có server.
/// Thêm `#[ignore = "..."]` ở trước `fn` để đánh dấu test chậm.
#[macro_export]
macro_rules! mongo {
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
    /// Params của `open` tới database mặc định (`admin`) với TLS `mode` (có `caFile` để mode
    /// verify chạy được).
    pub fn params(&self, mode: &str) -> Value {
        json!({
            "driver": "mongodb", "host": HOST, "port": self.port, "username": self.user,
            "password": self.password,
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
        self.conn_with(mode, json!({}))
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
            scratch: RefCell::new(Vec::new()),
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

/// Một connection đã mở; xoá các database tạm rồi đóng khi drop (bỏ qua lỗi nếu test đã tự đóng).
pub struct Conn {
    pub id: u64,
    scratch: RefCell<Vec<String>>,
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

    /// Các document (đã parse) của câu đầu tiên; câu đó phải là `rows` và không lỗi.
    pub fn docs(&self, sql: &str) -> Vec<Value> {
        docs_of(&self.exec(sql), 0)
    }

    /// Document đầu tiên của câu đầu tiên.
    pub fn doc(&self, sql: &str) -> Value {
        self.docs(sql)
            .into_iter()
            .next()
            .expect("không có document")
    }

    /// Tên database tạm duy nhất cho test; được xoá khi `Conn` bị drop (kể cả khi test panic).
    pub fn scratch_db(&self, prefix: &str) -> String {
        let name = format!("s3b_test_{prefix}_{}_{}", std::process::id(), next_id());
        self.scratch.borrow_mut().push(name.clone());
        name
    }

    /// Tạo collection `name` trong `db` với `n` document `{_id: 0..n, v: i*10, pad: ".."}`.
    pub fn seed(&self, db: &str, name: &str, n: usize, pad: usize) {
        let docs: Vec<Value> = (0..n)
            .map(|i| json!({"_id": i, "v": i * 10, "pad": "x".repeat(pad)}))
            .collect();
        let r = self.exec(&cmd(
            "insert",
            json!(name),
            json!({"documents": docs}),
            Some(db),
        ));
        let st = &ok(&r)["statements"][0];
        assert_eq!(st["rowsAffected"], n, "seed lỗi: {st}");
    }

    /// Số cursor đang mở của server cho namespace `db.coll` (cursor rảnh trong `$currentOp`).
    pub fn idle_cursors(&self, db: &str, coll: &str) -> usize {
        let pipeline = json!([
            {"$currentOp": {"allUsers": true, "idleCursors": true}},
            {"$match": {"type": "idleCursor", "ns": format!("{db}.{coll}")}}
        ]);
        self.docs(&cmd(
            "aggregate",
            json!(1),
            json!({"pipeline": pipeline, "cursor": {}}),
            Some("admin"),
        ))
        .len()
    }

    /// Số thao tác đang chạy ở server có `comment` bằng `marker` (xem `wait_until_active`).
    fn active_ops(&self, marker: &str) -> usize {
        let pipeline = json!([
            {"$currentOp": {"allUsers": true}},
            {"$match": {"$or": [{"command.comment": marker}, {"cursor.originatingCommand.comment": marker}]}}
        ]);
        self.docs(&cmd(
            "aggregate",
            json!(1),
            json!({"pipeline": pipeline, "cursor": {}}),
            Some("admin"),
        ))
        .len()
    }
}

impl Drop for Conn {
    fn drop(&mut self) {
        for db in self.scratch.borrow().iter() {
            exec(self.id, &cmd("dropDatabase", json!(1), json!({}), Some(db)));
        }
        call("close", json!({"connId": self.id}));
    }
}

/// Văn bản một lệnh: `{"<name>": <arg>, <các key của rest>, "$db": <db>}`. Key đầu tiên PHẢI là tên
/// lệnh, nên ghép chuỗi tay thay vì dựa vào thứ tự key của `serde_json::Map`.
pub fn cmd(name: &str, arg: Value, rest: Value, db: Option<&str>) -> String {
    let mut text = format!("{{{}:{arg}", Value::from(name));
    for (k, v) in rest.as_object().cloned().unwrap_or_default() {
        text.push_str(&format!(",{}:{v}", Value::from(k)));
    }
    if let Some(db) = db {
        text.push_str(&format!(",\"$db\":{}", Value::from(db)));
    }
    text.push('}');
    text
}

/// Các document (đã parse) của câu thứ `i`; câu đó phải là `rows` và không lỗi.
pub fn docs_of(r: &Value, i: usize) -> Vec<Value> {
    let st = &ok(r)["statements"][i];
    assert_eq!(st["kind"], "rows", "{st}");
    st["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| parse_cell(&row[0]))
        .collect()
}

/// Ô (chuỗi Extended JSON) thành `Value`.
pub fn parse_cell(cell: &Value) -> Value {
    serde_json::from_str(cell.as_str().expect("ô là chuỗi")).expect("ô là JSON hợp lệ")
}

/// Các `_id` số nguyên của một trang `rows` (kết quả `execute` câu `i` hoặc response `fetch`).
pub fn ids(rows: &Value) -> Vec<i64> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|row| parse_cell(&row[0])["_id"].as_i64().unwrap())
        .collect()
}

/// Đi hết cursor của câu `st` (kết quả của `execute`) bằng `fetch` trang `page`; trả danh sách
/// `_id` của từng trang (kể cả trang đầu của `st`). Response `fetch` không có `cursorId`: cursor
/// giữ nguyên id từ `execute` cho tới khi trang cuối báo `done`.
pub fn walk(c: &Conn, st: &Value, page: u64, max_bytes: u64) -> Vec<Vec<i64>> {
    let mut pages = vec![ids(&st["rows"])];
    if st["done"] == true {
        return pages;
    }
    let cursor = st["cursorId"]
        .as_u64()
        .expect("chưa done thì phải có cursor");
    for _ in 0..100_000 {
        let r = c.fetch_page(cursor, page, max_bytes);
        let r = ok(&r);
        pages.push(ids(&r["rows"]));
        if r["done"] == true {
            return pages;
        }
    }
    panic!("cursor không bao giờ hết");
}

/// Chờ tới khi điều kiện đúng (thăm dò), tối đa `limit`; panic kèm `what` nếu hết hạn.
pub fn wait_for(limit: Duration, what: &str, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !cond() {
        assert!(Instant::now() < deadline, "hết hạn chờ: {what}");
        std::thread::yield_now();
    }
}

/// Cho tới khi thao tác có `comment` = `marker` đang chạy ở server (thăm dò `$currentOp` từ
/// connection khác), tối đa 10 s. Chờ theo ĐIỀU KIỆN chứ không ngủ cố định.
pub fn wait_until_active(monitor: &Conn, marker: &str) {
    wait_for(Duration::from_secs(10), marker, || {
        monitor.active_ops(marker) > 0
    });
}

/// Không còn thao tác nào có `comment` = `marker` chạy ở server, tối đa 10 s.
pub fn wait_until_gone(monitor: &Conn, marker: &str) {
    wait_for(Duration::from_secs(10), marker, || {
        monitor.active_ops(marker) == 0
    });
}

/// Cho tới khi `db.coll` không còn cursor rảnh ở server (cursor bị bỏ đã được `killCursors`).
pub fn wait_until_no_cursors(monitor: &Conn, db: &str, coll: &str) {
    wait_for(Duration::from_secs(10), "killCursors", || {
        monitor.idle_cursors(db, coll) == 0
    });
}

/// Marker duy nhất cho một lần chạy.
pub fn marker(prefix: &str) -> String {
    format!("{prefix}_{}_{}", std::process::id(), next_id())
}
