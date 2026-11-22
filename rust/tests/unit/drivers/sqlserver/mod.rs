use super::*;
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream as StdTcpStream};
use std::sync::mpsc;

const PASSWORD: &str = "super-secret-pw";
/// Giá trị byte ENCRYPTION của TDS PRELOGIN.
/// Mức mã hoá client gửi khi `plain` (`EncryptionLevel::Off`): chỉ mã hoá LOGIN7.
const OFF: u8 = 0;
const NOT_SUPPORTED: u8 = 2;
const REQUIRED: u8 = 3;

fn params(v: serde_json::Value) -> OpenParams {
    serde_json::from_value(v).expect("params hợp lệ")
}

fn open_params(port: u16, mode: &str) -> OpenParams {
    params(json!({
        "driver": "sqlserver", "host": "127.0.0.1", "port": port,
        "username": "sa", "password": PASSWORD, "tls": {"mode": mode}
    }))
}

fn fx(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

/// `open` phải lỗi: trả `DbError`.
async fn open_err(p: OpenParams) -> DbError {
    match open(p).await {
        Err(e) => e,
        Ok(_) => panic!("open không được thành công với server giả"),
    }
}

// ---- server PRELOGIN giả ----

/// Đọc gói PRELOGIN của client, trả byte ENCRYPTION client xin. Gói TDS: 8 byte header (độ dài
/// big-endian ở byte 2-3) rồi bảng option `token(1) offset(2) length(2)`... kết thúc bằng 0xFF.
fn read_prelogin_encryption(s: &mut StdTcpStream) -> Option<u8> {
    let mut head = [0u8; 8];
    s.read_exact(&mut head).ok()?;
    let total = usize::from(u16::from_be_bytes([head[2], head[3]]));
    let mut body = vec![0u8; total.checked_sub(8)?];
    s.read_exact(&mut body).ok()?;
    let mut i = 0;
    while *body.get(i)? != 0xFF {
        let offset = usize::from(u16::from_be_bytes([body[i + 1], body[i + 2]]));
        if body[i] == 0x01 {
            return body.get(offset).copied();
        }
        i += 5;
    }
    None
}

/// Trả lời PRELOGIN: VERSION (6 byte) + ENCRYPTION = `level`.
fn write_prelogin_reply(s: &mut StdTcpStream, level: u8) {
    let mut body = vec![0x00, 0, 11, 0, 6, 0x01, 0, 17, 0, 1, 0xFF];
    body.extend_from_slice(&[0x10, 0, 0, 0, 0, 0]);
    body.push(level);
    let total = u16::try_from(8 + body.len()).unwrap();
    let mut packet = vec![0x04, 0x01];
    packet.extend_from_slice(&total.to_be_bytes());
    packet.extend_from_slice(&[0, 0, 1, 0]);
    packet.extend_from_slice(&body);
    let _ = s.write_all(&packet);
}

/// Server nghe PRELOGIN, báo lại byte ENCRYPTION của client qua kênh, trả lời `reply` rồi đóng
/// socket (nên mọi lần nối đều lỗi). Thread chạy tới hết process test.
fn fake_server(reply: u8) -> (u16, mpsc::Receiver<u8>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            if let Some(level) = read_prelogin_encryption(&mut stream) {
                let _ = tx.send(level);
                write_prelogin_reply(&mut stream, reply);
            }
        }
    });
    (port, rx)
}

/// Server nhận TCP nhưng im lặng (để thử timeout). Giữ socket mở tới hết process.
fn silent_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming().flatten() {
            held.push(stream);
        }
    });
    port
}

/// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

// ---- open: kiểm input ----

