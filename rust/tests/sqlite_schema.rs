//! N3: đọc schema SQLite.

mod common;

use common::*;
use serde_json::{Value, json};

fn tree(db: &Db) -> Value {
    let r = call("schemaTree", json!({"connId": db.conn}));
    ok(&r)["schemas"][0].clone()
}

fn info(db: &Db, table: &str) -> Value {
    let r = call(
        "tableInfo",
        json!({"connId": db.conn, "schema": "main", "table": table}),
    );
    ok(&r).clone()
}

fn table_rows(db: &Db, table: &str, page: u64) -> Value {
    call(
        "tableRows",
        json!({"connId": db.conn, "schema": "main", "table": table, "pageSize": page, "maxPageBytes": MAX_BYTES}),
    )
}

#[test]
fn empty_db_has_empty_groups() {
    let db = Db::new();
    let t = tree(&db);
    assert_eq!(t["name"], "main");
    for k in ["tables", "views", "indexes", "triggers"] {
        assert_eq!(t[k], json!([]), "{k}");
    }
}

#[test]
fn tree_groups_and_hides_internal() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE b(id INTEGER PRIMARY KEY AUTOINCREMENT, u TEXT UNIQUE); \
         CREATE TABLE a(x); \
         CREATE VIEW v AS SELECT * FROM a; \
         CREATE INDEX ix ON a(x); \
         CREATE TRIGGER tg AFTER INSERT ON a BEGIN SELECT 1; END; \
         INSERT INTO b(u) VALUES('k')",
    ));
    let t = tree(&db);
    // b có sqlite_sequence và sqlite_autoindex_b_1: phải bị bỏ
    assert_eq!(t["tables"], json!(["a", "b"]));
    assert_eq!(t["views"], json!(["v"]));
    assert_eq!(t["indexes"], json!([{"name": "ix", "table": "a"}]));
    assert_eq!(t["triggers"], json!([{"name": "tg", "table": "a"}]));
}

#[test]
fn table_info_columns_pk_default_notnull() {
    let db = Db::new();
    ok(&db
        .exec("CREATE TABLE t(a INTEGER, b TEXT NOT NULL DEFAULT 'z', c REAL, PRIMARY KEY(b, a))"));
    let i = info(&db, "t");
    let cols = i["columns"].as_array().unwrap();
    assert_eq!(cols.len(), 3);
    assert_eq!(cols[0]["name"], "a");
    assert_eq!(cols[0]["type"], "INTEGER");
    assert_eq!(cols[0]["cid"], 0);
    assert_eq!(cols[0]["pk"], 2);
    assert_eq!(cols[0]["notNull"], false);
    assert_eq!(cols[1]["notNull"], true);
    assert_eq!(cols[1]["defaultValue"], "'z'");
    assert_eq!(cols[1]["pk"], 1);
    assert_eq!(cols[2]["pk"], 0);
    assert_eq!(cols[2]["defaultValue"], Value::Null);
    let pk = i["constraints"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "PRIMARY KEY")
        .unwrap();
    assert_eq!(pk["columns"], json!(["b", "a"]));
    assert_eq!(pk["name"], Value::Null);
    assert!(i["ddl"].as_str().unwrap().starts_with("CREATE TABLE t"));
}

#[test]
fn table_info_unique_index_and_constraint() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE t(a, b, c, UNIQUE(a, b)); \
         CREATE INDEX ic ON t(c) WHERE c > 0",
    ));
    let i = info(&db, "t");
    let idx = i["indexes"].as_array().unwrap();
    let u = idx.iter().find(|x| x["origin"] == "u").unwrap();
    assert_eq!(u["unique"], true);
    assert_eq!(u["partial"], false);
    assert_eq!(u["columns"], json!(["a", "b"]));
    let p = idx.iter().find(|x| x["name"] == "ic").unwrap();
    assert_eq!(p["origin"], "c");
    assert_eq!(p["partial"], true);
    assert_eq!(p["unique"], false);
    let uc = i["constraints"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "UNIQUE")
        .unwrap();
    assert_eq!(uc["columns"], json!(["a", "b"]));
    assert_eq!(uc["name"], Value::Null);
}

#[test]
fn table_info_check_column_and_table() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE t(a INTEGER CHECK (a > 0), b INTEGER, CHECK (a < b), CONSTRAINT named CHECK (b <> 5))",
    ));
    let i = info(&db, "t");
    let checks: Vec<&Value> = i["constraints"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] == "CHECK")
        .collect();
    assert_eq!(checks.len(), 3, "{i}");
    let col = checks
        .iter()
        .find(|c| c["columns"] == json!(["a"]))
        .unwrap();
    assert!(col["expression"].as_str().unwrap().contains("a > 0"));
    let tbl: Vec<_> = checks
        .iter()
        .filter(|c| c["columns"] == json!([]))
        .collect();
    assert_eq!(tbl.len(), 2);
    assert!(tbl.iter().any(|c| c["name"] == "named"));
    assert!(
        tbl.iter()
            .any(|c| c["expression"].as_str().unwrap().contains("a < b"))
    );
}

