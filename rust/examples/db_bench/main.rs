//! Bench hiệu năng đường đọc dòng của 7 driver (SQLite làm mốc + 6 DB trong Docker) và ghi báo
//! cáo Excel. Chạy bằng `test-env/db-bench.ps1` (hoặc `cargo run --release --example db_bench
//! --features bench-timing -- --help`).
//!
//! Bench gọi đúng đường của app: `s3b_init` rồi `s3b_call` (JSON) như Go, nên số đo gồm cả
//! parse request, driver và ghi JSON response. Mỗi (DB, n): tạo bảng/collection/list tiền tố
//! `s3b_bench_`, nạp n dòng bằng chính `s3b_call`, đọc cả n dòng trong MỘT trang (`pageSize = n`,
//! không giới hạn byte), 3 lần khởi động + 15 lần đo, rồi dọn dữ liệu. DB không tới được thì ghi
//! "SKIP" và bench vẫn ra file. Không TLS để số đo so được giữa các DB.
//!
//! Mật khẩu chỉ đọc lúc chạy từ `test-env/db/db.env` (hoặc biến môi trường `S3B_DB_PASSWORD`),
//! không có trong code và không ghi vào báo cáo.
//!
//! Khái niệm Rust: `unsafe` ở đây chỉ bao quanh lời gọi hàm C ABI `s3b_call`/`s3b_free` (cùng cách
//! Go gọi qua DLL); mỗi chỗ có `// SAFETY:` nói vì sao đúng.

mod data;
mod report;

use data::{Kind, REDIS_DB, Row, RowGen, table_name};
use report::{Entry, Outcome, Run};
use s3b_db::ffi::{s3b_call, s3b_free, s3b_init};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{fs, ptr, slice};

const USAGE: &str = "db_bench - đo đường đọc dòng của driver Rust, ghi báo cáo .xlsx

Tuỳ chọn (đều không bắt buộc):
  --db <list>         sqlite,postgres,mysql,mariadb,sqlserver,mongodb,redis (mặc định: tất cả)
  --rows <list>       số dòng, cách nhau dấu phẩy (mặc định 1000,10000,100000)
  --runs <n>          số lần đo (mặc định 15)
  --warmup <n>        số lần khởi động (mặc định 3)
  --out <dir>         thư mục ghi báo cáo (mặc định test-env/db/report)
  --timestamp <s>     YYYYMMDD_HHMMSS cho tên file (mặc định: giờ UTC hiện tại)
  --cpu <s> --ram <s> --os <s>   thông tin máy cho sheet Env (script truyền vào)";

/// Không giới hạn byte của trang (Q29 = A).
const MAX_PAGE_BYTES: u64 = 1 << 32;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct Args {
    dbs: Vec<Kind>,
    rows: Vec<usize>,
    runs: usize,
    warmup: usize,
    out: PathBuf,
    timestamp: Option<String>,
    cpu: Option<String>,
    ram: Option<String>,
    os: Option<String>,
}

/// Gốc repo (`rust/..`), lấy lúc build từ vị trí `Cargo.toml`.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args {
        dbs: Kind::ALL.to_vec(),
        rows: vec![1_000, 10_000, 100_000],
        runs: 15,
        warmup: 3,
        out: repo_root().join("test-env").join("db").join("report"),
        timestamp: None,
        cpu: None,
        ram: None,
        os: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        if flag == "--help" || flag == "-h" {
            return Err(USAGE.to_owned());
        }
        let val = it
            .next()
            .ok_or(format!("thiếu giá trị cho {flag}\n{USAGE}"))?;
        match flag.as_str() {
            "--db" => {
                a.dbs = val
                    .split(',')
                    .map(|s| Kind::parse(s.trim()).ok_or(format!("DB không hợp lệ: {s}")))
                    .collect::<Result<_, _>>()?;
            }
            "--rows" => {
                a.rows = val
                    .split(',')
                    .map(|s| {
                        s.trim()
                            .parse()
                            .map_err(|_| format!("số dòng không hợp lệ: {s}"))
                    })
                    .collect::<Result<_, _>>()?;
            }
            "--runs" => a.runs = val.parse().map_err(|_| "--runs phải là số".to_owned())?,
            "--warmup" => a.warmup = val.parse().map_err(|_| "--warmup phải là số".to_owned())?,
            "--out" => a.out = PathBuf::from(val),
            "--timestamp" => a.timestamp = Some(val),
            "--cpu" => a.cpu = Some(val),
            "--ram" => a.ram = Some(val),
            "--os" => a.os = Some(val),
            _ => return Err(format!("tuỳ chọn lạ: {flag}\n{USAGE}")),
        }
    }
    if a.runs == 0 || a.rows.contains(&0) {
        return Err("--runs và --rows phải lớn hơn 0".to_owned());
    }
    Ok(a)
}

// ---- cấu hình DB (test-env/db/db.env) ----

/// Các cặp `KEY=value` của `test-env/db/db.env` (rỗng nếu không có file).
fn load_env_file() -> HashMap<String, String> {
    let path = repo_root().join("test-env").join("db").join("db.env");
    let text = fs::read_to_string(path).unwrap_or_default();
    text.lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect()
}

/// Địa chỉ + tài khoản của một DB mạng. Không `derive(Debug)` vì có mật khẩu.
struct Server {
    host: String,
    port: u16,
    user: Option<String>,
    password: String,
}

