//! So khớp đường nhị phân tự viết với đường text của chính PostgreSQL (plan 10.8, rủi ro 25).
//!
//! Với mỗi biểu thức `e`: `select e` chạy bằng giao thức nhị phân (mọi cột trong danh sách cho
//! phép) còn `select e, 0::money` chạy bằng simple query (text do server tự in) vì `money` nằm
//! ngoài danh sách. Sau `set timezone = 'UTC'` hai ô đầu phải GIỐNG HỆT từng ký tự. Lệch nghĩa là
//! bộ in chuỗi tự viết (`value.rs`/`array.rs`) in khác PostgreSQL.
//!
//! Không có server thì mỗi test in `SKIP ...` rồi đạt (xem `pg_common`).

mod common;
mod pg_common;

use common::*;
use pg_common::*;
use serde_json::Value;
use std::path::Path;

/// Biểu thức float mà thập phân ngắn nhất nằm đúng giữa hai số float liền kề (tie): PostgreSQL
/// in thêm một chữ số còn ta in chuỗi ngắn hơn, cả hai chuỗi đều đọc lại đúng cùng một số. Chạy
/// riêng ở test "giới hạn đã biết", không so từng ký tự.
const FLOAT_TIES: [&str; 5] = [
    "1e23::float8",
    "1.5e10::float4",
    "-1.5e10::float4",
    "1.2345678e8::float4",
    "-1.2345678e8::float4",
];

/// Kiểu cột đầu tiên của câu đầu tiên (để báo lỗi dễ đọc).
fn column_type(r: &Value) -> String {
    ok(r)["statements"][0]["columns"][0]["type"]
        .as_str()
        .unwrap_or("?")
        .to_owned()
}

/// Các biểu thức mà ô đầu của đường nhị phân khác đường text (hoặc lỗi), mỗi phần tử là một
/// dòng mô tả để in một lần tất cả chỗ lệch.
fn mismatches(c: &Conn, exprs: &[String]) -> Vec<String> {
    let mut bad = Vec::new();
    for e in exprs {
        let binary = c.exec(&format!("select {e}"));
        if binary["ok"] != true {
            bad.push(format!("ERR  {e}: {binary}"));
            continue;
        }
        let text = c.exec(&format!("select {e}, 0::money"));
        if text["ok"] != true {
            bad.push(format!("ERR(text)  {e}: {text}"));
            continue;
        }
        let (a, b) = (first_cell(&binary), first_cell(&text));
        if a != b {
            bad.push(format!(
                "DIFF {e} [{}]\n     binary={a}\n     text  ={b}",
                column_type(&binary)
            ));
        }
    }
    bad
}

fn utc_conn(pg: &Server) -> Conn {
    let c = pg.conn();
    ok(&c.exec("set timezone = 'UTC'"));
    c
}

fn owned(exprs: &[&str]) -> Vec<String> {
    exprs.iter().map(|e| (*e).to_owned()).collect()
}

fn assert_no_mismatch(bad: Vec<String>, checked: usize) {
    assert!(
        bad.is_empty(),
        "{} / {checked} biểu thức lệch:\n{}",
        bad.len(),
        bad.join("\n")
    );
}

/// Float sinh tự động: mantissa {1, 1.5, 9.99, 1.2345678}, hai dấu, số mũ -7..=19, float4 và float8.
fn generated_floats() -> Vec<String> {
    let mut v = Vec::new();
    for ty in ["float4", "float8"] {
        for exp in -7..=19 {
            for mantissa in ["1", "1.5", "9.99", "1.2345678"] {
                for sign in ["", "-"] {
                    v.push(format!("{sign}{mantissa}e{exp}::{ty}"));
                }
            }
        }
    }
    v
}

#[test]
fn builtin_expressions_print_the_same_in_binary_and_in_server_text() {
    let Some(pg) = server("builtin_expressions") else {
        return;
    };
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pg_exprs.txt");
    let exprs: Vec<String> = std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_owned)
        .collect();
    assert_eq!(exprs.len(), 200, "file fixture phải đủ 200 biểu thức");
    let c = utc_conn(&pg);
    assert_no_mismatch(mismatches(&c, &exprs), exprs.len());
}

