//! Dữ liệu của bench: sinh dòng tất định và dựng câu lệnh tạo/nạp/đo/dọn cho từng loại DB.
//!
//! Nằm ở đầu luồng của bench: `main.rs` hỏi file này "câu lệnh gì" rồi tự gửi qua `s3b_call`.
//! Nhờ vậy dữ liệu của mọi DB đều sinh từ cùng một bộ sinh số nên giống hệt nhau, và không cần
//! script SQL riêng cho từng DB. Bộ sinh khớp với `rust/tests/sqlite_perf.rs` (cùng seed 42,
//! cùng thứ tự gọi) nên số đo SQLite so được với mốc cũ.
//!
//! Khái niệm Rust: `enum` ở đây giống một `iota` của Go nhưng mỗi biến thể là một giá trị riêng
//! và `match` bắt buộc xử lý đủ mọi biến thể (thêm DB mới mà quên một chỗ thì không build được).

use std::fmt::Write;

/// Số dòng mỗi câu `INSERT`/`insert`/`RPUSH` khi nạp dữ liệu.
pub const BATCH: usize = 500;

/// Database mongo dùng cho bench (xoá cả database khi dọn).
pub const MONGO_DB: &str = "s3b_bench";

/// Số DB Redis dùng cho bench; các test tích hợp dùng 11..=15 nên chọn số khác.
pub const REDIS_DB: &str = "10";

/// Loại DB được đo.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Sqlite,
    Postgres,
    MySql,
    MariaDb,
    SqlServer,
    Mongo,
    Redis,
}

impl Kind {
    pub const ALL: [Kind; 7] = [
        Kind::Sqlite,
        Kind::Postgres,
        Kind::MySql,
        Kind::MariaDb,
        Kind::SqlServer,
        Kind::Mongo,
        Kind::Redis,
    ];

    /// Tên dùng ở dòng lệnh, trong báo cáo và làm `driver` của `open`.
    pub fn name(self) -> &'static str {
        match self {
            Kind::Sqlite => "sqlite",
            Kind::Postgres => "postgres",
            Kind::MySql => "mysql",
            Kind::MariaDb => "mariadb",
            Kind::SqlServer => "sqlserver",
            Kind::Mongo => "mongodb",
            Kind::Redis => "redis",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.name() == s)
    }

    /// Tên các key trong `test-env/db/db.env`: (cổng, tài khoản, cổng mặc định).
    /// `None` nghĩa là DB đó không có (SQLite) hoặc không dùng tài khoản (Redis).
    pub fn env_keys(self) -> Option<(&'static str, Option<&'static str>, u16)> {
        match self {
            Kind::Sqlite => None,
            Kind::MySql => Some(("MYSQL_PORT", Some("MYSQL_USER"), 10030)),
            Kind::MariaDb => Some(("MARIADB_PORT", Some("MARIADB_USER"), 10031)),
            Kind::Postgres => Some(("POSTGRES_PORT", Some("POSTGRES_USER"), 10032)),
            Kind::SqlServer => Some(("MSSQL_PORT", Some("MSSQL_USER"), 10033)),
            Kind::Mongo => Some(("MONGO_PORT", Some("MONGO_USER"), 10034)),
            Kind::Redis => Some(("REDIS_PORT", None, 10035)),
        }
    }

    /// Tên container trong `test-env/docker-compose.yml` (để lấy phiên bản image).
    pub fn container(self) -> Option<&'static str> {
        match self {
            Kind::Sqlite => None,
            Kind::MySql => Some("s3b-test-mysql"),
            Kind::MariaDb => Some("s3b-test-mariadb"),
            Kind::Postgres => Some("s3b-test-postgres"),
            Kind::SqlServer => Some("s3b-test-mssql"),
            Kind::Mongo => Some("s3b-test-mongo"),
            Kind::Redis => Some("s3b-test-redis"),
        }
    }
}

/// Tên bảng/collection/key của bộ dữ liệu `n` dòng. Tiền tố `s3b_bench_` để không đụng dữ liệu khác.
pub fn table_name(n: usize) -> String {
    format!("s3b_bench_{n}")
}