/// Thông tin nối tới `kind`, hoặc lý do bỏ qua (chưa có mật khẩu, cổng không mở).
fn server_for(kind: Kind, env: &HashMap<String, String>) -> Result<Server, String> {
    let (port_key, user_key, default_port) = kind.env_keys().ok_or("không phải DB mạng")?;
    let password = std::env::var("S3B_DB_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| env.get("DB_PASSWORD").filter(|v| !v.is_empty()).cloned())
        .ok_or("chưa có mật khẩu (test-env/db/db.env)")?;
    let host = env
        .get("DB_HOST")
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_owned());
    let port = env
        .get(port_key)
        .and_then(|p| p.parse().ok())
        .unwrap_or(default_port);
    let reachable = (host.as_str(), port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_ok());
    if !reachable {
        return Err("DB không chạy hoặc cổng không mở (docker compose up)".to_owned());
    }
    Ok(Server {
        host,
        port,
        user: user_key.and_then(|k| env.get(k).cloned()),
        password,
    })
}

/// Params của `open` (không TLS).
fn open_params(kind: Kind, srv: Option<&Server>, sqlite_path: &str) -> Value {
    let Some(s) = srv else {
        return json!({"driver": "sqlite", "path": sqlite_path, "readOnly": false});
    };
    let mut p = json!({
        "driver": kind.name(), "host": s.host, "port": s.port, "password": s.password,
        "tls": {"mode": "disable"},
    });
    if let Some(user) = &s.user {
        p["username"] = json!(user);
    }
    match kind {
        Kind::Postgres | Kind::MySql | Kind::MariaDb => p["database"] = json!("s3b"),
        Kind::SqlServer => p["database"] = json!("master"),
        Kind::Redis => p["database"] = json!(REDIS_DB),
        Kind::Sqlite | Kind::Mongo => {}
    }
    p
}

// ---- gọi FFI ----

/// Kết quả một lần `s3b_call`: `result` của response, thời gian gọi (ms) và số byte response.
struct Reply {
    result: Value,
    wall_ms: f64,
    bytes: usize,
}

/// Gọi `s3b_call` như Go. Chỉ đo đúng lời gọi (không tính dựng request và parse response).
/// Lỗi nghiệp vụ trả `Err("<code>: <message>")`.
fn call(method: &str, params: Value) -> Result<Reply, String> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let req = json!({"id": id, "method": method, "params": params}).to_string();
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    let t = Instant::now();
    // SAFETY: `req` đọc được `req.len()` byte suốt lời gọi; `out` và `len` là ô ghi được.
    let rc = unsafe { s3b_call(req.as_ptr(), req.len(), &mut out, &mut len) };
    let wall_ms = t.elapsed().as_secs_f64() * 1000.0;
    if rc != 0 || out.is_null() {
        return Err(format!("s3b_call trả mã {rc}"));
    }
    // SAFETY: (out, len) vừa do `s3b_call` cấp và chưa giải phóng; parse xong mới `s3b_free`.
    let parsed = serde_json::from_slice::<Value>(unsafe { slice::from_raw_parts(out, len) });
    // SAFETY: đúng cặp con trỏ/độ dài của `s3b_call`, giải phóng đúng một lần.
    unsafe { s3b_free(out, len) };
    let mut v = parsed.map_err(|e| format!("response không phải JSON: {e}"))?;
    if v["ok"] != true {
        let code = v["error"]["code"].as_str().unwrap_or("?");
        let msg = v["error"]["message"].as_str().unwrap_or("");
        return Err(format!("{code}: {}", short(msg)));
    }
    Ok(Reply {
        result: v["result"].take(),
        wall_ms,
        bytes: len,
    })
}

/// Cắt message lỗi cho gọn (không ghi lại cả câu SQL/lệnh dài).
fn short(s: &str) -> String {
    s.chars().take(160).collect()
}

/// Chạy một lệnh, trả statement đầu tiên; lỗi của riêng câu (`error`) cũng thành `Err`.
fn exec_page(conn: u64, sql: &str, page: usize, max_bytes: u64) -> Result<Reply, String> {
    let r = call(
        "execute",
        json!({"connId": conn, "sql": sql, "pageSize": page, "maxPageBytes": max_bytes}),
    )?;
    let st = &r.result["statements"][0];
    if let Some(code) = st["error"]["code"].as_str() {
        let msg = st["error"]["message"].as_str().unwrap_or("");
        return Err(format!("{code}: {}", short(msg)));
    }
    Ok(r)
}

fn exec(conn: u64, sql: &str) -> Result<Reply, String> {
    exec_page(conn, sql, 500, 16 * 1024 * 1024)
}

// ---- nạp, đo, dọn ----

/// Các lô `BATCH` dòng đầu tiên của bộ dữ liệu, tổng `n` dòng.
fn batches(n: usize) -> impl Iterator<Item = Vec<Row>> {
    let mut gen_rows = RowGen::new().take(n);
    std::iter::from_fn(move || {
        let b: Vec<Row> = gen_rows.by_ref().take(data::BATCH).collect();
        (!b.is_empty()).then_some(b)
    })
}

/// Tạo bảng/collection/list và nạp `n` dòng.
fn load(kind: Kind, conn: u64, n: usize) -> Result<(), String> {
    let table = table_name(n);
    // Dọn dữ liệu còn sót của lần chạy hỏng trước (lỗi "không tồn tại" bỏ qua).
    let _ = cleanup(kind, conn, n);
    if !matches!(kind, Kind::Mongo | Kind::Redis) {
        exec(conn, &data::create_table(kind, &table))?;
    }
    for rows in batches(n) {
        let cmd = match kind {
            Kind::Mongo => data::mongo_insert(&table, &rows),
            Kind::Redis => data::redis_rpush(&table, &rows),
            _ => data::insert_sql(kind, &table, &rows),
        };
        let r = exec(conn, &cmd)?;
        let affected = r.result["statements"][0]["rowsAffected"].as_u64();
        // Redis RPUSH trả độ dài list (một dòng kết quả) nên chỉ kiểm SQL và Mongo.
        if kind != Kind::Redis && affected != Some(rows.len() as u64) {
            return Err(format!("nạp thiếu dòng: {affected:?} / {}", rows.len()));
        }
    }
    Ok(())
}