#[test]
fn generated_floats_print_the_same_in_binary_and_in_server_text() {
    let Some(pg) = server("generated_floats") else {
        return;
    };
    let (ties, exprs): (Vec<String>, Vec<String>) = generated_floats()
        .into_iter()
        .partition(|e| FLOAT_TIES.contains(&e.as_str()));
    // 4 trong 5 dòng hoà nằm trong tập sinh (`1e23` có số mũ ngoài -7..=19); khác đi là có thay đổi.
    assert_eq!(ties.len(), 4, "{ties:?}");
    assert_eq!(exprs.len(), 2 * 27 * 4 * 2 - 4);
    let c = utc_conn(&pg);
    assert_no_mismatch(mismatches(&c, &exprs), exprs.len());
}

/// Giới hạn đã biết: ở dòng hoà, PostgreSQL và ta chọn khác nhau (`1e23::float8`: PG in
/// `9.999999999999999e+22`, ta in `1e+23`; `1.5e10::float4`: PG in `1.5000001e+10`, ta in
/// `1.5e+10`; `1.2345678e8::float4`: PG in `1.23456784e+08`, ta in `1.2345678e+08`). Chỉ so theo
/// GIÁ TRỊ đọc lại, không nới so sánh cho giá trị khác.
#[test]
fn float_ties_are_a_known_limit_but_read_back_to_the_same_value() {
    let Some(pg) = server("float_ties") else {
        return;
    };
    let c = utc_conn(&pg);
    for e in FLOAT_TIES {
        let binary = first_cell(&c.exec(&format!("select {e}")));
        let text = first_cell(&c.exec(&format!("select {e}, 0::money")));
        let (binary, text) = (binary.as_str().unwrap(), text.as_str().unwrap());
        if e.ends_with("float4") {
            assert_eq!(
                binary.parse::<f32>().unwrap().to_bits(),
                text.parse::<f32>().unwrap().to_bits(),
                "{e}: {binary} vs {text}"
            );
        } else {
            assert_eq!(
                binary.parse::<f64>().unwrap().to_bits(),
                text.parse::<f64>().unwrap().to_bits(),
                "{e}: {binary} vs {text}"
            );
        }
        if binary != text {
            println!("known limit {e}: binary={binary} text={text}");
        }
    }
}

#[test]
fn arrays_of_every_supported_type_print_like_the_server() {
    let Some(pg) = server("arrays_of_everything") else {
        return;
    };
    let c = utc_conn(&pg);
    let exprs = owned(&[
        "ARRAY['NaN'::numeric,'-Infinity'::numeric,0.001]",
        "ARRAY['infinity'::date,'-infinity'::date,'0001-01-01 BC'::date]",
        "ARRAY['1 year 2 days'::interval,'-1 mon'::interval]",
        "ARRAY[ARRAY['a','b'],ARRAY['c',NULL]]",
        "'{}'::text[]",
        "'{{},{}}'::text[]",
        "(ARRAY[1,2,3])[2:3]",
        "ARRAY[B'101',B'0']::varbit[]",
        r"ARRAY['\xDEADBEEF'::bytea]",
        "ARRAY['{\"a\": \"x,y\"}'::jsonb]",
        "ARRAY['x'::text, E'a\\nb', E'tab\\t']",
        "ARRAY[chr(92), '\"', 'a' || chr(92) || 'b', chr(92) || chr(34)]",
        "ARRAY['2020-01-01 00:00:00'::timestamp,'infinity'::timestamp]",
        "ARRAY['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, NULL]",
        "ARRAY[1.5,2.5]::float4[]",
        "ARRAY['NaN'::float8,'Infinity','-Infinity','-0']",
        "ARRAY[[1,2],[3,4],[5,6]]",
        "ARRAY[[[1,2],[3,4]],[[5,6],[7,8]]]",
        "'[-3:-1]={1,2,3}'::int8[]",
        "ARRAY[ARRAY[NULL::int,NULL],ARRAY[NULL,1]]",
        "ARRAY[''::text, ' ', '  x  ']",
        "ARRAY['NULL','Null','nulL']",
        "ARRAY['a b','c,d','e{f','g}h']",
        "ARRAY[true]",
        "ARRAY['2020-01-02 03:04:05.5+07'::timestamptz]",
        "ARRAY['12:00:00.25+05:30'::timetz]",
        "ARRAY['::1'::inet,'10.0.0.1/8'::inet,'2001:db8::/32'::cidr]",
        "ARRAY[1,2,3]::oid[]",
        "ARRAY[(select count(*) from generate_series(1,100))]",
        "(select array_agg(x::text) from generate_series(1,200) x)",
    ]);
    assert_no_mismatch(mismatches(&c, &exprs), exprs.len());
}

