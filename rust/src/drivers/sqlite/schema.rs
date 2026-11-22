//! Đọc schema SQLite cho cây đối tượng và màn hình cấu trúc table.
//!
//! Vị trí trong luồng: `actor` gọi `schema_tree`/`table_info`/`table_exists` khi nhận lệnh
//! `schemaTree`, `tableInfo`, `tableRows`; dữ liệu lấy từ `sqlite_master` và các `pragma_*`
//! rồi đóng vào kiểu của `protocol`.

use super::actor::map_sqlx;
use crate::protocol::{
    ColumnInfo, ConstraintInfo, DbError, ForeignKeyInfo, IndexInfo, NamedOn, SchemaNode,
    SchemaTreeResult, TABLE_NOT_FOUND, TableInfoResult,
};
use sqlparser::ast::{ColumnOption, Statement, TableConstraint};
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;
use sqlx::AssertSqlSafe;
use sqlx::sqlite::SqliteConnection;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::AtomicBool;

/// Lỗi khi đọc schema: không thấy table, hoặc lỗi từ sqlx. `enum` là kiểu "một trong các biến thể".
pub enum SchemaError {
    NotFound,
    Sqlx(sqlx::Error),
}

impl SchemaError {
    /// Đổi sang `DbError` của protocol; `self` (không có `&`) nghĩa là hàm tiêu thụ chính giá trị này.
    /// `cancel` để lỗi do bị huỷ thành `cancelled` thay vì `sqlError`.
    pub fn into_db(self, cancel: &AtomicBool) -> DbError {
        match self {
            Self::NotFound => DbError::new(TABLE_NOT_FOUND, "table does not exist"),
            Self::Sqlx(e) => map_sqlx(e, cancel),
        }
    }
}

/// Cho phép dấu `?` tự đổi `sqlx::Error` thành `SchemaError` trong các hàm bên dưới.
impl From<sqlx::Error> for SchemaError {
    fn from(e: sqlx::Error) -> Self {
        Self::Sqlx(e)
    }
}

/// Đặt tên vào dấu `"` theo chuẩn SQL, `"` bên trong được nhân đôi.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Cây đối tượng của database `main`; bỏ đối tượng nội bộ `sqlite_%`.
pub async fn schema_tree(conn: &mut SqliteConnection) -> Result<SchemaTreeResult, SchemaError> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT type, name, tbl_name FROM main.sqlite_master \
         WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' \
         AND type IN ('table', 'view', 'index', 'trigger') \
         ORDER BY name COLLATE NOCASE",
    )
    .persistent(false)
    .fetch_all(&mut *conn)
    .await?;

    let mut node = SchemaNode {
        name: "main".to_owned(),
        tables: Vec::new(),
        views: Vec::new(),
        indexes: Vec::new(),
        triggers: Vec::new(),
    };
    for (kind, name, table) in rows {
        match kind.as_str() {
            "table" => node.tables.push(name),
            "view" => node.views.push(name),
            "index" => node.indexes.push(NamedOn { name, table }),
            _ => node.triggers.push(NamedOn { name, table }),
        }
    }
    Ok(SchemaTreeResult {
        schemas: vec![node],
    })
}