/// Xoá dữ liệu bench của bộ `n` dòng.
fn cleanup(kind: Kind, conn: u64, n: usize) -> Result<(), String> {
    let table = table_name(n);
    let sql = match kind {
        Kind::Mongo => data::mongo_drop_db(),
        Kind::Redis => format!("DEL {table}"),
        _ => data::drop_table(&table),
    };
    exec(conn, &sql).map(|_| ())
}

/// Câu đo: đọc cả bộ `n` dòng.
fn query(kind: Kind, n: usize) -> String {
    let table = table_name(n);
    match kind {
        Kind::Mongo => data::mongo_find(&table),
        Kind::Redis => data::redis_lrange(&table),
        _ => data::select_sql(&table),
    }
}

/// Một lần đo: đọc cả `n` dòng trong một trang.
fn measure(conn: u64, sql: &str, n: usize) -> Result<Run, String> {
    let r = exec_page(conn, sql, n, MAX_PAGE_BYTES)?;
    let st = &r.result["statements"][0];
    let rows = st["rows"].as_array().map_or(0, Vec::len);
    if rows != n {
        return Err(format!("trang có {rows} dòng, cần {n}"));
    }
    let run = Run {
        elapsed_ms: st["elapsedMs"].as_u64().ok_or("thiếu elapsedMs")?,
        first_row_ms: st["firstRowMs"].as_u64(),
        read_ms: st["readMs"].as_u64(),
        convert_ms: st["convertMs"].as_u64(),
        call_ms: r.wall_ms,
        json_bytes: r.bytes,
        rows,
    };
    // Cursor còn mở thì đọc nốt (không tính giờ) để lần đo sau không phải bỏ cursor cũ.
    if let Some(cursor) = st["cursorId"].as_u64() {
        let _ = call(
            "fetch",
            json!({"connId": conn, "cursorId": cursor, "pageSize": 1, "maxPageBytes": MAX_PAGE_BYTES}),
        );
    }
    Ok(run)
}

/// Nạp, khởi động, đo và dọn một bộ `n` dòng.
fn bench_size(kind: Kind, conn: u64, n: usize, args: &Args) -> Outcome {
    let result = load(kind, conn, n).and_then(|()| {
        let sql = query(kind, n);
        for _ in 0..args.warmup {
            measure(conn, &sql, n)?;
        }
        (0..args.runs).map(|_| measure(conn, &sql, n)).collect()
    });
    // Dọn kể cả khi lỗi giữa chừng (lỗi dọn không làm hỏng số đo đã có).
    let _ = cleanup(kind, conn, n);
    match result {
        Ok(runs) => Outcome::Measured(runs),
        Err(e) => Outcome::Failed(e),
    }
}

/// File SQLite tạm, xoá khi hết phạm vi (kể cả khi bench lỗi).
struct TempDb(PathBuf);

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Lấy chuỗi phiên bản server từ ô kết quả của `version_sql`.
fn parse_version(kind: Kind, cell: &str) -> String {
    let version = match kind {
        Kind::Mongo => serde_json::from_str::<Value>(cell)
            .ok()
            .and_then(|v| v["version"].as_str().map(str::to_owned))
            .unwrap_or_default(),
        Kind::Redis => cell
            .lines()
            .find_map(|l| l.strip_prefix("redis_version:"))
            .unwrap_or_default()
            .trim()
            .to_owned(),
        // `version()` của PostgreSQL dài ("PostgreSQL 17.12 (Debian ...) on x86_64-pc-linux-gnu,
        // compiled by gcc ..."): bỏ phần từ " on ". `@@VERSION` của SQL Server nhiều dòng: giữ dòng đầu.
        _ => cell
            .lines()
            .next()
            .and_then(|l| l.split(" on ").next())
            .unwrap_or_default()
            .trim()
            .to_owned(),
    };
    version.chars().take(90).collect()
}

