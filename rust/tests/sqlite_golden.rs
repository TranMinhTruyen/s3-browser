//! Golden test SQLite: lưu nguyên văn JSON response của một bộ lời gọi cố định qua FFI, so từng
//! byte với file trong `tests/golden/sqlite/`. Dùng làm lưới an toàn khi refactor driver (N4):
//! hành vi quan sát được từ Go (JSON) không được đổi dù code bên trong thay đổi.
//!
//! Chuẩn hoá trước khi lưu/so (chỉ phần phụ thuộc thời gian hoặc thứ tự chạy):
//! - `elapsedMs` = 0; xoá key `firstRowMs` (N4 sẽ thêm);
//! - `cursorId` khác null = 1, `connId` = 1 (id do registry cấp tăng dần).
//!
//! `serde_json` ở crate này không bật `preserve_order`, nên `Value` giữ object theo thứ tự khoá
//! đã sắp xếp (BTreeMap): file golden là JSON pretty với khoá sắp xếp, ổn định theo cấu trúc chứ
//! không phụ thuộc thứ tự field trong struct Rust.
//!
//! Sinh/ghi lại file golden: `S3B_UPDATE_GOLDEN=1 cargo test --test sqlite_golden`. Chạy bình
//! thường thì lệch là hồi quy: sửa code, không sửa file golden.

mod common;

use common::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::PathBuf;

/// Câu có lỗi `integer overflow` ở dòng thứ 2 (dòng 1 đọc bình thường).
const OVERFLOW_AT_ROW_2: &str =
    "SELECT abs(x) FROM (SELECT 1 AS x UNION ALL SELECT -9223372036854775807-1)";

const BIG: u64 = 16 * 1024 * 1024;

/// Đưa response về dạng so sánh được giữa các lần chạy (xem mô tả ở đầu file).
fn normalize(v: &mut Value) {
    match v {
        Value::Object(map) => {
            // readMs/convertMs chỉ có khi bật feature `bench-timing`.
            for key in ["firstRowMs", "readMs", "convertMs"] {
                map.remove(key);
            }
            for (k, child) in map.iter_mut() {
                match k.as_str() {
                    "elapsedMs" => *child = json!(0),
                    "cursorId" | "connId" if !child.is_null() => *child = json!(1),
                    _ => normalize(child),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize),
        _ => {}
    }
}

/// Một nhóm response liên quan, lưu vào một file golden.
struct Case {
    name: &'static str,
    steps: Vec<Value>,
}

impl Case {
    fn new(name: &'static str) -> Self {
        Self {
            name,
            steps: Vec::new(),
        }
    }

    /// Ghi response (đã chuẩn hoá) kèm nhãn mô tả bước; trả lại response gốc để lấy id đi tiếp.
    fn rec(&mut self, label: &str, resp: Value) -> Value {
        let mut norm = resp.clone();
        normalize(&mut norm);
        self.steps.push(json!({"step": label, "response": norm}));
        resp
    }

    /// `fetch` liên tục (lần lượt theo `limits`, lặp vòng) tới khi `done`, ghi từng trang.
    fn drain(&mut self, conn: u64, cursor: u64, limits: &[(u64, u64)]) {
        for i in 0.. {
            let (page, max) = limits[i % limits.len()];
            let r = self.rec(
                &format!("fetch #{} pageSize={page} maxPageBytes={max}", i + 1),
                fetch_page(conn, cursor, page, max),
            );
            if ok(&r)["done"] == true {
                return;
            }
            assert!(i < 1000, "cursor không bao giờ done");
        }
    }
}

/// Sắp khoá mọi object theo bảng chữ cái (đệ quy), để chuỗi JSON in ra không phụ thuộc `Value`
/// đang giữ thứ tự chèn hay thứ tự chữ cái.
fn sorted(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted).collect()),
        other => other,
    }
}

struct Golden {
    update: bool,
    dir: PathBuf,
    written: BTreeSet<String>,
}

impl Golden {
    fn new() -> Self {
        Self {
            update: std::env::var("S3B_UPDATE_GOLDEN").is_ok_and(|v| v == "1"),
            dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/sqlite"),
            written: BTreeSet::new(),
        }
    }