/// Schema tạm của một test; xoá cả khi test panic (Drop chạy trước khi `Conn` đóng).
struct Scratch {
    conn: Conn,
}

impl Scratch {
    fn new(pg: &Server) -> Self {
        let conn = utc_conn(pg);
        ok(&conn.exec("drop schema if exists s3b_scratch cascade"));
        ok(&conn.exec("create schema s3b_scratch"));
        Self { conn }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        self.conn.exec("drop schema if exists s3b_scratch cascade");
    }
}

#[test]
fn enum_domain_and_user_types_print_like_the_server() {
    let Some(pg) = server("enum_domain") else {
        return;
    };
    let s = Scratch::new(&pg);
    let c = &s.conn;
    for sql in [
        "create type s3b_scratch.mood as enum ('sad','ok','hap py')",
        "create domain s3b_scratch.posint as int4 check (value > 0)",
        "create domain s3b_scratch.pstr as text",
        "create type s3b_scratch.pt as (x int, y text)",
        "create type s3b_scratch.rng as range (subtype = int4)",
        "create table s3b_scratch.t (m s3b_scratch.mood, ms s3b_scratch.mood[], \
         d s3b_scratch.posint, ds s3b_scratch.posint[], p s3b_scratch.pt, r int4range, \
         mo money, ts tsvector, pt point, id int)",
        "insert into s3b_scratch.t values ('hap py', array['sad','hap py']::s3b_scratch.mood[], \
         5, array[1,2]::s3b_scratch.posint[], row(1,'a b'), '[1,5)', 12.5, \
         to_tsvector('simple','a b'), '(1,2)', 1)",
    ] {
        let r = c.exec(sql);
        assert_eq!(r["ok"], true, "{sql}: {r}");
        assert!(statements(&r)[0]["error"].is_null(), "{sql}: {r}");
    }
    let exprs = owned(&[
        "'hap py'::s3b_scratch.mood",
        "array['sad','hap py']::s3b_scratch.mood[]",
        "5::s3b_scratch.posint",
        "array[1,2]::s3b_scratch.posint[]",
        "'a'::s3b_scratch.pstr",
        "array['a','b c']::s3b_scratch.pstr[]",
        "NULL::s3b_scratch.mood",
        "NULL::s3b_scratch.posint",
        "row(1,'a b')::s3b_scratch.pt",
        "'[1,5)'::s3b_scratch.rng",
    ]);
    let bad = mismatches(c, &exprs);

    // Cột ngoài danh sách (money, tsvector, point...) làm cả câu chạy bằng simple query.
    let r = c.exec("select m, ms, d, ds, p, r, mo, ts, pt, id from s3b_scratch.t");
    let row = &statements(&r)[0]["rows"][0];
    let types: Vec<&str> = statements(&r)[0]["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|col| col["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        // Server báo domain theo kiểu gốc của cột đơn (`int4`) nhưng giữ tên domain cho mảng.
        [
            "mood",
            "_mood",
            "int4",
            "_posint",
            "pt",
            "int4range",
            "money",
            "tsvector",
            "point",
            "int4"
        ]
    );
    assert_eq!(row[0], "hap py");
    assert_eq!(row[1], "{sad,\"hap py\"}");
    assert_eq!(row[2], "5");
    assert_eq!(row[3], "{1,2}");
    assert_eq!(row[4], "(1,\"a b\")");
    assert_eq!(row[5], "[1,5)");
    assert_eq!(row[6], "$12.50");
    assert_eq!(row[7], "'a':1 'b':2");
    assert_eq!(row[8], "(1,2)");
    assert_eq!(row[9], "1");
    // Cùng bảng chỉ chọn cột trong danh sách (enum, domain, mảng của chúng) vẫn đúng.
    let r = c.exec("select m, ms, d, ds, id from s3b_scratch.t");
    let row = &statements(&r)[0]["rows"][0];
    assert_eq!(
        row,
        &serde_json::json!(["hap py", "{sad,\"hap py\"}", "5", "{1,2}", "1"])
    );
    assert_no_mismatch(bad, exprs.len());
}

