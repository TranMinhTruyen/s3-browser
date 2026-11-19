//! N4: `open` cho driver chưa có / sai tham số, chặn method cây đối tượng trên driver không
//! phải SQLite, hợp đồng huỷ với một actor giả của driver mạng, và JSON `open` cũ của SQLite.
//!
//! Actor giả đăng ký vào registry toàn cục như một driver mạng thật sẽ làm, nên test này kiểm
//! đúng đường `ffi` -> `dispatch` -> `drivers::request` -> registry mà không cần server DB.

mod common;

use common::*;
use s3b_db::drivers::{Cmd, common::cancelled};
use s3b_db::protocol::{ExecuteResult, FetchResult, SchemaTreeResult};
use s3b_db::registry::{self, Interrupt};
use s3b_db::runtime;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc as std_mpsc};
use std::time::Duration;
use tokio::sync::{Notify, mpsc};

const NETWORK_DRIVERS: [&str; 6] = [
    "postgres",
    "mysql",
    "mariadb",
    "sqlserver",
    "mongodb",
    "redis",
];
const SECRET: &str = "S3cr3t-Pw-do-not-leak";

/// Chỉ chờ để test không treo khi có lỗi; luồng bình thường không bao giờ chạm tới.
const SAFETY: Duration = Duration::from_secs(20);

fn message(resp: &Value) -> &str {
    resp["error"]["message"].as_str().unwrap()
}

// ---- open: driver lạ / thiếu host / chưa cài ----

#[test]
fn unknown_driver_names_are_invalid_request() {
    for driver in [
        "", "oracle", "SQLITE", "Postgres", " sqlite", "sqlite ", "pg",
    ] {
        let r = call("open", json!({"driver": driver, "host": "h", "path": "x"}));
        assert_eq!(err_code(&r), "invalidRequest", "{driver:?}");
        assert_eq!(message(&r), "unknown driver", "{driver:?}");
    }
}

#[test]
fn network_drivers_without_a_host_are_invalid_request() {
    for driver in NETWORK_DRIVERS {
        for params in [
            json!({"driver": driver}),
            json!({"driver": driver, "host": null}),
            json!({"driver": driver, "host": ""}),
            json!({"driver": driver, "path": "x.db"}),
        ] {
            let r = call("open", params.clone());
            assert_eq!(err_code(&r), "invalidRequest", "{params}");
            assert_eq!(message(&r), "missing host", "{params}");
        }
    }
}

/// Đổi khi N6–N9 cài driver thật: lúc đó `open` tới host không tồn tại phải là `openFailed`,
/// còn "chưa cài" biến mất. PostgreSQL (N5) đã cài nên có test riêng bên dưới.
#[test]
fn network_drivers_with_a_host_are_not_implemented_yet() {
    for driver in NETWORK_DRIVERS.into_iter().filter(|d| *d != "postgres") {
        let r = call(
            "open",
            json!({"driver": driver, "host": "127.0.0.1", "port": 1, "username": "u"}),
        );
        assert_eq!(err_code(&r), "invalidRequest", "{driver}");
        assert_eq!(message(&r), "driver not implemented yet", "{driver}");
    }
}