/// Đo một DB cho mọi `n`, trả một `Entry` mỗi `n`. Không bao giờ panic vì DB hỏng: lỗi thành
/// `Skip`/`Failed`.
fn bench_db(kind: Kind, args: &Args, env: &HashMap<String, String>) -> Vec<Entry> {
    let all = |outcome: fn(String) -> Outcome, why: String| -> Vec<Entry> {
        args.rows
            .iter()
            .map(|&n| Entry {
                db: kind.name(),
                version: String::new(),
                n,
                outcome: outcome(why.clone()),
            })
            .collect()
    };
    let (srv, temp) = if kind == Kind::Sqlite {
        let path = std::env::temp_dir().join(format!("s3b_db_bench_{}.db", std::process::id()));
        if fs::File::create(&path).is_err() {
            return all(Outcome::Skip, "không tạo được file SQLite tạm".to_owned());
        }
        (None, Some(TempDb(path)))
    } else {
        match server_for(kind, env) {
            Ok(s) => (Some(s), None),
            Err(why) => return all(Outcome::Skip, why),
        }
    };
    let path = temp
        .as_ref()
        .map_or(String::new(), |t| t.0.to_string_lossy().into_owned());
    let conn = match call("open", open_params(kind, srv.as_ref(), &path)) {
        Ok(r) => r.result["connId"].as_u64().unwrap_or(0),
        // Chỉ ghi mã lỗi, không ghi message (có thể chứa địa chỉ server).
        Err(e) => {
            let code = e.split(':').next().unwrap_or("?").to_owned();
            return all(Outcome::Skip, format!("mở kết nối lỗi ({code})"));
        }
    };
    let version = exec(conn, data::version_sql(kind))
        .ok()
        .and_then(|r| {
            let cell = r.result["statements"][0]["rows"][0][0].as_str()?.to_owned();
            Some(parse_version(kind, &cell))
        })
        .unwrap_or_default();

    let mut entries = Vec::new();
    for &n in &args.rows {
        eprintln!(
            "[{}] n = {n}: nạp, khởi động {} lần, đo {} lần...",
            kind.name(),
            args.warmup,
            args.runs
        );
        let outcome = bench_size(kind, conn, n, args);
        entries.push(Entry {
            db: kind.name(),
            version: version.clone(),
            n,
            outcome,
        });
    }
    let _ = call("close", json!({"connId": conn}));
    entries
}

// ---- thông tin môi trường ----

/// Chạy lệnh nhỏ và lấy stdout đã cắt khoảng trắng; `None` nếu không chạy được.
fn run_text(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program)
        .args(args)
        .current_dir(repo_root())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

/// Phiên bản (mọi bản, nếu crate xuất hiện nhiều lần) của crate `name` trong `Cargo.lock`.
fn lock_versions(lock: &str, name: &str) -> String {
    let header = format!("name = \"{name}\"");
    let mut lines = lock.lines();
    let mut found = Vec::new();
    while let Some(l) = lines.next() {
        if l == header
            && let Some(v) = lines.next().and_then(|v| v.strip_prefix("version = \""))
        {
            found.push(v.trim_end_matches('"').to_owned());
        }
    }
    found.join(", ")
}

/// Cặp (tên container, image) trong `test-env/docker-compose.yml` (dòng `image:` đứng trước `container_name:`).
fn compose_images(text: &str) -> Vec<(String, String)> {
    let mut image = None;
    let mut out = Vec::new();
    for l in text.lines().map(str::trim) {
        if let Some(i) = l.strip_prefix("image:") {
            image = Some(i.trim().to_owned());
        } else if let (Some(c), Some(i)) = (l.strip_prefix("container_name:"), image.take()) {
            out.push((c.trim().to_owned(), i));
        }
    }
    out
}

/// `YYYYMMDD_HHMMSS` -> `YYYY-MM-DD HH:MM:SS`.
fn pretty_stamp(s: &str) -> String {
    match (
        s.get(0..4),
        s.get(4..6),
        s.get(6..8),
        s.get(9..11),
        s.get(11..13),
        s.get(13..15),
    ) {
        (Some(y), Some(m), Some(d), Some(h), Some(mi), Some(se)) if s.len() == 15 => {
            format!("{y}-{m}-{d} {h}:{mi}:{se}")
        }
        _ => s.to_owned(),
    }
}

fn env_info(
    args: &Args,
    entries: &[Entry],
    stamp: &str,
    dll_bytes: Option<u64>,
) -> Vec<(String, String)> {
    let unknown = || "không rõ".to_owned();
    let mut v: Vec<(String, String)> = Vec::new();
    let mut add = |k: &str, val: String| v.push((k.to_owned(), val));
    add("Ngày giờ", pretty_stamp(stamp));
    add(
        "Hệ điều hành",
        args.os.clone().unwrap_or_else(|| {
            std::env::var("OS").unwrap_or_else(|_| std::env::consts::OS.to_owned())
        }),
    );
    add(
        "CPU",
        args.cpu
            .clone()
            .unwrap_or_else(|| std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| unknown())),
    );
    add("RAM", args.ram.clone().unwrap_or_else(unknown));
    add(
        "rustc",
        run_text("rustc", &["--version"]).unwrap_or_else(unknown),
    );
    let commit = run_text("git", &["rev-parse", "--short", "HEAD"]).unwrap_or_else(unknown);
    let dirty = run_text("git", &["status", "--porcelain", "--untracked-files=no"])
        .is_some_and(|s| !s.is_empty());
    add(
        "Commit git",
        if dirty {
            format!("{commit} (có thay đổi chưa commit)")
        } else {
            commit
        },
    );
    add(
        "Build",
        if cfg!(debug_assertions) {
            "DEBUG (số đo không có giá trị)".to_owned()
        } else {
            "release".to_owned()
        },
    );
    add(
        "Feature bench-timing",
        if cfg!(feature = "bench-timing") {
            "bật".to_owned()
        } else {
            "tắt (không có readMs/convertMs)".to_owned()
        },
    );
    add(
        "Lần khởi động / lần đo",
        format!("{} / {}", args.warmup, args.runs),
    );
    add("Cách đo", "pageSize = n, maxPageBytes không giới hạn, không TLS, một connection cho mỗi DB; số dòng n = ".to_owned()
        + &args.rows.iter().map(usize::to_string).collect::<Vec<_>>().join(", "));
    add(
        "s3b_db.dll release (byte)",
        dll_bytes.map_or_else(unknown, |b| b.to_string()),
    );

    let lock = fs::read_to_string(repo_root().join("rust").join("Cargo.lock")).unwrap_or_default();
    for name in [
        "libsqlite3-sys",
        "tokio-postgres",
        "postgres-protocol",
        "mysql_async",
        "tiberius",
        "mongodb",
        "redis",
        "rustls",
        "tokio",
    ] {
        add(&format!("Crate {name}"), lock_versions(&lock, name));
    }
    let compose = fs::read_to_string(repo_root().join("test-env").join("docker-compose.yml"))
        .unwrap_or_default();
    let images = compose_images(&compose);
    for kind in Kind::ALL {
        let version = entries
            .iter()
            .find(|e| e.db == kind.name())
            .map(|e| e.version.as_str())
            .unwrap_or("");
        let image = kind
            .container()
            .and_then(|c| images.iter().find(|(name, _)| name == c))
            .map(|(_, i)| format!(", image {i}"))
            .unwrap_or_default();
        add(
            &format!("Phiên bản {}", kind.name()),
            format!(
                "{}{image}",
                if version.is_empty() {
                    "không lấy được"
                } else {
                    version
                }
            ),
        );
    }
    add("Ghi chú", "Docker Desktop (WSL2): sàn mạng ~24 ms cho 2,5 MB; mục tiêu 40 ms công bằng chỉ cho DB cài trực tiếp trên host".to_owned());
    v
}