#[test]
fn table_info_foreign_keys() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE p(x, y, PRIMARY KEY(x, y)); \
         CREATE TABLE q(a, b, FOREIGN KEY(a, b) REFERENCES p(x, y) ON DELETE CASCADE ON UPDATE SET NULL)",
    ));
    let i = info(&db, "q");
    let fk = i["foreignKeys"].as_array().unwrap();
    assert_eq!(fk.len(), 1);
    assert_eq!(fk[0]["columns"], json!(["a", "b"]));
    assert_eq!(fk[0]["refTable"], "p");
    assert_eq!(fk[0]["refColumns"], json!(["x", "y"]));
    assert_eq!(fk[0]["onDelete"], "CASCADE");
    assert_eq!(fk[0]["onUpdate"], "SET NULL");
}

#[test]
fn table_info_exotic_ddl_keeps_pk_unique() {
    let db = Db::new();
    // STRICT + WITHOUT ROWID: PK/UNIQUE luôn lấy từ PRAGMA; CHECK (unit test `check_constraints`
    // đã phủ DDL hỏng -> rỗng) phải có mặt khi sqlparser parse được DDL này.
    ok(&db.exec(
        "CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT UNIQUE, CHECK (a > 0)) STRICT, WITHOUT ROWID",
    ));
    let i = info(&db, "t");
    let kinds: Vec<&str> = i["constraints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["kind"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"PRIMARY KEY"), "{kinds:?}");
    assert!(kinds.contains(&"UNIQUE"), "{kinds:?}");
    assert!(kinds.contains(&"CHECK"), "{kinds:?}");
}

#[test]
fn table_info_view_has_columns_only() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a, b); CREATE VIEW v AS SELECT a FROM t"));
    let i = info(&db, "v");
    assert_eq!(i["columns"].as_array().unwrap().len(), 1);
    assert_eq!(i["indexes"], json!([]));
    assert_eq!(i["foreignKeys"], json!([]));
    assert_eq!(i["constraints"], json!([]));
    assert!(i["ddl"].as_str().unwrap().contains("VIEW"));
}

#[test]
fn quoted_table_name_with_quote_and_space() {
    let db = Db::new();
    ok(&db.exec(
        "CREATE TABLE \"we\"\"ird name\"(a INTEGER); INSERT INTO \"we\"\"ird name\" VALUES(5)",
    ));
    let t = tree(&db);
    assert_eq!(t["tables"], json!(["we\"ird name"]));
    let i = info(&db, "we\"ird name");
    assert_eq!(i["columns"][0]["name"], "a");

    let r = table_rows(&db, "we\"ird name", 10);
    assert_eq!(ok(&r)["rows"], json!([["5"]]));
}

#[test]
fn injection_in_table_name_is_just_not_found() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a)"));
    let r = table_rows(&db, "t\"; DROP TABLE t; --", 10);
    assert_eq!(err_code(&r), "tableNotFound");
    assert_eq!(tree(&db)["tables"], json!(["t"]));
}

#[test]
fn table_not_found() {
    let db = Db::new();
    let r = call(
        "tableInfo",
        json!({"connId": db.conn, "schema": "main", "table": "nope"}),
    );
    assert_eq!(err_code(&r), "tableNotFound");
    assert_eq!(err_code(&table_rows(&db, "nope", 10)), "tableNotFound");
}

#[test]
fn table_rows_paginates_like_execute() {
    let db = Db::new();
    ok(&db.exec(&format!(
        "CREATE TABLE t(n); INSERT INTO t SELECT x FROM ({})",
        series(1201)
    )));
    let r = table_rows(&db, "t", 500);
    let st = ok(&r);
    assert_eq!(st["kind"], "rows");
    assert_eq!(st["rows"].as_array().unwrap().len(), 500);
    assert_eq!(st["done"], false);
    assert_eq!(st["columns"][0]["name"], "n");
    let cur = st["cursorId"].as_u64().unwrap();
    assert_eq!(
        ok(&fetch(db.conn, cur))["rows"].as_array().unwrap().len(),
        500
    );
    let last = fetch(db.conn, cur);
    assert_eq!(ok(&last)["rows"].as_array().unwrap().len(), 201);
    assert_eq!(ok(&last)["done"], true);
}

#[test]
fn table_rows_empty_table() {
    let db = Db::new();
    ok(&db.exec("CREATE TABLE t(a)"));
    let r = table_rows(&db, "t", 500);
    assert_eq!(ok(&r)["done"], true);
    assert_eq!(ok(&r)["rows"], json!([]));
}