/// PostgreSQL đã có driver thật: cổng 1 không có server nên `openFailed` (không còn "chưa cài"),
/// thông báo không chứa mật khẩu; thiếu host/username vẫn là `invalidRequest`.
#[test]
fn postgres_open_to_a_closed_port_is_open_failed_and_never_echoes_the_password() {
    let r = call(
        "open",
        json!({
            "driver": "postgres", "host": "127.0.0.1", "port": 1,
            "username": "u", "password": SECRET
        }),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert_ne!(message(&r), "driver not implemented yet");
    assert!(!r.to_string().contains(SECRET), "{r}");

    let r = call("open", json!({"driver": "postgres", "username": "u"}));
    assert_eq!(err_code(&r), "invalidRequest");
    let r = call("open", json!({"driver": "postgres", "host": "127.0.0.1"}));
    assert_eq!(err_code(&r), "invalidRequest");
}

#[test]
fn unknown_tls_mode_is_invalid_request_for_every_driver() {
    for driver in ["sqlite", "postgres", "mysql"] {
        let r = call(
            "open",
            json!({"driver": driver, "host": "h", "path": "x", "tls": {"mode": "yes-please"}}),
        );
        assert_eq!(err_code(&r), "invalidRequest", "{driver}");
    }
}

#[test]
fn bad_open_params_never_echo_the_password() {
    let cases = [
        json!({"driver": "postgres", "password": SECRET}),
        json!({"driver": "postgres", "host": "h", "password": SECRET}),
        json!({"driver": "postgres", "host": "h", "password": SECRET, "tls": {"mode": "bogus"}}),
        json!({"driver": "postgres", "host": "h", "password": SECRET, "port": 70000}),
        json!({"driver": "postgres", "host": "h", "password": SECRET, "port": "abc"}),
        json!({"driver": "postgres", "host": "h", "password": SECRET, "tls": {"caFile": 5}}),
        json!({"driver": "oracle", "host": "h", "password": SECRET}),
        json!({"driver": 1, "host": "h", "password": SECRET}),
        json!({"driver": "sqlite", "password": SECRET}),
    ];
    for params in cases {
        let r = call("open", params.clone());
        assert_eq!(r["ok"], false, "{params}");
        assert!(!r.to_string().contains(SECRET), "lộ mật khẩu: {r}");
    }
}

#[test]
fn bad_port_values_are_invalid_request() {
    for port in [json!(65536), json!(-1), json!("5432"), json!(1.5)] {
        let r = call(
            "open",
            json!({"driver": "postgres", "host": "h", "port": port}),
        );
        assert_eq!(err_code(&r), "invalidRequest", "{port}");
    }
}

// ---- open SQLite: JSON cũ vẫn chạy, field mạng bị bỏ qua ----

#[test]
fn old_sqlite_open_json_still_opens_and_runs() {
    let dir = TempDir::new();
    let path = dir.file("old.db");
    // File 0 byte là DB rỗng hợp lệ; `open` không tự tạo file.
    std::fs::File::create(&path).unwrap();
    let r = call("open", json!({"driver": "sqlite", "path": path}));
    let conn = ok(&r)["connId"].as_u64().unwrap();
    let r = exec(
        conn,
        "CREATE TABLE t(a); INSERT INTO t VALUES(1); SELECT a FROM t",
    );
    let st = statements(&r);
    assert_eq!(st.len(), 3);
    assert_eq!(st[2]["rows"], json!([["1"]]));
    ok(&call("close", json!({"connId": conn})));
}

#[test]
fn sqlite_open_without_path_is_invalid_request() {
    for params in [
        json!({"driver": "sqlite"}),
        json!({"driver": "sqlite", "path": null}),
    ] {
        let r = call("open", params);
        assert_eq!(err_code(&r), "invalidRequest");
        assert_eq!(message(&r), "missing path");
    }
}

#[test]
fn sqlite_open_ignores_network_and_tls_fields() {
    let dir = TempDir::new();
    let path = dir.file("tls.db");
    std::fs::File::create(&path).unwrap();
    let r = call(
        "open",
        json!({
            "driver": "sqlite", "path": path, "host": "h", "port": 5432,
            "database": "d", "username": "u", "password": SECRET,
            "tls": {"mode": "verify-full", "caFile": "does-not-exist.pem"},
        }),
    );
    let conn = ok(&r)["connId"].as_u64().unwrap();
    assert!(!r.to_string().contains(SECRET));
    ok(&call("close", json!({"connId": conn})));
}

#[test]
fn sqlite_responses_have_no_first_row_ms() {
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a); INSERT INTO t VALUES(1); SELECT a FROM t");
    for st in statements(&r) {
        assert!(st.get("firstRowMs").is_none(), "{st}");
    }
}

#[test]
fn bench_timing_fields_follow_the_feature_flag() {
    let db = Db::new();
    let r = db.exec("CREATE TABLE t(a); INSERT INTO t VALUES(1); SELECT a FROM t");
    let st = statements(&r);
    for stmt in &st[..2] {
        assert!(
            stmt.get("readMs").is_none() && stmt.get("convertMs").is_none(),
            "{stmt}"
        );
    }
    let rows = &st[2];
    if cfg!(feature = "bench-timing") {
        assert!(
            rows["readMs"].is_u64() && rows["convertMs"].is_u64(),
            "{rows}"
        );
    } else {
        assert!(
            rows.get("readMs").is_none() && rows.get("convertMs").is_none(),
            "{rows}"
        );
    }
}

// ---- actor giả của một driver mạng ----

/// `Interrupt` giả: đếm số lần bị gọi và đánh thức actor đang chờ (như `sqlite3_interrupt`
/// làm câu SQL đang chạy dừng lại).
#[derive(Default)]
struct Counting(AtomicU64, Notify);