#[tokio::test]
async fn open_requires_host_and_username() {
    let base = |v: serde_json::Value| {
        let mut p = json!({"driver": "sqlserver", "host": "h", "username": "sa"});
        p.as_object_mut()
            .unwrap()
            .extend(v.as_object().unwrap().clone());
        params(p)
    };
    for (p, what) in [
        (base(json!({"host": null})), "host null"),
        (base(json!({"host": ""})), "host rỗng"),
        (base(json!({"username": null})), "username null"),
        (base(json!({"username": ""})), "username rỗng"),
    ] {
        let e = open_err(p).await;
        assert_eq!(e.code, INVALID_REQUEST, "{what}");
    }
    // Thiếu hẳn field.
    let e = open_err(params(json!({"driver": "sqlserver"}))).await;
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "missing host");
    let e = open_err(params(json!({"driver": "sqlserver", "host": "h"}))).await;
    assert_eq!(e.message, "missing username");
}

#[tokio::test]
async fn open_does_not_touch_the_network_when_input_is_invalid() {
    let (port, rx) = fake_server(NOT_SUPPORTED);
    let e = open_err(params(
        json!({"driver": "sqlserver", "host": "127.0.0.1", "port": port}),
    ))
    .await;
    assert_eq!(e.code, INVALID_REQUEST);
    assert!(rx.try_recv().is_err(), "không được nối khi thiếu username");
}

// ---- open: thứ tự thử theo từng mode ----

#[tokio::test]
async fn each_tls_mode_tries_the_encryption_levels_in_libpq_order() {
    let cases: [(&str, &[u8]); 6] = [
        ("disable", &[OFF]),
        ("allow", &[OFF, REQUIRED]),
        ("prefer", &[REQUIRED, OFF]),
        ("require", &[REQUIRED]),
        ("verify-ca", &[REQUIRED]),
        ("verify-full", &[REQUIRED]),
    ];
    for (mode, want) in cases {
        let (port, rx) = fake_server(NOT_SUPPORTED);
        let e = open_err(open_params(port, mode)).await;
        assert_eq!(e.code, OPEN_FAILED, "{mode}");
        assert!(!e.message.contains(PASSWORD), "{mode}: {}", e.message);
        let seen: Vec<u8> = rx.try_iter().collect();
        assert_eq!(seen, want, "{mode}");
    }
}

#[tokio::test]
async fn the_error_of_the_last_attempt_is_returned() {
    // Server không nhận TLS: lần thử cuối của `allow` là TLS nên báo lỗi mã hoá;
    // của `prefer` là không TLS nên không phải lỗi mã hoá.
    let (port, _rx) = fake_server(NOT_SUPPORTED);
    let allow = open_err(open_params(port, "allow")).await;
    assert!(
        allow
            .message
            .contains("does not allow the requested encryption"),
        "{}",
        allow.message
    );
    let (port, _rx) = fake_server(NOT_SUPPORTED);
    let require = open_err(open_params(port, "require")).await;
    assert!(
        require
            .message
            .contains("does not allow the requested encryption"),
        "{}",
        require.message
    );
    let (port, _rx) = fake_server(NOT_SUPPORTED);
    let prefer = open_err(open_params(port, "prefer")).await;
    assert!(
        !prefer
            .message
            .contains("does not allow the requested encryption"),
        "{}",
        prefer.message
    );
}

#[tokio::test]
async fn open_to_a_closed_port_is_open_failed_without_the_password() {
    // Một mode là đủ: Windows mất ~2 giây cho mỗi lần nối bị từ chối.
    let e = open_err(open_params(closed_port(), "require")).await;
    assert_eq!(e.code, OPEN_FAILED);
    assert!(!e.message.is_empty());
    assert_ne!(e.message, "connection timed out");
    assert!(!e.message.contains(PASSWORD), "{}", e.message);
}

#[tokio::test(start_paused = true)]
async fn open_to_a_silent_server_times_out_after_the_connect_limit() {
    let port = silent_server();
    let e = open_err(open_params(port, "disable")).await;
    assert_eq!(e.code, OPEN_FAILED);
    assert_eq!(e.message, "connection timed out");
}

