//! Chống lỗi "CryptoProvider" của driver SQL Server, trong một tiến trình test RIÊNG (mỗi file
//! `tests/*.rs` là một binary): ở đây KHÔNG ai gọi `s3b_init`/`install_provider` trước.
//!
//! Vì sao cần: cây phụ thuộc có cả `ring` (ta dùng) lẫn `aws-lc-rs` (kéo bởi `tokio-rustls` của
//! `tiberius`). Process chưa có provider mặc định thì rustls hoặc `tiberius` tự chọn một cái
//! (có thể panic "Could not automatically determine the process-level CryptoProvider", hoặc lặng
//! lẽ dùng `aws-lc-rs`). `tiberius` dựng `ClientConfig` ngay khi server đồng ý mã hoá, nên `open`
//! phải tự cài `ring` trước. Test nối tới server PRELOGIN giả (trả lời "bắt buộc mã hoá") để
//! `tiberius` đi vào đường dựng TLS, rồi server đóng socket: kết quả đúng là `openFailed`, không
//! panic, và provider mặc định của process là `ring`.
//!
//! Chỉ có MỘT test trong file này: nếu có nhiều test chạy song song thì test khác có thể đã cài
//! provider trước, làm assert "open tự cài" mất ý nghĩa.

use s3b_db::drivers::sqlserver;
use s3b_db::protocol::OpenParams;
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

/// Byte ENCRYPTION của TDS: server bắt buộc mã hoá.
const ENCRYPT_REQ: u8 = 3;
const PASSWORD: &str = "provider-test-pw";

/// Đọc hết gói PRELOGIN của client (8 byte header, độ dài big-endian ở byte 2-3).
fn read_prelogin(s: &mut TcpStream) -> bool {
    let mut head = [0u8; 8];
    if s.read_exact(&mut head).is_err() {
        return false;
    }
    let total = usize::from(u16::from_be_bytes([head[2], head[3]]));
    let mut body = vec![0u8; total.saturating_sub(8)];
    s.read_exact(&mut body).is_ok()
}

/// Trả lời PRELOGIN: VERSION (6 byte) + ENCRYPTION = `ENCRYPT_REQ`.
fn write_prelogin_reply(s: &mut TcpStream) {
    let mut body = vec![0x00, 0, 11, 0, 6, 0x01, 0, 17, 0, 1, 0xFF];
    body.extend_from_slice(&[0x10, 0, 0, 0, 0, 0]);
    body.push(ENCRYPT_REQ);
    let total = u16::try_from(8 + body.len()).unwrap();
    let mut packet = vec![0x04, 0x01];
    packet.extend_from_slice(&total.to_be_bytes());
    packet.extend_from_slice(&[0, 0, 1, 0]);
    packet.extend_from_slice(&body);
    let _ = s.write_all(&packet);
}

/// Server giả: nhận PRELOGIN, đòi mã hoá, đọc nốt `ClientHello` rồi đóng. Chạy tới hết process.
fn fake_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            if read_prelogin(&mut stream) {
                write_prelogin_reply(&mut stream);
                let mut hello = [0u8; 16];
                let _ = stream.read(&mut hello);
            }
        }
    });
    port
}

fn open_params(port: u16, mode: &str) -> OpenParams {
    serde_json::from_value(json!({
        "driver": "sqlserver", "host": "127.0.0.1", "port": port,
        "username": "sa", "password": PASSWORD, "tls": {"mode": mode}
    }))
    .unwrap()
}

#[test]
fn open_installs_ring_itself_and_never_panics_building_tls() {
    assert!(
        rustls::crypto::CryptoProvider::get_default().is_none(),
        "test này phải chạy khi process chưa có provider"
    );
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    // `require` đi đường bỏ qua kiểm chứng chỉ; `verify-full` đi đường kiểm chứng chỉ bằng kho
    // chứng chỉ của Windows. Cả hai đều phải dựng `ClientConfig` của rustls.
    for (i, mode) in ["require", "prefer", "verify-ca", "verify-full"]
        .into_iter()
        .enumerate()
    {
        let port = fake_server();
        let result = rt.block_on(sqlserver::open(open_params(port, mode)));
        let Err(err) = result else {
            panic!("{mode}: server giả không bao giờ cho đăng nhập");
        };
        assert_eq!(err.code, "openFailed", "{mode}: {}", err.message);
        assert!(
            !err.message.contains("CryptoProvider"),
            "{mode}: provider chưa được cài: {}",
            err.message
        );
        assert!(!err.message.contains(PASSWORD), "{mode}: {}", err.message);
        if i == 0 {
            // Ngay sau lần `open` đầu tiên provider mặc định phải là `ring`: so tập nhóm trao đổi
            // khoá (aws-lc-rs có thêm nhóm hậu lượng tử nên khác `ring`).
            let installed = rustls::crypto::CryptoProvider::get_default().expect("open phải cài");
            let ring = rustls::crypto::ring::default_provider();
            let names = |p: &rustls::crypto::CryptoProvider| {
                p.kx_groups
                    .iter()
                    .map(|g| format!("{:?}", g.name()))
                    .collect::<Vec<_>>()
            };
            assert_eq!(names(installed), names(&ring));
        }
    }
}
