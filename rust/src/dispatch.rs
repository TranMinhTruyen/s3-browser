//! Chọn xử lý theo `method`; mọi kết quả (kể cả lỗi) thành một buffer JSON response.

use crate::drivers::sqlite::{self, Cmd};
use crate::protocol::{
    ConnParams, DbError, DbResult, ExecuteParams, FetchParams, INVALID_REQUEST, OpenParams,
    Request, TableParams, TableRowsParams, error_response, ok_response,
};
use crate::runtime;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

fn parse_params<T: DeserializeOwned>(raw: Option<&RawValue>) -> DbResult<T> {
    let raw = raw.ok_or_else(|| DbError::new(INVALID_REQUEST, "missing params"))?;
    serde_json::from_str(raw.get())
        .map_err(|e| DbError::new(INVALID_REQUEST, format!("invalid params: {e}")))
}

async fn route(req: &Request<'_>) -> DbResult<Vec<u8>> {
    let id = req.id;
    let raw = req.params;
    match req.method.as_str() {
        "open" => Ok(ok_response(
            &sqlite::open(parse_params::<OpenParams>(raw)?).await?,
        )),
        "close" => {
            let p: ConnParams = parse_params(raw)?;
            Ok(ok_response(&sqlite::close(p.conn_id).await?))
        }
        "execute" => {
            let p: ExecuteParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = sqlite::request(id, conn_id, p, Cmd::Execute).await?;
            Ok(ok_response(&r))
        }
        "fetch" => {
            let p: FetchParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = sqlite::request(id, conn_id, p, Cmd::Fetch).await?;
            Ok(ok_response(&r))
        }
        "schemaTree" => {
            let p: ConnParams = parse_params(raw)?;
            let r = sqlite::request(id, p.conn_id, (), Cmd::SchemaTree).await?;
            Ok(ok_response(&r))
        }
        "tableInfo" => {
            let p: TableParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = sqlite::request(id, conn_id, p, Cmd::TableInfo).await?;
            Ok(ok_response(&r))
        }
        "tableRows" => {
            let p: TableRowsParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = sqlite::request(id, conn_id, p, Cmd::TableRows).await?;
            Ok(ok_response(&r))
        }
        // Chỉ bản debug: để test thấy panic trong task tokio thành `internal`.
        #[cfg(debug_assertions)]
        "__panic" => panic!("test panic in task"),
        _ => Err(DbError::new(INVALID_REQUEST, "unknown method")),
    }
}

/// Xử lý một request JSON, luôn trả response JSON hợp lệ.
pub async fn dispatch(req: &[u8]) -> Vec<u8> {
    let result = match serde_json::from_slice::<Request>(req) {
        Ok(req) => route(&req).await,
        Err(e) => Err(DbError::new(
            INVALID_REQUEST,
            format!("invalid request: {e}"),
        )),
    };
    result.unwrap_or_else(|e| error_response(&e))
}

/// Chạy `dispatch` trên runtime chung và chặn tới khi xong. Panic trong handler thành lỗi `internal`.
pub fn call(req: Vec<u8>) -> Vec<u8> {
    let Some(rt) = runtime::get() else {
        return error_response(&DbError::internal("library is not initialized"));
    };
    // Chỉ bản debug: panic ngoài task để test nhánh `catch_unwind` của `ffi.rs`.
    #[cfg(debug_assertions)]
    if serde_json::from_slice::<Request>(&req).is_ok_and(|r| r.method == "__panic_outer") {
        panic!("test panic outside task");
    }
    // Chạy trong task riêng: panic bị tokio bắt và hiện ra thành JoinError.
    let task = rt.spawn(async move { dispatch(&req).await });
    match rt.block_on(task) {
        Ok(out) => out,
        Err(_) => error_response(&DbError::internal("request handler failed")),
    }
}