#[tokio::test(start_paused = true)]
async fn open_timeout_covers_all_attempts_together_not_each_one() {
    // `allow` có 2 lần thử nhưng chỉ có MỘT hạn 10 giây cho cả hai.
    let port = silent_server();
    let start = tokio::time::Instant::now();
    let e = open_err(open_params(port, "allow")).await;
    assert_eq!(e.message, "connection timed out");
    assert!(start.elapsed() < CONNECT_TIMEOUT + Duration::from_secs(1));
}

#[tokio::test(start_paused = true)]
async fn reconnect_times_out_and_fails_like_open() {
    let port = silent_server();
    let configs = attempts(&open_params(port, "disable"), "127.0.0.1", "sa").unwrap();
    let e = reconnect(&configs[0]).await.expect_err("phải lỗi");
    assert_eq!(e.code, OPEN_FAILED);
    assert_eq!(e.message, "connection timed out");

    let configs = attempts(&open_params(closed_port(), "disable"), "127.0.0.1", "sa").unwrap();
    let e = reconnect(&configs[0]).await.expect_err("phải lỗi");
    assert_eq!(e.code, OPEN_FAILED);
    assert!(!e.message.contains(PASSWORD));
}

// ---- caFile ----

#[tokio::test]
async fn verify_modes_reject_a_bad_ca_file_before_connecting_and_without_leaking_it() {
    let junk_dir = std::env::temp_dir().join(format!("s3b_mssql_ca_{}", std::process::id()));
    std::fs::create_dir_all(&junk_dir).unwrap();
    let junk = junk_dir.join("junk.pem");
    std::fs::write(&junk, "this is not a certificate SECRET-CONTENT").unwrap();
    let junk = junk.to_string_lossy().into_owned();
    let missing = "Z:/khong/ton/tai/secret-name.pem".to_owned();

    for mode in ["verify-ca", "verify-full"] {
        for ca in [&junk, &missing] {
            let (port, rx) = fake_server(NOT_SUPPORTED);
            let mut p = open_params(port, mode);
            p.tls.ca_file = Some(ca.clone());
            let e = open_err(p).await;
            assert_eq!(e.code, OPEN_FAILED, "{mode} {ca}");
            assert!(e.message.contains("caFile"), "{mode} {ca}: {}", e.message);
            assert!(!e.message.contains("SECRET-CONTENT"), "{}", e.message);
            assert!(!e.message.contains("secret-name"), "{}", e.message);
            assert!(!e.message.contains(PASSWORD), "{}", e.message);
            assert!(
                rx.try_recv().is_err(),
                "{mode}: không được nối khi caFile hỏng"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&junk_dir);
}

#[test]
fn ca_file_is_ignored_unless_the_mode_verifies() {
    for mode in ["disable", "allow", "prefer", "require"] {
        let mut p = open_params(1, mode);
        p.tls.ca_file = Some("Z:/khong/ton/tai.pem".to_owned());
        assert!(attempts(&p, "h", "sa").is_ok(), "{mode}");
    }
}

#[test]
fn verify_modes_add_every_usable_ca_of_the_file_as_a_bundle() {
    for mode in ["verify-ca", "verify-full"] {
        let mut p = open_params(1, mode);
        p.tls.ca_file = Some(fx("ca.pem"));
        let tries = attempts(&p, "h", "sa").unwrap();
        assert_eq!(tries.len(), 1, "{mode}");
        let d = format!("{:?}", tries[0]);
        assert!(d.contains("Bundle { len:"), "{mode}: {d}");
        assert!(d.contains("bypass: false"), "{mode}: {d}");
        assert!(d.contains("encryption: Required"), "{mode}: {d}");
    }
}

#[test]
fn verify_modes_without_ca_file_use_the_system_store_only() {
    let tries = attempts(&open_params(1, "verify-full"), "h", "sa").unwrap();
    let d = format!("{:?}", tries[0]);
    assert!(d.contains("extra_cas: []"), "{d}");
    assert!(d.contains("bypass: false"), "{d}");
    // Rỗng như không đặt.
    let mut p = open_params(1, "verify-full");
    p.tls.ca_file = Some(String::new());
    let tries = attempts(&p, "h", "sa").unwrap();
    assert!(format!("{:?}", tries[0]).contains("extra_cas: []"));
}

// ---- attempts: ánh xạ mode sang cấu hình tiberius ----

#[test]
fn modes_map_to_encryption_level_and_trust() {
    let enc = |c: &Config| {
        let d = format!("{c:?}");
        let level = if d.contains("encryption: Off") {
            "off"
        } else if d.contains("encryption: Required") {
            "required"
        } else {
            "other"
        };
        (level, d.contains("bypass: true"))
    };
    let run = |mode: &str| -> Vec<(&str, bool)> {
        attempts(&open_params(1, mode), "h", "sa")
            .unwrap()
            .iter()
            .map(enc)
            .collect()
    };
    // B6: `plain` là `Off` + `trust_cert` (LOGIN7 vẫn qua TLS), không còn `NotSupported`.
    assert_eq!(run("disable"), [("off", true)]);
    assert_eq!(run("allow"), [("off", true), ("required", true)]);
    assert_eq!(run("prefer"), [("required", true), ("off", true)]);
    assert_eq!(run("require"), [("required", true)]);
    assert_eq!(run("verify-ca"), [("required", false)]);
    assert_eq!(run("verify-full"), [("required", false)]);
}

#[test]
fn config_carries_host_port_database_packet_size_and_app_name() {
    let p = params(json!({
        "driver": "sqlserver", "host": "db.example", "port": 14330, "database": "shop",
        "username": "sa", "password": PASSWORD
    }));
    let c = &attempts(&p, "db.example", "sa").unwrap()[0];
    let d = format!("{c:?}");
    assert!(d.contains("db.example"), "{d}");
    assert!(d.contains("14330"), "{d}");
    assert!(d.contains("\"shop\""), "{d}");
    assert!(d.contains("32767"), "{d}");
    assert!(d.contains("S3Browser"), "{d}");
    assert_eq!(c.get_addr(), "db.example:14330");
}

#[test]
fn defaults_are_port_1433_and_the_login_database() {
    let p = params(json!({"driver": "sqlserver", "host": "h", "username": "sa"}));
    let c = &attempts(&p, "h", "sa").unwrap()[0];
    assert_eq!(c.get_addr(), "h:1433");
    // Database rỗng không được ghi đè database mặc định của tài khoản.
    let p = params(json!({
        "driver": "sqlserver", "host": "h", "username": "sa", "database": ""
    }));
    let c = &attempts(&p, "h", "sa").unwrap()[0];
    assert!(format!("{c:?}").contains("database: None"), "{c:?}");
}

#[test]
fn config_debug_does_not_print_the_password() {
    // Ta không bao giờ in `Config`, nhưng chắc chắn hơn nếu lỡ có `{:?}` ở đâu đó.
    for mode in ["disable", "allow", "verify-full"] {
        for c in attempts(&open_params(1, mode), "h", "sa").unwrap() {
            assert!(!format!("{c:?}").contains(PASSWORD), "{mode}");
        }
    }
}

// ---- error_text ----

#[test]
fn error_text_of_non_server_errors_is_their_display_text() {
    let io = TdsError::Io {
        kind: std::io::ErrorKind::ConnectionReset,
        message: "reset by peer".to_owned(),
    };
    assert_eq!(error_text(&io), io.to_string());
    assert!(error_text(&io).contains("reset by peer"));
    let proto = TdsError::Protocol("bad token".into());
    assert_eq!(error_text(&proto), proto.to_string());
    assert!(error_text(&proto).contains("bad token"));
    let tls = TdsError::Tls("handshake failed".to_owned());
    assert!(error_text(&tls).contains("handshake failed"));
}

#[test]
fn no_interrupt_does_nothing() {
    NoInterrupt.interrupt();
}
