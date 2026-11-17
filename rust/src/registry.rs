//! Registry connection (`connId` -> kênh tới actor + handle để interrupt) và
//! registry request (`id` -> `connId` + cờ huỷ) cho `s3b_cancel`.
//!
//! Vị trí trong luồng: `drivers::sqlite` đăng ký connection/request vào đây; `ffi::s3b_cancel`
//! tra ngược theo `id` để đặt cờ huỷ và ngắt câu SQL đang chạy.
//!
//! Dữ liệu dùng chung giữa nhiều thread nên bọc trong `Mutex` (khoá, giống `sync.Mutex` nhưng
//! dữ liệu nằm *bên trong* khoá nên không thể quên lock) và `Arc` (con trỏ đếm tham chiếu để
//! nhiều bên cùng giữ một giá trị, giống con trỏ chung trong Go).

use crate::drivers::sqlite::{Cmd, raw::InterruptHandle};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use tokio::sync::mpsc;

/// Thông tin của một connection đang mở.
struct ConnEntry {
    /// Kênh gửi lệnh tới actor của connection (`mpsc` = nhiều bên gửi, một bên nhận; giống `chan` của Go).
    tx: mpsc::Sender<Cmd>,
    /// Dùng để ngắt câu SQL đang chạy từ thread khác.
    interrupt: InterruptHandle,
    /// Id request actor đang chạy (0 = rỗi); đọc/ghi dưới lock `conns` để `cancel` không ngắt nhầm.
    running: u64,
}

/// Bảng tra toàn cục: connection theo `connId`, request theo `id`.
/// `#[derive(Default)]` tự sinh giá trị rỗng ban đầu.
#[derive(Default)]
pub struct Registry {
    conns: Mutex<HashMap<u64, ConnEntry>>,
    /// `id` request -> (`connId`, cờ huỷ). Cờ `AtomicBool` đọc/ghi được từ nhiều thread không cần khoá.
    requests: Mutex<HashMap<u64, (u64, Arc<AtomicBool>)>>,
    /// Bộ đếm sinh `connId`.
    next_conn: AtomicU64,
}

/// Khoá mutex và lấy dữ liệu bên trong; khoá được tự nhả khi `MutexGuard` ra khỏi phạm vi
/// (RAII, không cần `defer Unlock`).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Không giữ lock khi chạy code người dùng nên poison chỉ do panic ngoài ý muốn; dữ liệu vẫn nhất quán.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Registry duy nhất của tiến trình, tạo lười ở lần gọi đầu.
pub fn global() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

impl Registry {
    /// Cấp `connId` mới (bắt đầu từ 1). `Relaxed` đủ vì chỉ cần id không trùng, không cần thứ tự với biến khác.
    pub fn next_conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Đăng ký connection mới với `running = 0` (rỗi).
    pub fn add_conn(&self, id: u64, tx: mpsc::Sender<Cmd>, interrupt: InterruptHandle) {
        lock(&self.conns).insert(
            id,
            ConnEntry {
                tx,
                interrupt,
                running: 0,
            },
        );
    }

    /// Lấy bản sao `Sender` của connection (clone rẻ); `None` nếu connection đã đóng.
    pub fn conn_tx(&self, id: u64) -> Option<mpsc::Sender<Cmd>> {
        lock(&self.conns).get(&id).map(|c| c.tx.clone())
    }

    /// Actor báo request `request_id` bắt đầu chạy (0 = xong); conn đã bị gỡ thì bỏ qua.
    pub fn set_running(&self, conn_id: u64, request_id: u64) {
        if let Some(entry) = lock(&self.conns).get_mut(&conn_id) {
            entry.running = request_id;
        }
    }

    /// Xoá connection khỏi registry; sau lệnh này không còn interrupt nào tới handle của nó.
    /// Nếu `interrupt_first`, ngắt câu đang chạy để lệnh đóng không phải chờ.
    pub fn remove_conn(&self, id: u64, interrupt_first: bool) -> Option<mpsc::Sender<Cmd>> {
        let mut conns = lock(&self.conns);
        let entry = conns.remove(&id)?;
        if interrupt_first {
            // Còn giữ lock nên connection chưa thể bị đóng.
            entry.interrupt.interrupt();
        }
        Some(entry.tx)
    }

    /// Đăng ký request; guard tự gỡ khi xong, `flag` là cờ huỷ của request.
    // `&'static self`: guard giữ tham chiếu tới registry nên registry phải sống suốt chương trình.
    pub fn begin_request(&'static self, id: u64, conn_id: u64) -> RequestGuard {
        let flag = Arc::new(AtomicBool::new(false));
        lock(&self.requests).insert(id, (conn_id, flag.clone()));
        RequestGuard {
            registry: self,
            id,
            flag,
        }
    }

    /// Đặt cờ huỷ; chỉ interrupt khi chính request này đang chạy (interrupt tác động cả connection).
    /// Request còn xếp hàng sẽ tự trả `cancelled` khi actor lấy ra. Id lạ thì bỏ qua.
    pub fn cancel(&self, id: u64) {
        let found = lock(&self.requests)
            .get(&id)
            .map(|(conn_id, flag)| (*conn_id, flag.clone()));
        let Some((conn_id, flag)) = found else {
            return;
        };
        flag.store(true, Ordering::SeqCst);
        // Interrupt dưới lock conns: `remove_conn` và `set_running` cần cùng lock này.
        // (`if let ... && ...`: vừa khớp mẫu `Some` vừa kiểm điều kiện.)
        if let Some(entry) = lock(&self.conns).get(&conn_id)
            && entry.running == id
        {
            entry.interrupt.interrupt();
        }
    }
}

/// Giữ request đã đăng ký; hết phạm vi thì tự gỡ khỏi registry (xem `Drop` bên dưới).
pub struct RequestGuard {
    registry: &'static Registry,
    id: u64,
    /// Cờ huỷ của request, `cancel` đặt thành `true`.
    pub flag: Arc<AtomicBool>,
}

/// `Drop` chạy tự động khi giá trị bị huỷ (kể cả khi lỗi hay panic), giống `defer` của Go:
/// đảm bảo request luôn được gỡ khỏi bảng.
impl Drop for RequestGuard {
    fn drop(&mut self) {
        lock(&self.registry.requests).remove(&self.id);
    }
}
