//! Đo hiệu năng đường đọc SQLite (mốc trước/sau refactor N4): trang đầu của bảng 10.000 dòng x
//! 10 cột qua `s3b_call`. Không phải test đúng/sai nên mặc định bị bỏ qua; chạy bằng bản release:
//!
//! `cargo test --release --target x86_64-pc-windows-msvc -- --ignored sqlite_perf --nocapture`
//!
//! In min/trung vị/max của `elapsedMs` (Rust tự đo câu SELECT), thời gian gọi `s3b_call` tính từ
//! ngoài (gồm ghi JSON) và kích thước JSON của trang. Không chạy dưới debugger (debug heap của
//! Windows làm cấp phát chậm cỡ 10 lần). Bộ dữ liệu sinh tất định, không dùng crate `rand`.

mod common;

use common::*;
use s3b_db::ffi::{s3b_call, s3b_free};
use serde_json::{Value, json};
use std::time::Instant;
use std::{ptr, slice};

const ROWS: u64 = 10_000;
const WARMUP: usize = 3;
const RUNS: usize = 15;
/// Đủ lớn để trang 10.000 dòng không bị cắt theo byte.
const PERF_MAX_BYTES: u64 = 256 * 1024 * 1024;
const SELECT: &str = "SELECT id, n_int, n_big, n_float, n_dec, s_short, s_long, flag, ts, maybe_null \
                      FROM bench ORDER BY id";

/// Bộ sinh số giả ngẫu nhiên tất định (LCG của Knuth/MMIX): cùng seed cho cùng dãy dòng.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 11
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Từ ghép thành `s_long`: có tiếng Việt, CJK, ký tự có dấu và emoji.
const WORDS: [&str; 12] = [
    "alpha",
    "browser",
    "dữ liệu",
    "tiếng Việt",
    "日本語",
    "漢字",
    "café",
    "naïve",
    "object",
    "bucket",
    "📦",
    "lorem ipsum",
];

/// Đúng 120 ký tự (không phải byte), ghép từ `WORDS`.
fn long_text(rng: &mut Lcg) -> String {
    let mut s = String::new();
    while s.chars().count() < 120 {
        s.push_str(WORDS[rng.below(WORDS.len() as u64) as usize]);
        s.push(' ');
    }
    s.chars().take(120).collect()
}

/// Một dòng `VALUES (...)` của bảng `bench` (không có dấu nháy trong dữ liệu nên không cần escape).
fn row_values(id: u64, rng: &mut Lcg) -> String {
    let n_int = rng.below(2_000_000_000) as i64 - 1_000_000_000;
    let n_big = rng.next() as i64;
    let n_float = rng.below(1_000_000_000) as f64 / 7.0;
    let n_dec = format!("{}.{:02}", rng.below(10_000_000_000), rng.below(100));
    let s_short = format!("name-{}", rng.below(1_000_000_000_000));
    let s_long = long_text(rng);
    let flag = rng.below(2);
    let ts = format!(
        "{}-{:02}-{:02} {:02}:{:02}:{:02}",
        2000 + rng.below(25),
        1 + rng.below(12),
        1 + rng.below(28),
        rng.below(24),
        rng.below(60),
        rng.below(60)
    );
    let maybe_null = if rng.below(5) == 0 {
        "NULL".to_owned()
    } else {
        format!("'val-{}'", rng.below(1_000_000_000_000))
    };
    format!(
        "({id}, {n_int}, {n_big}, {n_float}, {n_dec}, '{s_short}', '{s_long}', {flag}, '{ts}', {maybe_null})"
    )
}

/// Tạo bảng và nạp `ROWS` dòng qua chính `execute` (mỗi câu INSERT 500 dòng).
fn load(conn: u64) {
    ok(&exec(
        conn,
        "CREATE TABLE bench(id INTEGER PRIMARY KEY, n_int INTEGER, n_big BIGINT, n_float DOUBLE, \
         n_dec DECIMAL(12,2), s_short VARCHAR(32), s_long VARCHAR(200), flag BOOLEAN, \
         ts TIMESTAMP, maybe_null VARCHAR(32))",
    ));
    let mut rng = Lcg(42);
    let mut id = 1;
    while id <= ROWS {
        let mut sql = String::from("INSERT INTO bench VALUES ");
        for i in 0..500u64.min(ROWS - id + 1) {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&row_values(id + i, &mut rng));
        }
        let r = exec(conn, &sql);
        let st = &statements(&r)[0];
        assert!(st.get("error").is_none(), "nạp dữ liệu lỗi: {st}");
        id += 500;
    }
    let r = exec(conn, "SELECT count(*), count(maybe_null) FROM bench");
    let row = &statements(&r)[0]["rows"][0];
    assert_eq!(row[0], json!("10000"));
}

/// Một lần đo: (`elapsedMs` của Rust, thời gian `s3b_call` từ ngoài tính bằng ms, byte JSON, số dòng).
fn measure(conn: u64) -> (u64, f64, usize, usize) {
    let req = json!({
        "id": next_id(),
        "method": "execute",
        "params": {"connId": conn, "sql": SELECT, "pageSize": ROWS, "maxPageBytes": PERF_MAX_BYTES},
    })
    .to_string();
    let mut out: *mut u8 = ptr::null_mut();
    let mut len = 0usize;
    let t = Instant::now();
    // SAFETY: req đọc được `req.len()` byte; out và len là ô ghi được.
    let rc = unsafe { s3b_call(req.as_ptr(), req.len(), &mut out, &mut len) };
    let wall_ms = t.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(rc, 0);
    // SAFETY: (out, len) vừa do s3b_call cấp, chưa free; copy ra rồi trả lại buffer.
    let v: Value = serde_json::from_slice(unsafe { slice::from_raw_parts(out, len) }).unwrap();
    // SAFETY: đúng cặp con trỏ/độ dài của s3b_call.
    unsafe { s3b_free(out, len) };
    let st = &statements(&v)[0];
    assert!(st.get("error").is_none(), "{st}");
    let rows = st["rows"].as_array().unwrap().len();
    (st["elapsedMs"].as_u64().unwrap(), wall_ms, len, rows)
}

fn summary(label: &str, mut v: Vec<f64>) {
    v.sort_by(f64::total_cmp);
    println!(
        "{label}: min {:.2}  median {:.2}  max {:.2}",
        v[0],
        v[v.len() / 2],
        v[v.len() - 1]
    );
}

#[test]
#[ignore = "đo hiệu năng, chạy bằng --release -- --ignored sqlite_perf --nocapture"]
fn sqlite_perf() {
    let db = Db::new();
    load(db.conn);

    for _ in 0..WARMUP {
        measure(db.conn);
    }
    let (mut elapsed, mut wall) = (Vec::new(), Vec::new());
    let (mut bytes, mut rows) = (0, 0);
    for _ in 0..RUNS {
        let (e, w, b, r) = measure(db.conn);
        elapsed.push(e as f64);
        wall.push(w);
        (bytes, rows) = (b, r);
    }
    assert_eq!(rows as u64, ROWS);

    println!(
        "
== sqlite_perf ({}; {WARMUP} warmup + {RUNS} runs) ==",
        if cfg!(debug_assertions) {
            "DEBUG build, số đo không có giá trị"
        } else {
            "release"
        }
    );
    println!(
        "rows {rows}, JSON {bytes} byte ({:.2} MB, {:.0} byte/dòng)",
        bytes as f64 / 1e6,
        bytes as f64 / rows as f64
    );
    summary("elapsedMs (Rust, ms)       ", elapsed);
    summary("s3b_call wall (ms)         ", wall);
}