/// Bộ sinh số giả ngẫu nhiên tất định (LCG của Knuth/MMIX): cùng seed cho cùng dãy dòng.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 11
    }

    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Từ ghép thành `s_long`: có tiếng Việt, CJK, ký tự có dấu và emoji (không có dấu nháy nên
/// không cần escape khi ghép vào SQL/JSON).
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

/// Một dòng dữ liệu bench (10 cột). Số thập phân và thời gian giữ dạng chuỗi để ghép thẳng vào
/// câu lệnh mà không mất chữ số.
pub struct Row {
    pub id: u64,
    pub n_int: i64,
    pub n_big: i64,
    pub n_float: f64,
    pub n_dec: String,
    pub s_short: String,
    pub s_long: String,
    pub flag: bool,
    /// `YYYY-MM-DD hh:mm:ss`.
    pub ts: String,
    /// Khoảng 20% là `None` (NULL).
    pub maybe_null: Option<String>,
}

/// Dãy dòng `id = 1, 2, 3...` của bộ dữ liệu: dòng thứ k luôn giống nhau dù bảng có n dòng nào,
/// nên bảng 1.000 dòng là phần đầu của bảng 100.000 dòng.
pub struct RowGen {
    rng: Lcg,
    next_id: u64,
}

impl RowGen {
    pub fn new() -> Self {
        Self {
            rng: Lcg::new(42),
            next_id: 1,
        }
    }
}

impl Iterator for RowGen {
    type Item = Row;

    fn next(&mut self) -> Option<Row> {
        // Thứ tự gọi `rng` giữ như `sqlite_perf.rs` (đừng đổi, sẽ lệch mốc cũ).
        let rng = &mut self.rng;
        let id = self.next_id;
        self.next_id += 1;
        let n_int = rng.below(2_000_000_000) as i64 - 1_000_000_000;
        let n_big = rng.next() as i64;
        let n_float = rng.below(1_000_000_000) as f64 / 7.0;
        let n_dec = format!("{}.{:02}", rng.below(10_000_000_000), rng.below(100));
        let s_short = format!("name-{}", rng.below(1_000_000_000_000));
        let s_long = long_text(rng);
        let flag = rng.below(2) == 1;
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
            None
        } else {
            Some(format!("val-{}", rng.below(1_000_000_000_000)))
        };
        Some(Row {
            id,
            n_int,
            n_big,
            n_float,
            n_dec,
            s_short,
            s_long,
            flag,
            ts,
            maybe_null,
        })
    }
}

// ---- câu lệnh SQL ----

/// `CREATE TABLE` với kiểu tương đương phổ biến nhất của từng DB.
pub fn create_table(kind: Kind, table: &str) -> String {
    let cols = match kind {
        Kind::Sqlite => {
            "id INTEGER PRIMARY KEY, n_int INTEGER, n_big BIGINT, n_float DOUBLE, \
             n_dec DECIMAL(12,2), s_short VARCHAR(32), s_long VARCHAR(200), flag BOOLEAN, \
             ts TIMESTAMP, maybe_null VARCHAR(32)"
        }
        Kind::Postgres => {
            "id integer PRIMARY KEY, n_int integer, n_big bigint, n_float double precision, \
             n_dec numeric(12,2), s_short varchar(32), s_long varchar(200), flag boolean, \
             ts timestamp, maybe_null varchar(32)"
        }
        Kind::MySql | Kind::MariaDb => {
            "id INT PRIMARY KEY, n_int INT, n_big BIGINT, n_float DOUBLE, n_dec DECIMAL(12,2), \
             s_short VARCHAR(32), s_long VARCHAR(200), flag BOOLEAN, ts DATETIME, \
             maybe_null VARCHAR(32)"
        }
        Kind::SqlServer => {
            "id INT PRIMARY KEY, n_int INT, n_big BIGINT, n_float FLOAT, n_dec DECIMAL(12,2), \
             s_short NVARCHAR(32), s_long NVARCHAR(200), flag BIT, ts DATETIME2, \
             maybe_null NVARCHAR(32)"
        }
        Kind::Mongo | Kind::Redis => "",
    };
    match kind {
        Kind::MySql | Kind::MariaDb => {
            format!("CREATE TABLE {table} ({cols}) DEFAULT CHARSET=utf8mb4")
        }
        _ => format!("CREATE TABLE {table} ({cols})"),
    }
}

pub fn drop_table(table: &str) -> String {
    format!("DROP TABLE IF EXISTS {table}")
}