impl Counting {
    fn calls(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

impl Interrupt for Counting {
    fn interrupt(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
        self.1.notify_one();
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Behavior {
    /// `execute` trả ngay kết quả rỗng.
    Reply,
    /// `execute` chờ tới khi cờ huỷ bật rồi trả `cancelled` (như driver mạng chờ trong `select!`).
    /// Actor tự dừng khi thấy cờ nên có thể xong trước khi `cancel` kịp gọi interrupt: số lần
    /// interrupt của kiểu này không xác định, test chỉ được kiểm mã lỗi.
    BlockUntilCancelled,
    /// `execute` chỉ dừng khi bị interrupt (như câu SQLite đang chạy): số lần interrupt xác định.
    BlockUntilInterrupted,
}

struct Stub {
    conn: u64,
    interrupts: Arc<Counting>,
    /// Id request mà actor bắt đầu chạy (đã `set_running`).
    started: std_mpsc::Receiver<u64>,
}

impl Stub {
    /// Đăng ký một connection giả với driver `driver` và chạy actor của nó trên runtime chung.
    fn new(driver: &'static str, behavior: Behavior) -> Self {
        init();
        let reg = registry::global();
        let conn = reg.next_conn_id();
        let (tx, mut rx) = mpsc::channel::<Cmd>(8);
        let interrupts = Arc::new(Counting::default());
        reg.add_conn(conn, driver, tx, interrupts.clone());
        let (started_tx, started) = std_mpsc::channel();
        let actor_interrupts = interrupts.clone();
        runtime::get().unwrap().spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    Cmd::Execute(job) => {
                        reg.set_running(conn, job.id);
                        let _ = started_tx.send(job.id);
                        let result = match behavior {
                            Behavior::BlockUntilCancelled => {
                                job.cancel.cancelled().await;
                                Err(cancelled())
                            }
                            Behavior::BlockUntilInterrupted => {
                                actor_interrupts.1.notified().await;
                                Err(cancelled())
                            }
                            Behavior::Reply => Ok(ExecuteResult { statements: vec![] }),
                        };
                        reg.set_running(conn, 0);
                        let _ = job.reply.send(result);
                    }
                    Cmd::Fetch(job) => {
                        let _ = job.reply.send(Ok(FetchResult {
                            rows: vec![],
                            done: true,
                        }));
                    }
                    Cmd::SchemaTree(job) => {
                        let _ = job.reply.send(Ok(SchemaTreeResult { schemas: vec![] }));
                    }
                    Cmd::Close(done) => {
                        let _ = done.send(());
                        break;
                    }
                    other => other.reject_cancelled(),
                }
            }
        });
        Self {
            conn,
            interrupts,
            started,
        }
    }

    fn wait_started(&self) -> u64 {
        self.started
            .recv_timeout(SAFETY)
            .expect("actor giả không bắt đầu chạy")
    }

    fn execute(&self, id: u64) -> Value {
        call_with_id(
            id,
            "execute",
            json!({"connId": self.conn, "sql": "SELECT 1", "pageSize": 10, "maxPageBytes": 1024}),
        )
    }

    fn close(&self) -> Value {
        call("close", json!({"connId": self.conn}))
    }
}

fn table_params(conn: u64) -> Value {
    json!({"connId": conn, "schema": "public", "table": "t", "pageSize": 10, "maxPageBytes": 1024})
}

#[test]
fn schema_methods_are_rejected_on_non_sqlite_drivers_without_reaching_the_actor() {
    for driver in NETWORK_DRIVERS {
        let stub = Stub::new(driver, Behavior::Reply);
        for (method, params) in [
            ("schemaTree", json!({"connId": stub.conn})),
            (
                "tableInfo",
                json!({"connId": stub.conn, "schema": "public", "table": "t"}),
            ),
            ("tableRows", table_params(stub.conn)),
        ] {
            let r = call(method, params);
            assert_eq!(err_code(&r), "invalidRequest", "{driver} {method}");
            assert_eq!(
                message(&r),
                "method not supported by driver",
                "{driver} {method}"
            );
        }
        ok(&stub.close());
    }
}

