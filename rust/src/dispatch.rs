//! Chọn xử lý theo `method`; mọi kết quả (kể cả lỗi) thành một buffer JSON response.
//!
//! Vị trí trong luồng: `ffi::s3b_call` -> `call` (file này) -> `route` -> `drivers`
//! (`open`/`close`/`request`, các hàm này chọn driver).
//! Mỗi `method` parse `params` thành kiểu riêng trong `protocol`, gọi driver, rồi đóng gói
//! kết quả thành `{"ok":true,...}` hoặc `{"ok":false,"error":...}`.

use crate::drivers::{self, Cmd};
use crate::protocol::{
    ConnParams, DbError, DbResult, ExecuteParams, FetchParams, INVALID_REQUEST, OpenParams,
    Request, TableParams, TableRowsParams, error_response, ok_response,
};
use crate::runtime;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

/// Parse `params` JSON thành kiểu `T` mà method cần.
/// `T: DeserializeOwned` (generic có ràng buộc, giống interface của Go): `T` tự sở hữu dữ liệu,
/// không mượn từ chuỗi JSON gốc. Dấu `?` nghĩa là: nếu `Err` thì thoát hàm và trả lỗi đó ngay
/// (thay cho `if err != nil { return err }` của Go).
fn parse_params<T: DeserializeOwned>(raw: Option<&RawValue>) -> DbResult<T> {
    let raw = raw.ok_or_else(|| DbError::new(INVALID_REQUEST, "missing params"))?;
    serde_json::from_str(raw.get())
        .map_err(|e| DbError::new(INVALID_REQUEST, format!("invalid params: {e}")))
}

/// Gọi đúng handler theo `req.method`. `async fn` trả về một future: chỉ chạy khi được `.await`
/// (tokio lập lịch, tương tự goroutine). `&Request<'_>` mượn request, không copy.
/// Mỗi nhánh dùng `?` để đẩy lỗi nghiệp vụ lên `dispatch`.
async fn route(req: &Request<'_>) -> DbResult<Vec<u8>> {
    let id = req.id;
    let raw = req.params;
    match req.method.as_str() {
        "open" => Ok(ok_response(
            &drivers::open(parse_params::<OpenParams>(raw)?).await?,
        )),
        "close" => {
            let p: ConnParams = parse_params(raw)?;
            Ok(ok_response(&drivers::close(p.conn_id).await?))
        }
        "execute" => {
            let p: ExecuteParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = drivers::request(id, conn_id, p, Cmd::Execute).await?;
            Ok(ok_response(&r))
        }
        "fetch" => {
            let p: FetchParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = drivers::request(id, conn_id, p, Cmd::Fetch).await?;
            Ok(ok_response(&r))
        }
        "schemaTree" => {
            let p: ConnParams = parse_params(raw)?;
            let r = drivers::request(id, p.conn_id, (), Cmd::SchemaTree).await?;
            Ok(ok_response(&r))
        }
        "tableInfo" => {
            let p: TableParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = drivers::request(id, conn_id, p, Cmd::TableInfo).await?;
            Ok(ok_response(&r))
        }
        "tableRows" => {
            let p: TableRowsParams = parse_params(raw)?;
            let conn_id = p.conn_id;
            let r = drivers::request(id, conn_id, p, Cmd::TableRows).await?;
            Ok(ok_response(&r))
        }
        // Chỉ bản debug: để test thấy panic trong task tokio thành `internal`.
        #[cfg(debug_assertions)]
        "__panic" => panic!("test panic in task"),
        _ => Err(DbError::new(INVALID_REQUEST, "unknown method")),
    }
}

/// Xử lý một request JSON, luôn trả response JSON hợp lệ (JSON sai cũng thành lỗi `invalidRequest`).
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

/// Chạy `dispatch` trên runtime chung và chặn tới khi xong (hàm đồng bộ vì Go gọi qua C).
/// Panic trong handler thành lỗi `internal`.
pub fn call(req: Vec<u8>) -> Vec<u8> {
    // `let ... else`: nếu mẫu không khớp (runtime chưa init) thì chạy nhánh else và phải thoát.
    let Some(rt) = runtime::get() else {
        return error_response(&DbError::internal("library is not initialized"));
    };
    // Chỉ bản debug: panic ngoài task để test nhánh `catch_unwind` của `ffi.rs`.
    #[cfg(debug_assertions)]
    if serde_json::from_slice::<Request>(&req).is_ok_and(|r| r.method == "__panic_outer") {
        panic!("test panic outside task");
    }
    // Chạy trong task riêng: panic bị tokio bắt và hiện ra thành JoinError.
    // `spawn` cần future tự sở hữu dữ liệu (`'static`): `async move` chuyển `req` vào task thay vì mượn biến cục bộ.
    let task = rt.spawn(async move { dispatch(&req).await });
    match rt.block_on(task) {
        Ok(out) => out,
        Err(_) => error_response(&DbError::internal("request handler failed")),
    }
}