#[test]
fn citext_prints_like_the_server() {
    let Some(pg) = server("citext") else {
        return;
    };
    let c = utc_conn(&pg);
    let r = c.exec("create extension if not exists citext");
    if r["ok"] != true || !statements(&r)[0]["error"].is_null() {
        println!(
            "SKIP citext: không tạo được extension: {}",
            statements(&r)[0]["error"]
        );
        return;
    }
    let exprs = owned(&[
        "'AbC'::citext",
        "ARRAY['a','B c']::citext[]",
        "NULL::citext",
        "''::citext",
    ]);
    assert_no_mismatch(mismatches(&c, &exprs), exprs.len());
}

#[test]
fn timestamptz_binary_is_always_utc_while_server_text_follows_the_session_time_zone() {
    let Some(pg) = server("timestamptz_session_zone") else {
        return;
    };
    let c = pg.conn();
    ok(&c.exec("set timezone = 'Asia/Ho_Chi_Minh'"));
    // Đường nhị phân (Q32=A): luôn UTC với hậu tố `+00`, không đọc TimeZone của session.
    let binary = c.first("select timestamptz '2020-01-01 00:00:00+00'");
    assert_eq!(binary, "2020-01-01 00:00:00+00");
    let array = c.first("select ARRAY[timestamptz '2020-01-01 00:00:00+00']");
    assert_eq!(array, "{\"2020-01-01 00:00:00+00\"}");
    // Đường simple query: server tự in theo múi giờ của session.
    let text = c.first("select timestamptz '2020-01-01 00:00:00+00', 0::money");
    assert_eq!(text, "2020-01-01 07:00:00+07");
    // Đổi múi giờ session không làm đổi kết quả của đường nhị phân.
    ok(&c.exec("set timezone = 'America/New_York'"));
    assert_eq!(
        c.first("select timestamptz '2020-01-01 00:00:00+00'"),
        "2020-01-01 00:00:00+00"
    );
    // `timestamp` và `date` không có múi giờ nên hai đường luôn khớp bất kể session.
    assert_eq!(
        c.first("select timestamp '2020-01-01 00:00:00'"),
        c.first("select timestamp '2020-01-01 00:00:00', 0::money")
    );
}

#[test]
fn a_column_outside_the_allow_list_moves_the_whole_statement_to_text_without_changing_cells() {
    let Some(pg) = server("outside_allow_list") else {
        return;
    };
    let c = utc_conn(&pg);
    let r =
        c.exec("select 1 as a, 'x'::text as b, null::int as n, 1.5::float8 as f, 0::money as m");
    assert_eq!(
        statements(&r)[0]["rows"][0],
        serde_json::json!(["1", "x", null, "1.5", "$0.00"])
    );
    let r = c.exec("select 1 as a, 'x'::text as b, null::int as n, 1.5::float8 as f");
    assert_eq!(
        statements(&r)[0]["rows"][0],
        serde_json::json!(["1", "x", null, "1.5"])
    );
}
