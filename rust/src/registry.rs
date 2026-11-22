//! Registry connection (`connId` -> kênh tới actor + cách ngắt câu đang chạy) và
//! registry request (`id` -> `connId` + tín hiệu huỷ) cho `s3b_cancel`.
//!
//! Vị trí trong luồng: `drivers::*` đăng ký connection/request vào đây; `ffi::s3b_cancel`
//! tra ngược theo `id` để phát tín hiệu huỷ và ngắt câu đang chạy.
//!
//! Dữ liệu dùng chung giữa nhiều thread nên bọc trong `Mutex` (khoá, giống `sync.Mutex` nhưng
//! dữ liệu nằm *bên trong* khoá nên không thể quên lock) và `Arc` (con trỏ đếm tham chiếu để
//! nhiều bên cùng giữ một giá trị, giống con trỏ chung trong Go).

use crate::drivers::Cmd;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use tokio::sync::{Notify, mpsc};

/// Tín hiệu huỷ của một request: một cờ để code đồng bộ (SQLite, vòng đọc dòng) kiểm giữa các
/// dòng, kèm `Notify` để đánh thức future đang `await` của driver mạng (không phải poll cờ).
///
/// `Notify` của tokio giống một chiếc chuông: `notify_waiters` đánh thức mọi task đang chờ.
/// Vì chuông chỉ báo cho người *đang* chờ nên người chờ phải đăng ký trước rồi mới đọc cờ
/// (xem `cancelled`), nếu không có thể lỡ tín hiệu phát đúng giữa hai bước đó.
#[derive(Default)]
pub struct CancelSignal {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelSignal {
    /// Tín hiệu mới, chưa huỷ.
    pub fn new() -> Self {
        Self::default()
    }

    /// Phát tín hiệu huỷ: đặt cờ rồi đánh thức mọi future đang chờ. `SeqCst` để thứ tự với
    /// việc đọc `running` trong `Registry::cancel` luôn nhất quán.
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// Request đã bị huỷ chưa.
    #[inline]
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Cờ thô, cho code đồng bộ chỉ cần kiểm `AtomicBool` (vòng đọc dòng của SQLite).
    #[inline]
    pub fn flag(&self) -> &AtomicBool {
        &self.flag
    }