/// Tìm table/view `table` trong `schema`: trả `(type, ddl)` hoặc `None` nếu không có.
/// `schema` được `quote_ident` vì không bind được tên schema bằng tham số `?`; tên table thì bind.
async fn find_table(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<Option<(String, Option<String>)>, sqlx::Error> {
    let sql = format!(
        "SELECT type, sql FROM {}.sqlite_master WHERE name = ?1 AND type IN ('table', 'view')",
        quote_ident(schema)
    );
    sqlx::query_as(AssertSqlSafe(sql))
        .bind(table)
        .persistent(false)
        .fetch_optional(&mut *conn)
        .await
}

/// `true` nếu table/view tồn tại (dùng trước `SELECT *` để báo `tableNotFound` rõ ràng).
pub async fn table_exists(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<bool, SchemaError> {
    Ok(find_table(conn, schema, table).await?.is_some())
}

/// Cấu trúc table/view: cột, index, khoá ngoại, ràng buộc và DDL. Lỗi `NotFound` nếu không có.
pub async fn table_info(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<TableInfoResult, SchemaError> {
    let (kind, ddl) = find_table(conn, schema, table)
        .await?
        .ok_or(SchemaError::NotFound)?;

    // hidden = 1 là cột ẩn của virtual table; 2/3 là cột generated vẫn hiển thị.
    let column_rows: Vec<(i64, String, String, i64, Option<String>, i64)> = sqlx::query_as(
        "SELECT cid, name, type, \"notnull\", dflt_value, pk \
         FROM pragma_table_xinfo(?1, ?2) WHERE hidden <> 1 ORDER BY cid",
    )
    .bind(table)
    .bind(schema)
    .persistent(false)
    .fetch_all(&mut *conn)
    .await?;
    let columns: Vec<ColumnInfo> = column_rows
        .into_iter()
        .map(|(cid, name, ty, not_null, default_value, pk)| ColumnInfo {
            cid,
            name,
            ty,
            not_null: not_null != 0,
            default_value,
            pk,
        })
        .collect();

    // View không có index, FK, constraint.
    let (indexes, foreign_keys) = if kind == "table" {
        (
            read_indexes(conn, schema, table).await?,
            read_foreign_keys(conn, schema, table).await?,
        )
    } else {
        (Vec::new(), Vec::new())
    };

    let mut constraints = Vec::new();
    let mut pk: Vec<&ColumnInfo> = columns.iter().filter(|c| c.pk > 0).collect();
    pk.sort_by_key(|c| c.pk);
    if !pk.is_empty() {
        constraints.push(ConstraintInfo {
            kind: "PRIMARY KEY",
            name: None,
            columns: pk.iter().map(|c| c.name.clone()).collect(),
            expression: None,
        });
    }
    for idx in indexes.iter().filter(|i| i.origin == "u") {
        constraints.push(ConstraintInfo {
            kind: "UNIQUE",
            name: None,
            columns: idx.columns.clone(),
            expression: None,
        });
    }
    if kind == "table"
        && let Some(ddl) = &ddl
    {
        constraints.extend(check_constraints(ddl));
    }

    Ok(TableInfoResult {
        columns,
        indexes,
        constraints,
        foreign_keys,
        ddl,
    })
}

/// Danh sách index của table kèm các cột khoá của từng index.
async fn read_indexes(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, sqlx::Error> {
    let list: Vec<(String, i64, String, i64)> = sqlx::query_as(
        "SELECT name, \"unique\", origin, partial FROM pragma_index_list(?1, ?2) ORDER BY seq",
    )
    .bind(table)
    .bind(schema)
    .persistent(false)
    .fetch_all(&mut *conn)
    .await?;

    let mut out = Vec::with_capacity(list.len());
    for (name, unique, origin, partial) in list {
        // key = 1: chỉ cột khoá (bỏ cột phụ của covering index); name NULL là biểu thức.
        let cols: Vec<(Option<String>,)> = sqlx::query_as(
            "SELECT name FROM pragma_index_xinfo(?1, ?2) WHERE \"key\" = 1 ORDER BY seqno",
        )
        .bind(&name)
        .bind(schema)
        .persistent(false)
        .fetch_all(&mut *conn)
        .await?;
        out.push(IndexInfo {
            columns: cols
                .into_iter()
                .map(|(c,)| c.unwrap_or_else(|| "(expression)".to_owned()))
                .collect(),
            name,
            unique: unique != 0,
            origin,
            partial: partial != 0,
        });
    }
    Ok(out)
}

/// Danh sách khoá ngoại của table; nhiều cột cùng `id` gom thành một khoá.
async fn read_foreign_keys(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<ForeignKeyInfo>, sqlx::Error> {
    let rows: Vec<(i64, String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT id, \"table\", \"from\", \"to\", on_update, on_delete \
         FROM pragma_foreign_key_list(?1, ?2) ORDER BY id, seq",
    )
    .bind(table)
    .bind(schema)
    .persistent(false)
    .fetch_all(&mut *conn)
    .await?;

    // Mỗi FK nhiều cột là nhiều dòng liên tiếp cùng `id`.
    let mut out: Vec<ForeignKeyInfo> = Vec::new();
    for (id, ref_table, from, to, on_update, on_delete) in rows {
        match out.last_mut() {
            Some(fk) if fk.id == id => {
                fk.columns.push(from);
                fk.ref_columns.extend(to);
            }
            _ => out.push(ForeignKeyInfo {
                id,
                columns: vec![from],
                ref_table,
                ref_columns: to.into_iter().collect(),
                on_update,
                on_delete,
            }),
        }
    }
    Ok(out)
}

/// CHECK lấy từ DDL bằng `sqlparser`; không parse được thì trả rỗng (PK/UNIQUE vẫn lấy từ PRAGMA).
/// `pub(crate)`: chỉ dùng được trong crate này.
pub(crate) fn check_constraints(ddl: &str) -> Vec<ConstraintInfo> {
    // Parser ngoài: chặn panic để không làm chết actor của connection. `AssertUnwindSafe` báo compiler
    // rằng closure này an toàn khi panic (ta bỏ kết quả nếu panic).
    let parsed = catch_unwind(AssertUnwindSafe(|| {
        Parser::parse_sql(&SQLiteDialect {}, ddl)
    }));
    // Lớp ngoài: có panic hay không; lớp trong: parse thành công hay không.
    let Ok(Ok(statements)) = parsed else {
        return Vec::new();
    };
    let Some(Statement::CreateTable(create)) = statements.into_iter().next() else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for column in &create.columns {
        for opt in &column.options {
            if let ColumnOption::Check(check) = &opt.option {
                out.push(ConstraintInfo {
                    kind: "CHECK",
                    name: opt
                        .name
                        .as_ref()
                        .or(check.name.as_ref())
                        .map(|n| n.value.clone()),
                    columns: vec![column.name.value.clone()],
                    expression: Some(check.expr.to_string()),
                });
            }
        }
    }
    for constraint in &create.constraints {
        if let TableConstraint::Check(check) = constraint {
            out.push(ConstraintInfo {
                kind: "CHECK",
                name: check.name.as_ref().map(|n| n.value.clone()),
                columns: Vec::new(),
                expression: Some(check.expr.to_string()),
            });
        }
    }
    out
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/sqlite/schema.rs"]
mod tests;