#[test]
fn schema_methods_reach_the_actor_only_for_the_sqlite_driver() {
    let stub = Stub::new("sqlite", Behavior::Reply);
    let r = call("schemaTree", json!({"connId": stub.conn}));
    assert_eq!(ok(&r)["schemas"], json!([]));
    // Stub từ chối TableInfo/TableRows bằng `cancelled`: chứng tỏ lệnh đã tới actor.
    let r = call(
        "tableInfo",
        json!({"connId": stub.conn, "schema": "main", "table": "t"}),
    );
    assert_eq!(err_code(&r), "cancelled");
    let r = call("tableRows", table_params(stub.conn));
    assert_eq!(err_code(&r), "cancelled");
    ok(&stub.close());
}

#[test]
fn execute_and_fetch_are_allowed_on_non_sqlite_drivers() {
    let stub = Stub::new("postgres", Behavior::Reply);
    let r = stub.execute(next_id());
    assert_eq!(ok(&r)["statements"], json!([]));
    let r = call(
        "fetch",
        json!({"connId": stub.conn, "cursorId": 1, "pageSize": 10, "maxPageBytes": 1024}),
    );
    assert_eq!(ok(&r), &json!({"rows": [], "done": true}));
    ok(&stub.close());
}

#[test]
fn schema_methods_on_unknown_connection_are_conn_not_found() {
    let r = call("schemaTree", json!({"connId": u64::MAX}));
    assert_eq!(err_code(&r), "connNotFound");
    let r = call(
        "tableInfo",
        json!({"connId": u64::MAX, "schema": "s", "table": "t"}),
    );
    assert_eq!(err_code(&r), "connNotFound");
}

// ---- hợp đồng huỷ qua FFI với driver mạng giả ----

#[test]
fn cancel_of_a_running_request_returns_cancelled_and_interrupts_once() {
    let stub = Stub::new("postgres", Behavior::BlockUntilInterrupted);
    let id = next_id();
    let caller = std::thread::spawn({
        let conn = stub.conn;
        move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": "SELECT pg_sleep(60)", "pageSize": 10, "maxPageBytes": 1024}),
            )
        }
    });
    assert_eq!(stub.wait_started(), id);

    cancel(id);

    let r = caller.join().unwrap();
    assert_eq!(err_code(&r), "cancelled");
    assert_eq!(stub.interrupts.calls(), 1);
    ok(&stub.close());
}

#[test]
fn cancel_flag_alone_wakes_a_driver_future_waiting_on_it() {
    let stub = Stub::new("postgres", Behavior::BlockUntilCancelled);
    let id = next_id();
    let caller = std::thread::spawn({
        let conn = stub.conn;
        move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": "SELECT 1", "pageSize": 10, "maxPageBytes": 1024}),
            )
        }
    });
    assert_eq!(stub.wait_started(), id);

    cancel(id);

    // Số lần interrupt không xác định ở kiểu này (xem `Behavior::BlockUntilCancelled`).
    assert_eq!(err_code(&caller.join().unwrap()), "cancelled");
    ok(&stub.close());
}

#[test]
fn cancel_after_the_request_finished_does_not_interrupt() {
    let stub = Stub::new("postgres", Behavior::Reply);
    let id = next_id();
    ok(&stub.execute(id));
    assert_eq!(stub.wait_started(), id);

    cancel(id);
    cancel(id);

    assert_eq!(stub.interrupts.calls(), 0);
    ok(&stub.close());
}

#[test]
fn cancel_does_not_touch_another_connection() {
    let a = Stub::new("postgres", Behavior::BlockUntilInterrupted);
    let b = Stub::new("postgres", Behavior::Reply);
    let id = next_id();
    let caller = std::thread::spawn({
        let conn = a.conn;
        move || {
            call_with_id(
                id,
                "execute",
                json!({"connId": conn, "sql": "SELECT 1", "pageSize": 10, "maxPageBytes": 1024}),
            )
        }
    });
    assert_eq!(a.wait_started(), id);

    cancel(id);

    assert_eq!(err_code(&caller.join().unwrap()), "cancelled");
    assert_eq!((a.interrupts.calls(), b.interrupts.calls()), (1, 0));
    // Connection kia không bị ảnh hưởng.
    ok(&b.execute(next_id()));
    ok(&a.close());
    ok(&b.close());
}

#[test]
fn close_interrupts_removes_the_connection_and_later_requests_fail() {
    let stub = Stub::new("postgres", Behavior::Reply);
    ok(&stub.close());
    assert_eq!(stub.interrupts.calls(), 1);
    assert_eq!(err_code(&stub.execute(next_id())), "connNotFound");
    // Đóng lần hai vô hại và không ngắt thêm.
    ok(&stub.close());
    assert_eq!(stub.interrupts.calls(), 1);
}