    /// Future hoàn thành khi request bị huỷ (ngay lập tức nếu đã huỷ). Driver mạng dùng trong
    /// `tokio::select!` cùng future I/O: bên nào xong trước thì thắng, bên còn lại bị bỏ.
    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            // Đăng ký chờ TRƯỚC khi đọc cờ: `cancel` chạy giữa hai bước vẫn đánh thức được ta.
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

/// Cách ngắt câu đang chạy của một connection, gọi từ thread bất kỳ (thread của Go).
/// `trait` giống `interface` của Go: mỗi driver có một cài đặt riêng (SQLite gọi
/// `sqlite3_interrupt`, driver mạng huỷ phía server). Cài đặt không được chặn thread gọi.
pub trait Interrupt: Send + Sync {
    /// Ngắt câu đang chạy trên connection.
    fn interrupt(&self);
}

/// Thông tin của một connection đang mở.
struct ConnEntry {
    /// Tên driver (`sqlite`, `postgres`...), để từ chối method driver không hỗ trợ.
    driver: &'static str,
    /// Kênh gửi lệnh tới actor của connection (`mpsc` = nhiều bên gửi, một bên nhận; giống `chan` của Go).
    tx: mpsc::Sender<Cmd>,
    /// Dùng để ngắt câu đang chạy từ thread khác. `Arc<dyn Interrupt>`: con trỏ chung tới một
    /// giá trị bất kỳ cài `Interrupt` (tương tự biến kiểu interface của Go).
    interrupt: Arc<dyn Interrupt>,
    /// Id request actor đang chạy (0 = rỗi); đọc/ghi dưới lock `conns` để `cancel` không ngắt nhầm.
    running: u64,
}

/// Bảng tra toàn cục: connection theo `connId`, request theo `id`.
/// `#[derive(Default)]` tự sinh giá trị rỗng ban đầu.
#[derive(Default)]
pub struct Registry {
    conns: Mutex<HashMap<u64, ConnEntry>>,
    /// `id` request -> (`connId`, tín hiệu huỷ). Tín hiệu đọc/ghi được từ nhiều thread không cần khoá.
    requests: Mutex<HashMap<u64, (u64, Arc<CancelSignal>)>>,
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
    pub fn add_conn(
        &self,
        id: u64,
        driver: &'static str,
        tx: mpsc::Sender<Cmd>,
        interrupt: Arc<dyn Interrupt>,
    ) {
        lock(&self.conns).insert(
            id,
            ConnEntry {
                driver,
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

    /// Tên driver của connection; `None` nếu connection đã đóng.
    pub fn conn_driver(&self, id: u64) -> Option<&'static str> {
        lock(&self.conns).get(&id).map(|c| c.driver)
    }

    /// Actor báo request `request_id` bắt đầu chạy (0 = xong); conn đã bị gỡ thì bỏ qua.
    pub fn set_running(&self, conn_id: u64, request_id: u64) {
        if let Some(entry) = lock(&self.conns).get_mut(&conn_id) {
            entry.running = request_id;
        }
    }

    /// Xoá connection khỏi registry; sau lệnh này không còn interrupt nào tới handle của nó.
    /// Nếu `interrupt_first`, ngắt câu đang chạy và huỷ mọi request của connection để lệnh đóng
    /// không phải chờ (driver mạng chỉ dừng khi `CancelSignal` bật, không chỉ nhờ `interrupt`).
    pub fn remove_conn(&self, id: u64, interrupt_first: bool) -> Option<mpsc::Sender<Cmd>> {
        let tx = {
            let mut conns = lock(&self.conns);
            let entry = conns.remove(&id)?;
            if interrupt_first {
                // Còn giữ lock nên connection chưa thể bị đóng.
                entry.interrupt.interrupt();
            }
            entry.tx
        };
        if interrupt_first {
            // Đã nhả lock `conns` (không khoá lồng): bật cờ huỷ cho request đang chạy lẫn đang xếp hàng.
            for (conn_id, sig) in lock(&self.requests).values() {
                if *conn_id == id {
                    sig.cancel();
                }
            }
        }
        Some(tx)
    }

    /// Đăng ký request; guard tự gỡ khi xong, `flag` là tín hiệu huỷ của request.
    // `&'static self`: guard giữ tham chiếu tới registry nên registry phải sống suốt chương trình.
    pub fn begin_request(&'static self, id: u64, conn_id: u64) -> RequestGuard {
        let flag = Arc::new(CancelSignal::new());
        lock(&self.requests).insert(id, (conn_id, flag.clone()));
        RequestGuard {
            registry: self,
            id,
            flag,
        }
    }

    /// Phát tín hiệu huỷ; chỉ interrupt khi chính request này đang chạy (interrupt tác động cả
    /// connection). Request còn xếp hàng sẽ tự trả `cancelled` khi actor lấy ra. Id lạ thì bỏ qua.
    pub fn cancel(&self, id: u64) {
        let found = lock(&self.requests)
            .get(&id)
            .map(|(conn_id, flag)| (*conn_id, flag.clone()));
        let Some((conn_id, flag)) = found else {
            return;
        };
        flag.cancel();
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
    /// Tín hiệu huỷ của request, `cancel` phát tín hiệu này.
    pub flag: Arc<CancelSignal>,
}

/// `Drop` chạy tự động khi giá trị bị huỷ (kể cả khi lỗi hay panic), giống `defer` của Go:
/// đảm bảo request luôn được gỡ khỏi bảng.
impl Drop for RequestGuard {
    fn drop(&mut self) {
        lock(&self.registry.requests).remove(&self.id);
    }
}

#[cfg(test)]
#[path = "../tests/unit/registry.rs"]
mod tests;