/// `INSERT` nhiều dòng một câu. Dữ liệu không có dấu nháy nên chỉ cần bao bằng `'...'`.
pub fn insert_sql(kind: Kind, table: &str, rows: &[Row]) -> String {
    let mut sql = String::with_capacity(32 + rows.len() * 300);
    let _ = write!(sql, "INSERT INTO {table} VALUES ");
    // SQL Server cần tiền tố `N` để chuỗi unicode vào NVARCHAR không bị đổi sang code page.
    let n = if kind == Kind::SqlServer { "N" } else { "" };
    for (i, r) in rows.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        let flag = match (kind, r.flag) {
            (Kind::Postgres, true) => "true",
            (Kind::Postgres, false) => "false",
            (_, true) => "1",
            (_, false) => "0",
        };
        let _ = write!(
            sql,
            "({}, {}, {}, {}, {}, {n}'{}', {n}'{}', {flag}, '{}', ",
            r.id, r.n_int, r.n_big, r.n_float, r.n_dec, r.s_short, r.s_long, r.ts
        );
        match &r.maybe_null {
            Some(v) => {
                let _ = write!(sql, "{n}'{v}')");
            }
            None => sql.push_str("NULL)"),
        }
    }
    sql
}

/// Câu đọc cả bảng, cột theo thứ tự cố định.
pub fn select_sql(table: &str) -> String {
    format!(
        "SELECT id, n_int, n_big, n_float, n_dec, s_short, s_long, flag, ts, maybe_null \
         FROM {table} ORDER BY id"
    )
}

/// Câu lấy phiên bản server.
pub fn version_sql(kind: Kind) -> &'static str {
    match kind {
        Kind::Sqlite => "SELECT sqlite_version()",
        Kind::Postgres | Kind::MySql | Kind::MariaDb => "SELECT version()",
        Kind::SqlServer => "SELECT @@VERSION",
        Kind::Mongo => r#"{"buildInfo":1}"#,
        Kind::Redis => "INFO server",
    }
}

// ---- MongoDB ----

/// Một document Extended JSON gọn (cùng field với bảng SQL).
fn mongo_doc(r: &Row) -> String {
    serde_json::json!({
        "_id": r.id, "n_int": r.n_int, "n_big": r.n_big, "n_float": r.n_float,
        "n_dec": r.n_dec, "s_short": r.s_short, "s_long": r.s_long, "flag": r.flag,
        "ts": r.ts, "maybe_null": r.maybe_null,
    })
    .to_string()
}

/// Lệnh `insert` nhiều document. Tên lệnh phải là key đầu tiên nên ghép chuỗi tay.
pub fn mongo_insert(coll: &str, rows: &[Row]) -> String {
    let docs: Vec<String> = rows.iter().map(mongo_doc).collect();
    format!(
        r#"{{"insert":"{coll}","documents":[{}],"$db":"{MONGO_DB}"}}"#,
        docs.join(",")
    )
}

