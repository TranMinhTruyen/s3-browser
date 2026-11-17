//! Registry connection (`connId` -> kênh tới actor + handle để interrupt) và
//! registry request (`id` -> `connId` + cờ huỷ) cho `s3b_cancel`.

use crate::drivers::sqlite::{Cmd, raw::InterruptHandle};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use tokio::sync::mpsc;

struct ConnEntry {
    tx: mpsc::Sender<Cmd>,
    interrupt: InterruptHandle,
    /// Id request actor đang chạy (0 = rỗi); đọc/ghi dưới lock `conns` để `cancel` không ngắt nhầm.
    running: u64,
}

#[derive(Default)]
pub struct Registry {
    conns: Mutex<HashMap<u64, ConnEntry>>,
    requests: Mutex<HashMap<u64, (u64, Arc<AtomicBool>)>>,
    next_conn: AtomicU64,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Không giữ lock khi chạy code người dùng nên poison chỉ do panic ngoài ý muốn; dữ liệu vẫn nhất quán.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn global() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

impl Registry {
    pub fn next_conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed) + 1
    }

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
        if let Some(entry) = lock(&self.conns).get(&conn_id)
            && entry.running == id
        {
            entry.interrupt.interrupt();
        }
    }
}

pub struct RequestGuard {
    registry: &'static Registry,
    id: u64,
    pub flag: Arc<AtomicBool>,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        lock(&self.registry.requests).remove(&self.id);
    }
}