/// In bảng tóm tắt (trung vị mỗi pha) ra stdout để xem nhanh không cần mở Excel.
fn print_summary(entries: &[Entry]) {
    let cell = |v: Option<f64>| v.map_or("-".to_owned(), |v| format!("{v:.1}"));
    println!(
        "{:<10} {:>8} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}",
        "db", "n", "elapsed", "firstRow", "read", "convert", "json", "call"
    );
    for r in report::summarize(entries) {
        if r.elapsed.is_none() {
            println!("{:<10} {:>8} {}", r.db, r.n, r.status);
            continue;
        }
        println!(
            "{:<10} {:>8} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}",
            r.db,
            r.n,
            cell(r.elapsed.map(|s| s.median)),
            cell(r.first_row),
            cell(r.read),
            cell(r.convert),
            cell(r.json),
            cell(r.call.map(|s| s.median)),
        );
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    if cfg!(debug_assertions) {
        eprintln!("CẢNH BÁO: build DEBUG, số đo không có giá trị. Dùng `cargo run --release`.");
    }
    if s3b_init() != 0 {
        return Err("s3b_init lỗi".to_owned());
    }
    let env = load_env_file();
    let mut entries = Vec::new();
    for &kind in &args.dbs {
        entries.extend(bench_db(kind, &args, &env));
    }

    let stamp = args.timestamp.clone().unwrap_or_else(|| {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        report::utc_stamp(secs)
    });
    // Exe nằm ở target/<triple>/release/examples/, DLL ở thư mục release/ bên trên.
    let dll_bytes = std::env::current_exe()
        .ok()
        .and_then(|exe| fs::metadata(exe.parent()?.parent()?.join("s3b_db.dll")).ok())
        .map(|m| m.len());
    fs::create_dir_all(&args.out).map_err(|e| format!("không tạo được thư mục báo cáo: {e}"))?;
    let path = args.out.join(format!("db_bench_{stamp}.xlsx"));
    let env_rows = env_info(&args, &entries, &stamp, dll_bytes);
    report::write_xlsx(&path, &entries, &env_rows, dll_bytes)
        .map_err(|e| format!("ghi .xlsx lỗi: {e}"))?;

    print_summary(&entries);
    // `canonicalize` của Windows trả đường dẫn có tiền tố `\\?\`; bỏ đi cho dễ đọc.
    let shown = fs::canonicalize(&path).unwrap_or(path);
    let shown = shown.display().to_string();
    println!("REPORT: {}", shown.strip_prefix(r"\\?\").unwrap_or(&shown));
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::Once;

    fn init() {
        static INIT: Once = Once::new();
        INIT.call_once(|| assert_eq!(s3b_init(), 0));
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn args(dbs: Vec<Kind>, rows: Vec<usize>) -> Args {
        Args {
            dbs,
            rows,
            runs: 2,
            warmup: 1,
            out: PathBuf::new(),
            timestamp: None,
            cpu: None,
            ram: None,
            os: None,
        }
    }

    // ---- pretty_stamp / short ----

    #[test]
    fn pretty_stamp_reformats_a_compact_timestamp() {
        assert_eq!(pretty_stamp("20261120_153045"), "2026-11-20 15:30:45");
    }

    #[test]
    fn pretty_stamp_returns_other_input_unchanged() {
        for s in [
            "",
            "abc",
            "20261120_1530",
            "20261120_1530456",
            "2026-11-20 15:30:45",
        ] {
            assert_eq!(pretty_stamp(s), s);
        }
    }

    #[test]
    fn short_cuts_to_160_characters_not_bytes() {
        assert_eq!(short("ngắn"), "ngắn");
        assert_eq!(short(""), "");
        assert_eq!(short(&"a".repeat(500)).len(), 160);
        let long = "việt".repeat(100);
        assert_eq!(short(&long).chars().count(), 160);
    }

    // ---- parse_version ----

    #[test]
    fn parse_version_for_postgres_drops_the_platform_suffix() {
        let cell = "PostgreSQL 17.12 (Debian 17.12-1) on x86_64-pc-linux-gnu, compiled by gcc";
        assert_eq!(
            parse_version(Kind::Postgres, cell),
            "PostgreSQL 17.12 (Debian 17.12-1)"
        );
    }

    #[test]
    fn parse_version_for_sql_server_keeps_the_first_line() {
        let cell = "Microsoft SQL Server 2022 (RTM-CU28) - 16.0\n\tOct 1 2026\n\tCopyright";
        assert_eq!(
            parse_version(Kind::SqlServer, cell),
            "Microsoft SQL Server 2022 (RTM-CU28) - 16.0"
        );
    }

    #[test]
    fn parse_version_for_plain_servers_trims_the_cell() {
        assert_eq!(parse_version(Kind::MySql, " 8.4.13 \n"), "8.4.13");
        assert_eq!(parse_version(Kind::Sqlite, "3.51.0"), "3.51.0");
        assert_eq!(parse_version(Kind::MariaDb, ""), "");
    }

    #[test]
    fn parse_version_for_mongo_reads_the_version_field() {
        assert_eq!(
            parse_version(Kind::Mongo, r#"{"version":"8.0.38","ok":1}"#),
            "8.0.38"
        );
        assert_eq!(parse_version(Kind::Mongo, "không phải json"), "");
        assert_eq!(parse_version(Kind::Mongo, r#"{"version":8}"#), "");
    }

    #[test]
    fn parse_version_for_redis_reads_the_info_line() {
        let cell = "# Server\r\nredis_version:7.4.12\r\nredis_mode:standalone\r\n";
        assert_eq!(parse_version(Kind::Redis, cell), "7.4.12");
        assert_eq!(parse_version(Kind::Redis, "# Server\r\n"), "");
    }

    #[test]
    fn parse_version_is_capped_at_90_characters() {
        let long = "x".repeat(300);
        for k in [Kind::MySql, Kind::Redis] {
            let cell = if k == Kind::Redis {
                format!("redis_version:{long}")
            } else {
                long.clone()
            };
            assert_eq!(parse_version(k, &cell).chars().count(), 90, "{k:?}");
        }
    }

    // ---- lock_versions / compose_images ----

    #[test]
    fn lock_versions_lists_every_version_of_a_crate() {
        let lock = "[[package]]\nname = \"rustls\"\nversion = \"0.22.4\"\n\n\
                    [[package]]\nname = \"rustls\"\nversion = \"0.23.1\"\n\n\
                    [[package]]\nname = \"rustls-pki-types\"\nversion = \"1.0.0\"\n";
        assert_eq!(lock_versions(lock, "rustls"), "0.22.4, 0.23.1");
        assert_eq!(lock_versions(lock, "rustls-pki-types"), "1.0.0");
        assert_eq!(lock_versions(lock, "tokio"), "");
        assert_eq!(lock_versions("", "tokio"), "");
    }

    #[test]
    fn lock_versions_ignores_a_name_line_at_the_very_end() {
        assert_eq!(lock_versions("name = \"tokio\"", "tokio"), "");
    }

    #[test]
    fn compose_images_pairs_each_image_with_the_following_container_name() {
        let text = "services:\n  a:\n    image: mysql:8.4.13\n    container_name: s3b-test-mysql\n\
                    \n  b:\n    container_name: orphan\n  c:\n    image: redis:7.4.12\n\
                    \x20   container_name: s3b-test-redis\n";
        assert_eq!(
            compose_images(text),
            [
                ("s3b-test-mysql".to_owned(), "mysql:8.4.13".to_owned()),
                ("s3b-test-redis".to_owned(), "redis:7.4.12".to_owned()),
            ]
        );
        assert!(compose_images("").is_empty());
    }

    // ---- open_params ----

    fn server(user: Option<&str>) -> Server {
        Server {
            host: "127.0.0.1".to_owned(),
            port: 10032,
            user: user.map(str::to_owned),
            password: "pw".to_owned(),
        }
    }

    #[test]
    fn open_params_for_sqlite_use_the_file_path_only() {
        let p = open_params(Kind::Sqlite, None, "C:/tmp/x.db");
        assert_eq!(
            p,
            json!({"driver": "sqlite", "path": "C:/tmp/x.db", "readOnly": false})
        );
    }

    #[test]
    fn open_params_for_network_dbs_disable_tls_and_pick_the_database() {
        let s = server(Some("root"));
        for (kind, db) in [
            (Kind::Postgres, Some("s3b")),
            (Kind::MySql, Some("s3b")),
            (Kind::MariaDb, Some("s3b")),
            (Kind::SqlServer, Some("master")),
            (Kind::Redis, Some("10")),
            (Kind::Mongo, None),
        ] {
            let p = open_params(kind, Some(&s), "");
            assert_eq!(p["driver"], kind.name());
            assert_eq!(p["host"], "127.0.0.1");
            assert_eq!(p["port"], 10032);
            assert_eq!(p["username"], "root");
            assert_eq!(p["password"], "pw");
            assert_eq!(p["tls"]["mode"], "disable", "{kind:?}");
            assert_eq!(p.get("database").and_then(Value::as_str), db, "{kind:?}");
        }
    }

    #[test]
    fn open_params_without_a_user_have_no_username() {
        let p = open_params(Kind::Redis, Some(&server(None)), "");
        assert!(p.get("username").is_none());
    }

    // ---- server_for ----

    #[test]
    fn server_for_sqlite_is_not_a_network_db() {
        assert!(server_for(Kind::Sqlite, &map(&[("DB_PASSWORD", "x")])).is_err());
    }

    #[test]
    fn server_for_without_a_password_is_skipped() {
        if std::env::var("S3B_DB_PASSWORD").is_ok_and(|v| !v.is_empty()) {
            return; // biến môi trường của người chạy thay mật khẩu trong file
        }
        let Err(e) = server_for(Kind::Postgres, &map(&[("DB_PASSWORD", "")])) else {
            panic!("thiếu mật khẩu phải bỏ qua");
        };
        assert!(e.contains("mật khẩu"), "{e}");
        assert!(server_for(Kind::Postgres, &HashMap::new()).is_err());
    }

    #[test]
    fn server_for_a_closed_port_is_skipped_without_leaking_the_password() {
        let port = closed_port().to_string();
        let env = map(&[
            ("DB_PASSWORD", "pw-SECRET"),
            ("DB_HOST", "127.0.0.1"),
            ("POSTGRES_PORT", &port),
        ]);
        let Err(e) = server_for(Kind::Postgres, &env) else {
            panic!("cổng đóng phải bỏ qua");
        };
        assert!(e.contains("không chạy"), "{e}");
        assert!(!e.contains("pw-SECRET"));
    }

    #[test]
    fn server_for_an_open_port_reads_host_port_and_user_from_the_env() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let env = map(&[
            ("DB_PASSWORD", "pw"),
            ("DB_HOST", "127.0.0.1"),
            ("MYSQL_PORT", &port),
            ("MYSQL_USER", "app"),
        ]);
        let s = server_for(Kind::MySql, &env).unwrap();
        assert_eq!(
            (s.host.as_str(), s.port),
            ("127.0.0.1", port.parse().unwrap())
        );
        assert_eq!(s.user.as_deref(), Some("app"));
        assert!(!s.password.is_empty());
    }

    #[test]
    fn server_for_redis_has_no_user_and_a_bad_port_falls_back_to_the_default() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let env = map(&[
            ("DB_PASSWORD", "pw"),
            ("REDIS_PORT", &port),
            ("REDIS_USER", "ignored"),
        ]);
        // Không đặt DB_HOST nên dùng 127.0.0.1.
        let s = server_for(Kind::Redis, &env).unwrap();
        assert_eq!(s.host, "127.0.0.1");
        assert_eq!(s.user, None);

        // Cổng không phải số thì dùng cổng mặc định (10035); kết quả phụ thuộc máy nên chỉ
        // kiểm không panic và, nếu lỗi, là lỗi "không chạy".
        let bad = map(&[("DB_PASSWORD", "pw"), ("REDIS_PORT", "abc")]);
        match server_for(Kind::Redis, &bad) {
            Ok(s) => assert_eq!(s.port, 10035),
            Err(e) => assert!(e.contains("không chạy"), "{e}"),
        }
    }

    // ---- batches / query ----

    #[test]
    fn batches_split_n_rows_into_chunks_of_500() {
        let sizes: Vec<usize> = batches(1_200).map(|b| b.len()).collect();
        assert_eq!(sizes, [500, 500, 200]);
        assert_eq!(batches(500).count(), 1);
        assert_eq!(batches(1).map(|b| b.len()).collect::<Vec<_>>(), [1]);
        assert_eq!(batches(0).count(), 0);
    }

    #[test]
    fn batches_continue_the_id_sequence() {
        let ids: Vec<u64> = batches(1_001).flatten().map(|r| r.id).collect();
        assert_eq!(ids.len(), 1_001);
        assert!(ids.iter().copied().eq(1..=1_001));
    }

    #[test]
    fn query_matches_each_kind() {
        assert_eq!(query(Kind::Sqlite, 10), data::select_sql("s3b_bench_10"));
        assert_eq!(query(Kind::SqlServer, 10), data::select_sql("s3b_bench_10"));
        assert_eq!(query(Kind::Mongo, 10), data::mongo_find("s3b_bench_10"));
        assert_eq!(query(Kind::Redis, 10), data::redis_lrange("s3b_bench_10"));
    }

    // ---- env_info ----

    #[test]
    fn env_info_lists_the_context_and_never_a_password() {
        let mut a = args(vec![Kind::Sqlite], vec![10, 20]);
        a.os = Some("OS-thử".to_owned());
        a.cpu = Some("CPU-thử".to_owned());
        a.ram = Some("RAM-thử".to_owned());
        let entries = [Entry {
            db: "sqlite",
            version: "3.51.0".to_owned(),
            n: 10,
            outcome: Outcome::Skip("x".to_owned()),
        }];
        let rows = env_info(&a, &entries, "20261120_153045", Some(1234));
        let get = |k: &str| {
            rows.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
                .unwrap_or_else(|| panic!("thiếu mục {k}"))
        };
        assert_eq!(get("Ngày giờ"), "2026-11-20 15:30:45");
        assert_eq!(get("Hệ điều hành"), "OS-thử");
        assert_eq!(get("CPU"), "CPU-thử");
        assert_eq!(get("RAM"), "RAM-thử");
        assert_eq!(get("Lần khởi động / lần đo"), "1 / 2");
        assert_eq!(get("s3b_db.dll release (byte)"), "1234");
        assert!(get("Cách đo").ends_with("10, 20"));
        assert!(get("Phiên bản sqlite").starts_with("3.51.0"));
        assert!(get("Phiên bản redis").starts_with("không lấy được"));
        assert!(get("Build").contains("DEBUG") || get("Build") == "release");
        for kind in Kind::ALL {
            get(&format!("Phiên bản {}", kind.name()));
        }
        assert!(
            rows.iter()
                .all(|(k, v)| !k.to_lowercase().contains("password")
                    && !k.to_lowercase().contains("mật khẩu")
                    && !v.contains("pw-SECRET"))
        );
    }

    #[test]
    fn env_info_without_dll_size_or_machine_info_says_unknown() {
        let rows = env_info(&args(vec![], vec![1]), &[], "x", None);
        let get = |k: &str| rows.iter().find(|(key, _)| key == k).unwrap().1.clone();
        assert_eq!(get("s3b_db.dll release (byte)"), "không rõ");
        assert_eq!(get("RAM"), "không rõ");
        assert_eq!(get("Ngày giờ"), "x");
    }

    // ---- gọi FFI thật ----

    #[test]
    fn call_reports_business_errors_as_code_and_message() {
        init();
        let Err(e) = call("method-khong-ton-tai", json!({})) else {
            panic!("method lạ phải lỗi");
        };
        assert!(e.contains(':'), "{e}");
        assert!(!e.starts_with("s3b_call"), "{e}");
    }

    #[test]
    fn open_a_sqlite_file_then_load_measure_and_clean_up() {
        init();
        let path = std::env::temp_dir().join(format!("s3b_bench_unit_{}.db", std::process::id()));
        // Driver SQLite chỉ mở file đã có (như `bench_db` làm bằng `File::create`).
        fs::File::create(&path).unwrap();
        let tmp = TempDb(path.clone());
        let opened = call(
            "open",
            open_params(Kind::Sqlite, None, &path.to_string_lossy()),
        )
        .unwrap();
        let conn = opened.result["connId"].as_u64().unwrap();
        assert!(opened.bytes > 0 && opened.wall_ms >= 0.0);

        // 1.200 dòng = 3 lô, kiểm cả `load` lẫn `rowsAffected`.
        load(Kind::Sqlite, conn, 1_200).unwrap();
        let run = measure(conn, &query(Kind::Sqlite, 1_200), 1_200).unwrap();
        assert_eq!(run.rows, 1_200);
        assert!(run.json_bytes > 1_200 * 100);
        assert!(run.call_ms > 0.0);
        assert!(run.first_row_ms.is_none(), "SQLite không có firstRowMs");
        // Đòi nhiều dòng hơn bảng có thì lỗi rõ ràng.
        let Err(e) = measure(conn, &query(Kind::Sqlite, 1_200), 1_300) else {
            panic!("lệch số dòng phải lỗi");
        };
        assert!(e.contains("1200") && e.contains("1300"), "{e}");

        cleanup(Kind::Sqlite, conn, 1_200).unwrap();
        let Err(e) = measure(conn, &query(Kind::Sqlite, 1_200), 1_200) else {
            panic!("bảng đã xoá phải lỗi");
        };
        assert!(!e.is_empty());
        // Nạp lại sau khi dọn vẫn chạy (load tự dọn dữ liệu sót).
        load(Kind::Sqlite, conn, 20).unwrap();
        load(Kind::Sqlite, conn, 20).unwrap();
        cleanup(Kind::Sqlite, conn, 20).unwrap();
        call("close", json!({"connId": conn})).unwrap();
        drop(tmp);
        assert!(!path.exists(), "TempDb phải xoá file khi drop");
    }

    #[test]
    fn bench_db_sqlite_measures_every_row_count() {
        init();
        let a = args(vec![Kind::Sqlite], vec![30, 60]);
        let entries = bench_db(Kind::Sqlite, &a, &HashMap::new());
        assert_eq!(entries.len(), 2);
        for (e, n) in entries.iter().zip([30, 60]) {
            assert_eq!((e.db, e.n), ("sqlite", n));
            assert!(e.version.chars().next().is_some_and(|c| c.is_ascii_digit()));
            let Outcome::Measured(runs) = &e.outcome else {
                panic!("n = {n}: phải đo được");
            };
            // 2 lần đo (khởi động không tính).
            assert_eq!(runs.len(), 2);
            assert!(runs.iter().all(|r| r.rows == n));
        }
        // File SQLite tạm đã được dọn.
        let tmp = std::env::temp_dir().join(format!("s3b_db_bench_{}.db", std::process::id()));
        assert!(!tmp.exists());
    }

    #[test]
    fn bench_db_for_an_unreachable_server_skips_every_row_count() {
        init();
        let port = closed_port().to_string();
        let env = map(&[
            ("DB_PASSWORD", "pw-SECRET"),
            ("DB_HOST", "127.0.0.1"),
            ("REDIS_PORT", &port),
        ]);
        let a = args(vec![Kind::Redis], vec![10, 20, 30]);
        let entries = bench_db(Kind::Redis, &a, &env);
        assert_eq!(entries.len(), 3);
        for e in &entries {
            let Outcome::Skip(why) = &e.outcome else {
                panic!("phải Skip");
            };
            assert!(!why.contains("pw-SECRET"), "{why}");
            assert!(e.version.is_empty());
        }
    }

    #[test]
    fn bench_db_with_no_row_counts_returns_nothing() {
        init();
        let a = args(vec![Kind::Sqlite], vec![]);
        assert!(bench_db(Kind::Sqlite, &a, &HashMap::new()).is_empty());
    }

    #[test]
    fn load_env_file_never_panics_and_parses_key_value_lines() {
        // File thật của test-env có thể không tồn tại (đã gitignore); hàm trả map rỗng khi đó.
        let m = load_env_file();
        assert!(m.keys().all(|k| !k.starts_with('#') && k.trim() == k));
    }

    #[test]
    fn usage_documents_every_flag_parse_args_accepts() {
        for flag in [
            "--db",
            "--rows",
            "--runs",
            "--warmup",
            "--out",
            "--timestamp",
            "--cpu",
            "--ram",
            "--os",
        ] {
            assert!(USAGE.contains(flag), "{flag}");
        }
        assert_eq!(MAX_PAGE_BYTES, 1 << 32);
    }
}