    /// Ghi (khi `S3B_UPDATE_GOLDEN=1`) hoặc so (theo `Value`, không xét thứ tự khoá) với file golden
    /// của case.
    fn finish(&mut self, case: Case) {
        let file = format!("{}.json", case.name);
        let actual = Value::Array(case.steps);
        let path = self.dir.join(&file);
        if self.update {
            let mut text = serde_json::to_string_pretty(&sorted(actual)).unwrap();
            text.push('\n');
            std::fs::create_dir_all(&self.dir).unwrap();
            std::fs::write(&path, text.as_bytes()).unwrap();
        } else {
            let want = std::fs::read(&path).unwrap_or_else(|_| {
                panic!("thiếu golden {file}; sinh bằng S3B_UPDATE_GOLDEN=1 trước khi refactor")
            });
            let want: Value = serde_json::from_slice(&want).unwrap();
            assert!(
                want == actual,
                "response lệch golden {file}\n--- golden ---\n{}\n--- thực tế ---\n{}",
                serde_json::to_string_pretty(&sorted(want.clone())).unwrap(),
                serde_json::to_string_pretty(&sorted(actual.clone())).unwrap()
            );
        }
        assert!(self.written.insert(file), "trùng tên case {}", case.name);
    }

    /// Không được còn file golden không có case nào sinh ra (case bị xoá hay đổi tên).
    fn assert_no_stale_files(&self) {
        if self.update {
            return;
        }
        let on_disk: BTreeSet<String> = std::fs::read_dir(&self.dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(on_disk, self.written, "file golden thừa hoặc thiếu");
    }
}

fn cursor_of(resp: &Value, statement: usize) -> u64 {
    statements(resp)[statement]["cursorId"].as_u64().unwrap()
}

#[test]
fn sqlite_golden() {
    let mut g = Golden::new();
    let db = Db::new();
    let c = db.conn;

    // ---- mở / đóng ----
    let mut k = Case::new("00_open_close");
    let rw = k.rec(
        "open readOnly=false",
        call(
            "open",
            json!({"driver": "sqlite", "path": db.path, "readOnly": false}),
        ),
    );
    let ro = k.rec(
        "open readOnly=true",
        call(
            "open",
            json!({"driver": "sqlite", "path": db.path, "readOnly": true}),
        ),
    );
    let ro_default = k.rec(
        "open without readOnly",
        call("open", json!({"driver": "sqlite", "path": db.path})),
    );
    for (label, r) in [("rw", &rw), ("ro", &ro), ("default", &ro_default)] {
        let id = ok(r)["connId"].as_u64().unwrap();
        k.rec(
            &format!("close {label}"),
            call("close", json!({"connId": id})),
        );
    }
    g.finish(k);

    // ---- nhiều câu trong một lần thực thi ----
    let mut k = Case::new("01_multi_statements");
    k.rec(
        "script create/insert/select/update/delete/select",
        exec(
            c,
            "CREATE TABLE m1(a INTEGER, b TEXT); \
             INSERT INTO m1 VALUES(1,'x'),(2,'y'),(3,'z'); \
             SELECT a, b FROM m1 ORDER BY a; \
             UPDATE m1 SET a = a * 10 WHERE a < 3; \
             DELETE FROM m1 WHERE a = 3; \
             SELECT a, b FROM m1 ORDER BY a",
        ),
    );
    k.rec(
        "comments, empty statements and trailing semicolon",
        exec(c, "/* c */ SELECT 1; ; -- tail\n SELECT 2 AS two;"),
    );
    g.finish(k);

    // ---- lỗi ----
    let mut k = Case::new("02_statement_errors");
    k.rec(
        "syntax error in the middle",
        exec(c, "SELECT 1; SELEC 2; SELECT 3"),
    );
    k.rec("syntax error alone", exec(c, "SELEC 2"));
    k.rec("no such table", exec(c, "SELECT * FROM nope"));
    k.rec(
        "constraint violation then more",
        exec(
            c,
            "CREATE TABLE uq(a UNIQUE); INSERT INTO uq VALUES(1); INSERT INTO uq VALUES(1); SELECT 9",
        ),
    );
    k.rec("empty sql", exec(c, ""));
    k.rec("only comment", exec(c, "-- nothing"));
    k.rec("runtime error in first page", exec(c, OVERFLOW_AT_ROW_2));
    k.rec(
        "runtime error in non-last select",
        exec(c, &format!("SELECT 1; {OVERFLOW_AT_ROW_2}; SELECT 3")),
    );
    let r = k.rec(
        "runtime error after first page: execute",
        exec_page(c, OVERFLOW_AT_ROW_2, 1, BIG),
    );
    let cur = cursor_of(&r, 0);
    k.rec("runtime error at fetch", fetch(c, cur));
    k.rec("cursor dropped after error", fetch(c, cur));
    k.rec("connection still usable", exec(c, "SELECT 4"));
    g.finish(k);

    // ---- kết nối chỉ đọc ----
    let mut k = Case::new("03_read_only");
    ok(&exec(
        c,
        "CREATE TABLE ro_t(a); INSERT INTO ro_t VALUES(1),(2)",
    ));
    let ro = open(&db.path, true);
    k.rec("select", exec(ro, "SELECT a FROM ro_t ORDER BY a"));
    k.rec("insert", exec(ro, "INSERT INTO ro_t VALUES(3)"));
    k.rec("create table", exec(ro, "CREATE TABLE ro_new(a)"));
    k.rec(
        "write after select in one script",
        exec(ro, "SELECT 1; DELETE FROM ro_t; SELECT 2"),
    );
    k.rec("select again", exec(ro, "SELECT count(*) FROM ro_t"));
    ok(&call("close", json!({"connId": ro})));
    g.finish(k);

    // ---- phân trang ----
    ok(&exec(
        c,
        &format!(
            "CREATE TABLE p(id INTEGER PRIMARY KEY, name TEXT); \
             INSERT INTO p SELECT x, printf('row-%03d', x) FROM ({})",
            series(25)
        ),
    ));
    let mut k = Case::new("04_paging");
    let r = k.rec(
        "execute pageSize=4",
        exec_page(c, "SELECT id, name FROM p ORDER BY id", 4, BIG),
    );
    k.drain(c, cursor_of(&r, 0), &[(7, BIG)]);
    k.rec("fetch after done", fetch(c, cursor_of(&r, 0)));

    let r = k.rec(
        "execute maxPageBytes=30 (cut early, 4 rows)",
        exec_page(c, "SELECT id, name FROM p ORDER BY id", 100, 30),
    );
    k.drain(
        c,
        cursor_of(&r, 0),
        &[(5, BIG), (100, 20), (3, BIG), (100, 1)],
    );

    let r = k.rec(
        "execute pageSize=0 maxPageBytes=0 (at least one row)",
        exec_page(c, "SELECT id FROM p ORDER BY id LIMIT 3", 0, 0),
    );
    k.drain(c, cursor_of(&r, 0), &[(0, 0)]);

    k.rec(
        "exactly pageSize rows",
        exec_page(c, "SELECT id FROM p ORDER BY id LIMIT 5", 5, BIG),
    );
    k.rec(
        "fewer rows than pageSize",
        exec_page(c, "SELECT id FROM p ORDER BY id LIMIT 5", 6, BIG),
    );
    k.rec(
        "no rows",
        exec_page(c, "SELECT id FROM p WHERE id < 0", 5, BIG),
    );
    let r = k.rec(
        "replace cursor by next execute",
        exec_page(c, "SELECT id FROM p ORDER BY id", 2, BIG),
    );
    let old = cursor_of(&r, 0);
    k.rec(
        "second execute",
        exec_page(c, "SELECT id FROM p ORDER BY id DESC", 2, BIG),
    );
    k.rec("old cursor is gone", fetch(c, old));
    g.finish(k);

    // ---- hai SELECT liền nhau ----
    let mut k = Case::new("05_truncated");
    k.rec(
        "two selects, first cut by pageSize",
        exec_page(
            c,
            "SELECT id FROM p ORDER BY id; SELECT name FROM p ORDER BY id",
            5,
            BIG,
        ),
    );
    k.rec(
        "two selects, both fit",
        exec_page(c, "SELECT 1; SELECT 2", 5, BIG),
    );
    k.rec(
        "first cut by maxPageBytes",
        exec_page(c, "SELECT name FROM p; SELECT 'last'", 100, 20),
    );
    let r = k.rec(
        "three selects, only last keeps cursor",
        exec_page(
            c,
            "SELECT id FROM p; SELECT id FROM p WHERE id < 3; SELECT id FROM p WHERE id > 20",
            3,
            BIG,
        ),
    );
    k.drain(c, cursor_of(&r, 2), &[(3, BIG)]);
    g.finish(k);

    // ---- BLOB ----
    let mut k = Case::new("06_blob");
    ok(&exec(
        c,
        "CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB); \
         INSERT INTO b(data) VALUES(x''),(x'00'),(x'0aFF'),(zeroblob(4)), \
         (unhex(replace(hex(zeroblob(1000)), '00', 'a5ff'))), (NULL)",
    ));
    k.rec(
        "table blob column",
        exec(
            c,
            "SELECT id, data, length(data), typeof(data) FROM b ORDER BY id",
        ),
    );
    k.rec(
        "blob literals",
        exec(
            c,
            "SELECT x'', x'00', x'DEADBEEF', zeroblob(0), zeroblob(3)",
        ),
    );
    g.finish(k);

    // ---- NULL ----
    let mut k = Case::new("07_null");
    ok(&exec(
        c,
        "CREATE TABLE n(a INTEGER, b TEXT, c REAL, d BLOB); \
         INSERT INTO n VALUES(NULL,NULL,NULL,NULL),(0,'',0.0,x''),(1,'NULL',1.5,x'01')",
    ));
    k.rec(
        "null vs empty",
        exec(c, "SELECT a, b, c, d FROM n ORDER BY rowid"),
    );
    k.rec(
        "null expressions",
        exec(
            c,
            "SELECT NULL, NULL IS NULL, 1+NULL, coalesce(NULL, 'x'), ''",
        ),
    );
    g.finish(k);

    // ---- REAL / số nguyên lớn ----
    let mut k = Case::new("08_numbers");
    ok(&exec(
        c,
        "CREATE TABLE r(id INTEGER PRIMARY KEY, i INTEGER, r REAL, n NUMERIC, u); \
         INSERT INTO r(i, r, n, u) VALUES \
         (0, 0.1, 0.1, 0.1), \
         (1, 1e308, 1e308, 1e308), \
         (2, -0.0, -0.0, -0.0), \
         (9007199254740993, 9007199254740993, 9007199254740993, 9007199254740993), \
         (9223372036854775807, 9007199254740993.0, '9007199254740993', 1e15), \
         (-9223372036854775808, 5e-324, 1e16, -1e-7), \
         (3, 100.0, 100.0, 100.0), \
         (4, 1e999, -1e999, 12345678901234567890), \
         (5, 123456789.123456789, 0.30000000000000004, 1e-5)",
    ));
    k.rec(
        "typed columns",
        exec(
            c,
            "SELECT id, i, r, n, u, typeof(r), typeof(u) FROM r ORDER BY id",
        ),
    );
    k.rec(
        "literals",
        exec(
            c,
            "SELECT 0.1, 1e308, -0.0, 0.0, 9007199254740993, 9007199254740993.0, \
             9223372036854775807, -9223372036854775808, 0.1+0.2, 1e22, 1e-7",
        ),
    );
    g.finish(k);

    // ---- TEXT Unicode ----
    let mut k = Case::new("09_unicode");
    ok(&exec(
        c,
        "CREATE TABLE u(id INTEGER PRIMARY KEY, s TEXT); \
         INSERT INTO u(s) VALUES \
         ('Xin chào thế giới'), \
         ('Tiếng Việt: ặ ữ ỳ Đ đ'), \
         ('日本語のテキスト'), \
         ('漢字與简体字'), \
         ('emoji 😀🚀👨‍👩‍👧‍👦'), \
         ('e' || char(769)), \
         ('quote \" backslash \\ slash / tab ' || char(9) || ' newline ' || char(10)), \
         (char(1) || char(31) || char(127) || char(8232)), \
         ('')",
    ));
    k.rec(
        "unicode text",
        exec(
            c,
            "SELECT id, s, length(s), length(CAST(s AS BLOB)) FROM u ORDER BY id",
        ),
    );
    k.rec(
        "unicode column names",
        exec(c, "SELECT 1 AS \"tên cột\", 2 AS \"日本\", 3 AS \"😀\""),
    );
    g.finish(k);

    // ---- rowsAffected ----
    let mut k = Case::new("10_rows_affected");
    k.rec(
        "affected counts",
        exec(
            c,
            "CREATE TABLE a(x); \
             INSERT INTO a VALUES(1),(2),(3); \
             UPDATE a SET x = x + 1 WHERE x < 3; \
             DELETE FROM a WHERE x = 3; \
             UPDATE a SET x = 0 WHERE 0; \
             DROP TABLE a",
        ),
    );
    k.rec(
        "insert returning",
        exec(
            c,
            "CREATE TABLE ret(a INTEGER PRIMARY KEY, b); \
             INSERT INTO ret(b) VALUES('x'),('y') RETURNING a, b; \
             PRAGMA user_version = 5; \
             PRAGMA user_version",
        ),
    );
    g.finish(k);

    // ---- schemaTree / tableInfo / tableRows (DB riêng, không dính các case trên) ----
    let sdb = Db::new();
    let sc = sdb.conn;
    ok(&exec(
        sc,
        "CREATE TABLE parent(id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x'); \
         CREATE TABLE child(\
           id INTEGER, \
           pid INTEGER REFERENCES parent(id) ON DELETE CASCADE ON UPDATE SET NULL, \
           code TEXT UNIQUE, \
           qty INT CHECK(qty > 0), \
           note TEXT GENERATED ALWAYS AS (code || '!') VIRTUAL, \
           PRIMARY KEY(id, pid)); \
         CREATE INDEX child_qty ON child(qty) WHERE qty > 10; \
         CREATE VIEW v_child AS SELECT id, code FROM child; \
         CREATE TRIGGER tr_child AFTER INSERT ON child BEGIN SELECT 1; END; \
         CREATE TABLE no_rowid(k TEXT PRIMARY KEY, v) WITHOUT ROWID; \
         CREATE TABLE \"we ird\"(\"a b\" INTEGER)",
    ));
    ok(&exec(
        sc,
        &format!(
            "INSERT INTO parent SELECT x, 'p' || x FROM ({}); \
             INSERT INTO \"we ird\" SELECT x FROM ({})",
            series(20),
            series(20)
        ),
    ));

    let mut k = Case::new("11_schema_tree");
    k.rec("schemaTree", call("schemaTree", json!({"connId": sc})));
    let empty = Db::new();
    k.rec(
        "schemaTree on empty db",
        call("schemaTree", json!({"connId": empty.conn})),
    );
    g.finish(k);

    let mut k = Case::new("12_table_info");
    for table in ["parent", "child", "v_child", "no_rowid", "we ird", "nope"] {
        k.rec(
            &format!("tableInfo {table}"),
            call(
                "tableInfo",
                json!({"connId": sc, "schema": "main", "table": table}),
            ),
        );
    }
    k.rec(
        "tableInfo unknown schema",
        call(
            "tableInfo",
            json!({"connId": sc, "schema": "other", "table": "parent"}),
        ),
    );
    g.finish(k);

    let mut k = Case::new("13_table_rows");
    let r = k.rec(
        "tableRows parent pageSize=6",
        call(
            "tableRows",
            json!({"connId": sc, "schema": "main", "table": "parent", "pageSize": 6, "maxPageBytes": BIG}),
        ),
    );
    k.drain(
        sc,
        ok(&r)["cursorId"].as_u64().unwrap(),
        &[(6, BIG), (4, 12)],
    );
    let r = k.rec(
        "tableRows table with spaces in name",
        call(
            "tableRows",
            json!({"connId": sc, "schema": "main", "table": "we ird", "pageSize": 100, "maxPageBytes": BIG}),
        ),
    );
    assert!(ok(&r)["done"] == true);
    k.rec(
        "tableRows child (no rows)",
        call(
            "tableRows",
            json!({"connId": sc, "schema": "main", "table": "child", "pageSize": 10, "maxPageBytes": BIG}),
        ),
    );
    k.rec(
        "tableRows maxPageBytes=1",
        call(
            "tableRows",
            json!({"connId": sc, "schema": "main", "table": "parent", "pageSize": 100, "maxPageBytes": 1}),
        ),
    );
    k.rec(
        "tableRows not found",
        call(
            "tableRows",
            json!({"connId": sc, "schema": "main", "table": "nope", "pageSize": 10, "maxPageBytes": BIG}),
        ),
    );
    g.finish(k);

    // ---- lỗi cursorNotFound / connNotFound ----
    let mut k = Case::new("14_not_found");
    let r = k.rec(
        "execute with open cursor",
        exec_page(c, "SELECT id FROM p ORDER BY id", 2, BIG),
    );
    let cur = cursor_of(&r, 0);
    k.rec("fetch unknown cursor", fetch(c, cur + 1000));
    k.rec("fetch cursor 0", fetch(c, 0));
    k.rec("fetch right cursor still works", fetch(c, cur));
    let gone = open(&db.path, false);
    let r = exec_page(gone, &series(100), 10, BIG);
    let gone_cur = cursor_of(&r, 0);
    k.rec("close", call("close", json!({"connId": gone})));
    k.rec("close again", call("close", json!({"connId": gone})));
    k.rec("execute on closed conn", exec(gone, "SELECT 1"));
    k.rec("fetch on closed conn", fetch(gone, gone_cur));
    k.rec(
        "schemaTree on closed conn",
        call("schemaTree", json!({"connId": gone})),
    );
    k.rec(
        "tableInfo on closed conn",
        call(
            "tableInfo",
            json!({"connId": gone, "schema": "main", "table": "p"}),
        ),
    );
    k.rec(
        "tableRows on closed conn",
        call(
            "tableRows",
            json!({"connId": gone, "schema": "main", "table": "p", "pageSize": 1, "maxPageBytes": BIG}),
        ),
    );
    k.rec(
        "close unknown conn",
        call("close", json!({"connId": 987654321u64})),
    );
    g.finish(k);

    g.assert_no_stale_files();
}