pub fn mongo_find(coll: &str) -> String {
    format!(r#"{{"find":"{coll}","$db":"{MONGO_DB}"}}"#)
}

pub fn mongo_drop_db() -> String {
    format!(r#"{{"dropDatabase":1,"$db":"{MONGO_DB}"}}"#)
}

// ---- Redis ----

/// Lệnh `RPUSH` nhiều phần tử; mỗi phần tử là JSON của một dòng, bao bằng `"..."` và escape
/// `\` và `"` theo cú pháp của driver Redis (giống `redis-cli`).
pub fn redis_rpush(key: &str, rows: &[Row]) -> String {
    let mut cmd = format!("RPUSH {key}");
    for r in rows {
        cmd.push_str(" \"");
        for c in mongo_doc(r).chars() {
            if c == '\\' || c == '"' {
                cmd.push('\\');
            }
            cmd.push(c);
        }
        cmd.push('"');
    }
    cmd
}

pub fn redis_lrange(key: &str) -> String {
    format!("LRANGE {key} 0 -1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn rows(n: usize) -> Vec<Row> {
        RowGen::new().take(n).collect()
    }

    // ---- Lcg ----

    #[test]
    fn lcg_follows_the_knuth_mmix_recurrence_from_the_seed() {
        let mut rng = Lcg::new(42);
        let mut state: u64 = 42;
        for _ in 0..5 {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            assert_eq!(rng.next(), state >> 11);
        }
    }

    #[test]
    fn lcg_below_stays_in_range_and_is_deterministic() {
        let (mut a, mut b) = (Lcg::new(7), Lcg::new(7));
        for _ in 0..1000 {
            let v = a.below(13);
            assert!(v < 13);
            assert_eq!(v, b.below(13));
        }
        assert_eq!(Lcg::new(1).below(1), 0);
    }

    #[test]
    fn lcg_with_different_seeds_diverges() {
        assert_ne!(Lcg::new(1).next(), Lcg::new(2).next());
    }

    // ---- Kind ----

    #[test]
    fn kind_names_are_unique_and_parse_back() {
        let mut names: Vec<_> = Kind::ALL.iter().map(|k| k.name()).collect();
        for k in Kind::ALL {
            assert_eq!(Kind::parse(k.name()), Some(k));
        }
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 7);
        assert_eq!(Kind::Mongo.name(), "mongodb");
    }

    #[test]
    fn kind_parse_rejects_unknown_empty_and_wrong_case() {
        for s in ["", "oracle", "SQLite", "mongo", " redis"] {
            assert_eq!(Kind::parse(s), None, "{s:?}");
        }
    }

    #[test]
    fn kind_env_keys_and_containers() {
        assert_eq!(Kind::Sqlite.env_keys(), None);
        assert_eq!(Kind::Sqlite.container(), None);
        assert_eq!(Kind::Redis.env_keys(), Some(("REDIS_PORT", None, 10035)));
        for k in Kind::ALL.into_iter().filter(|k| *k != Kind::Sqlite) {
            let (port, user, default) = k.env_keys().unwrap();
            assert!(port.ends_with("_PORT"));
            assert!((10030..=10035).contains(&default), "{k:?}");
            assert_eq!(user.is_some(), k != Kind::Redis, "{k:?}");
            assert!(k.container().unwrap().starts_with("s3b-test-"));
        }
    }

    #[test]
    fn table_name_has_the_bench_prefix() {
        assert_eq!(table_name(1000), "s3b_bench_1000");
        assert_eq!(table_name(0), "s3b_bench_0");
    }

    // ---- RowGen ----

    #[test]
    fn rows_are_deterministic_for_seed_42() {
        let (a, b) = (rows(50), rows(50));
        assert_eq!(
            insert_sql(Kind::Postgres, "t", &a),
            insert_sql(Kind::Postgres, "t", &b)
        );
    }

    #[test]
    fn ids_count_up_from_one() {
        let ids: Vec<u64> = rows(5).iter().map(|r| r.id).collect();
        assert_eq!(ids, [1, 2, 3, 4, 5]);
        assert!(rows(0).is_empty());
    }

    #[test]
    fn a_smaller_table_is_a_prefix_of_a_bigger_one() {
        let small = rows(1_000);
        let big = rows(5_000);
        assert_eq!(
            insert_sql(Kind::MySql, "t", &small),
            insert_sql(Kind::MySql, "t", &big[..1_000])
        );
    }

    #[test]
    fn row_values_follow_their_documented_shape() {
        for r in rows(2_000) {
            assert!((-1_000_000_000..1_000_000_000).contains(&r.n_int));
            assert!(r.n_big >= 0);
            let (int, frac) = r.n_dec.split_once('.').expect("n_dec có dấu chấm");
            assert!(int.parse::<u64>().is_ok() && frac.len() == 2 && frac.parse::<u8>().is_ok());
            assert!(r.s_short.starts_with("name-"));
            assert_eq!(r.s_long.chars().count(), 120);
            let b = r.ts.as_bytes();
            assert_eq!(b.len(), 19, "{}", r.ts);
            assert_eq!(
                (b[4], b[7], b[10], b[13], b[16]),
                (b'-', b'-', b' ', b':', b':')
            );
            let year: u32 = r.ts[..4].parse().unwrap();
            assert!((2000..2025).contains(&year));
            let (mo, da): (u32, u32) = (r.ts[5..7].parse().unwrap(), r.ts[8..10].parse().unwrap());
            assert!((1..=12).contains(&mo) && (1..=28).contains(&da));
            assert!(r.ts[11..13].parse::<u32>().unwrap() < 24);
            assert!(r.ts[14..16].parse::<u32>().unwrap() < 60);
            assert!(r.ts[17..19].parse::<u32>().unwrap() < 60);
            if let Some(v) = &r.maybe_null {
                assert!(v.starts_with("val-"));
            }
        }
    }

    #[test]
    fn about_a_fifth_of_maybe_null_is_null() {
        let all = rows(20_000);
        let nulls = all.iter().filter(|r| r.maybe_null.is_none()).count();
        let ratio = nulls as f64 / all.len() as f64;
        assert!((0.17..0.23).contains(&ratio), "{ratio}");
    }

    #[test]
    fn flag_has_both_values() {
        let all = rows(200);
        assert!(all.iter().any(|r| r.flag) && all.iter().any(|r| !r.flag));
    }

    #[test]
    fn text_has_no_characters_that_need_escaping_and_has_non_ascii() {
        let all = rows(2_000);
        for r in &all {
            for s in [&r.s_short, &r.s_long] {
                assert!(!s.contains(['\'', '"', '\\']), "{s}");
            }
        }
        assert!(all.iter().any(|r| !r.s_long.is_ascii()));
    }

    // ---- SQL ----

    #[test]
    fn create_table_uses_each_dialects_types() {
        let t = "s3b_bench_10";
        let pg = create_table(Kind::Postgres, t);
        assert!(pg.starts_with("CREATE TABLE s3b_bench_10 (") && pg.contains("boolean"));
        assert!(pg.contains("double precision") && pg.contains("numeric(12,2)"));
        let ms = create_table(Kind::SqlServer, t);
        assert!(ms.contains("NVARCHAR(200)") && ms.contains("BIT") && ms.contains("DATETIME2"));
        for k in [Kind::MySql, Kind::MariaDb] {
            let s = create_table(k, t);
            assert!(s.ends_with("DEFAULT CHARSET=utf8mb4"), "{k:?}");
            assert!(s.contains("DATETIME"));
        }
        let lite = create_table(Kind::Sqlite, t);
        assert!(lite.contains("INTEGER PRIMARY KEY"));
        for k in [Kind::Sqlite, Kind::Postgres, Kind::SqlServer] {
            assert!(!create_table(k, t).contains("utf8mb4"), "{k:?}");
        }
    }

    #[test]
    fn every_sql_table_has_the_ten_columns() {
        for k in [
            Kind::Sqlite,
            Kind::Postgres,
            Kind::MySql,
            Kind::MariaDb,
            Kind::SqlServer,
        ] {
            let sql = create_table(k, "t");
            for col in [
                "id ",
                "n_int",
                "n_big",
                "n_float",
                "n_dec",
                "s_short",
                "s_long",
                "flag",
                "ts ",
                "maybe_null",
            ] {
                assert!(sql.contains(col), "{k:?} thiếu {col}");
            }
        }
    }

    #[test]
    fn drop_and_select_statements() {
        assert_eq!(drop_table("t"), "DROP TABLE IF EXISTS t");
        assert_eq!(
            select_sql("t"),
            "SELECT id, n_int, n_big, n_float, n_dec, s_short, s_long, flag, ts, maybe_null \
             FROM t ORDER BY id"
        );
    }

    #[test]
    fn insert_sql_has_one_tuple_per_row_and_null_for_none() {
        let r = rows(300);
        let nulls = r.iter().filter(|r| r.maybe_null.is_none()).count();
        let sql = insert_sql(Kind::Postgres, "t", &r);
        assert!(sql.starts_with("INSERT INTO t VALUES (1, "));
        assert_eq!(sql.matches("), (").count(), 299);
        assert!(sql.ends_with(')'));
        assert_eq!(sql.matches(", NULL)").count(), nulls);
        assert!(nulls > 0);
    }

    #[test]
    fn insert_sql_of_no_rows_has_no_tuples() {
        assert_eq!(insert_sql(Kind::MySql, "t", &[]), "INSERT INTO t VALUES ");
    }

    #[test]
    fn only_sql_server_prefixes_strings_with_n() {
        let r = rows(5);
        for k in Kind::ALL {
            if matches!(k, Kind::Mongo | Kind::Redis) {
                continue;
            }
            let sql = insert_sql(k, "t", &r);
            assert_eq!(sql.contains(", N'"), k == Kind::SqlServer, "{k:?}");
        }
        // Mỗi dòng có s_short, s_long và maybe_null (nếu không NULL) là chuỗi N'...'.
        let r1 = rows(1);
        let n = r1[0].maybe_null.is_some() as usize + 2;
        assert_eq!(
            insert_sql(Kind::SqlServer, "t", &r1).matches("N'").count(),
            n
        );
    }

    #[test]
    fn booleans_are_words_for_postgres_and_digits_elsewhere() {
        let r = rows(60);
        let pg = insert_sql(Kind::Postgres, "t", &r);
        assert!(pg.contains(", true, '") && pg.contains(", false, '"));
        for k in [Kind::Sqlite, Kind::MySql, Kind::MariaDb, Kind::SqlServer] {
            let sql = insert_sql(k, "t", &r);
            assert!(!sql.contains("true") && !sql.contains("false"), "{k:?}");
            assert!(sql.contains(", 1, '") && sql.contains(", 0, '"), "{k:?}");
        }
    }

    #[test]
    fn version_sql_per_kind() {
        assert_eq!(version_sql(Kind::Sqlite), "SELECT sqlite_version()");
        for k in [Kind::Postgres, Kind::MySql, Kind::MariaDb] {
            assert_eq!(version_sql(k), "SELECT version()");
        }
        assert_eq!(version_sql(Kind::SqlServer), "SELECT @@VERSION");
        assert_eq!(version_sql(Kind::Mongo), r#"{"buildInfo":1}"#);
        assert_eq!(version_sql(Kind::Redis), "INFO server");
    }

    // ---- MongoDB ----

    #[test]
    fn mongo_insert_is_json_with_the_command_name_first() {
        let r = rows(40);
        let cmd = mongo_insert("coll", &r);
        assert!(
            cmd.starts_with(r#"{"insert":"coll","documents":["#),
            "{cmd}"
        );
        let v: Value = serde_json::from_str(&cmd).unwrap();
        assert_eq!(v["$db"], MONGO_DB);
        let docs = v["documents"].as_array().unwrap();
        assert_eq!(docs.len(), 40);
        assert_eq!(docs[0]["_id"], 1);
        assert_eq!(docs[0]["s_short"], r[0].s_short);
        assert_eq!(docs[0]["flag"], r[0].flag);
        assert_eq!(docs[0]["n_dec"], r[0].n_dec);
        for (d, row) in docs.iter().zip(&r) {
            assert_eq!(d["maybe_null"].is_null(), row.maybe_null.is_none());
        }
    }

    #[test]
    fn mongo_find_and_drop() {
        assert_eq!(mongo_find("c"), r#"{"find":"c","$db":"s3b_bench"}"#);
        assert_eq!(mongo_drop_db(), r#"{"dropDatabase":1,"$db":"s3b_bench"}"#);
        for s in [mongo_find("c"), mongo_drop_db()] {
            assert!(serde_json::from_str::<Value>(&s).is_ok());
        }
    }

    // ---- Redis ----

    /// Đọc lại các đối số có dấu nháy của lệnh theo cú pháp `redis-cli` (`\\` và `\"`).
    fn unquote(cmd: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut chars = cmd.chars();
        while let Some(c) = chars.next() {
            if c != '"' {
                continue;
            }
            let mut s = String::new();
            loop {
                match chars.next().expect("dấu nháy phải đóng") {
                    '\\' => s.push(chars.next().unwrap()),
                    '"' => break,
                    c => s.push(c),
                }
            }
            out.push(s);
        }
        out
    }

    #[test]
    fn redis_rpush_quotes_one_json_document_per_row() {
        let r = rows(25);
        let cmd = redis_rpush("k", &r);
        assert!(cmd.starts_with("RPUSH k \"{"), "{cmd}");
        let items = unquote(&cmd);
        assert_eq!(items.len(), 25);
        for (item, row) in items.iter().zip(&r) {
            let v: Value = serde_json::from_str(item).unwrap();
            assert_eq!(v["_id"], row.id);
            assert_eq!(v["s_long"], row.s_long);
        }
    }

    #[test]
    fn redis_rpush_with_no_rows_is_just_the_command() {
        assert_eq!(redis_rpush("k", &[]), "RPUSH k");
    }

    #[test]
    fn redis_lrange_reads_the_whole_list() {
        assert_eq!(redis_lrange("k"), "LRANGE k 0 -1");
    }

    #[test]
    fn batch_and_target_constants() {
        assert_eq!(BATCH, 500);
        assert_eq!(MONGO_DB, "s3b_bench");
        assert_eq!(REDIS_DB, "10");
    }
}
