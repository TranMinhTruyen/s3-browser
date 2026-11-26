use super::*;
use crate::protocol::TlsParams;
use std::io::Read;
use std::net::TcpListener;
use std::sync::Mutex;

/// Server giả: ghi lại mỗi lần nối là `ssl` (client gửi SSLRequest) hay `plain` (gửi thẳng
/// StartupMessage). SSLRequest được trả `N` (không hỗ trợ TLS), còn lại đóng socket ngay.
/// Thread chặn ở `accept` tới hết process; cổng tự chọn nên các test không đụng nhau.
fn fake_server() -> (u16, Arc<Mutex<Vec<&'static str>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let log = Arc::new(Mutex::new(Vec::new()));
    let seen = log.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut head = [0u8; 8];
            if stream.read_exact(&mut head).is_err() {
                continue;
            }
            // Mã SSLRequest 80877103 = 0x04d2162f nằm ở byte 4..8.
            if head[4..8] == [0x04, 0xd2, 0x16, 0x2f] {
                seen.lock().unwrap().push("ssl");
                let _ = std::io::Write::write_all(&mut stream, b"N");
            } else {
                seen.lock().unwrap().push("plain");
            }
        }
    });
    (port, log)
}

/// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn config(port: u16) -> Config {
    let mut c = Config::new();
    c.host("127.0.0.1")
        .port(port)
        .user("u")
        .password("super-secret-pw")
        .connect_timeout(Duration::from_secs(5));
    c
}

fn tls_for(mode: TlsMode) -> Option<Arc<ClientConfig>> {
    crate::drivers::tls::client_config(&TlsParams {
        mode,
        ca_file: None,
    })
    .ok()
    .flatten()
}

/// Thứ tự các lần nối server giả thấy khi `connect` ở `mode`, kèm lỗi cuối.
async fn attempts(mode: TlsMode) -> (Vec<&'static str>, DbError) {
    let (port, log) = fake_server();
    let tls = tls_for(mode);
    let Err(err) = connect(&config(port), mode, tls.as_ref()).await else {
        panic!("server giả không bao giờ nối được");
    };
    let order = log.lock().unwrap().clone();
    (order, err)
}

fn params(json: serde_json::Value) -> OpenParams {
    serde_json::from_value(json).unwrap()
}

// ---- mở: kiểm dữ liệu đầu vào ----

#[tokio::test]
async fn open_requires_a_host() {
    for host in [serde_json::Value::Null, serde_json::json!("")] {
        let p = params(serde_json::json!({
            "driver": "postgres", "host": host, "username": "u"
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, INVALID_REQUEST);
        assert_eq!(err.message, "missing host");
    }
    let p = params(serde_json::json!({"driver": "postgres", "username": "u"}));
    assert_eq!(open(p).await.err().unwrap().code, INVALID_REQUEST);
}

#[tokio::test]
async fn open_requires_a_username() {
    for user in [serde_json::Value::Null, serde_json::json!("")] {
        let p = params(serde_json::json!({
            "driver": "postgres", "host": "127.0.0.1", "username": user
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, INVALID_REQUEST);
        assert_eq!(err.message, "missing username");
    }
}

#[tokio::test]
async fn open_with_unreadable_ca_file_fails_before_connecting() {
    // Cổng đóng: nếu code có nối thì lỗi sẽ là lỗi nối, không phải lỗi CA.
    let port = closed_port();
    for mode in ["verify-ca", "verify-full"] {
        let p = params(serde_json::json!({
            "driver": "postgres", "host": "127.0.0.1", "port": port, "username": "u",
            "password": "super-secret-pw",
            "tls": {"mode": mode, "caFile": "Z:/khong/ton/tai/ca.pem"}
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED, "{mode}");
        assert!(!err.message.contains("super-secret-pw"));
    }
}

#[tokio::test]
async fn open_to_a_refused_port_is_open_failed_without_the_password() {
    let p = params(serde_json::json!({
        "driver": "postgres", "host": "127.0.0.1", "port": closed_port(),
        "username": "u", "password": "super-secret-pw"
    }));
    let err = open(p).await.err().unwrap();
    assert_eq!(err.code, OPEN_FAILED);
    assert!(!err.message.is_empty());
    assert!(!err.message.contains("super-secret-pw"), "{}", err.message);
}

#[tokio::test]
async fn open_to_a_server_that_hangs_up_is_open_failed() {
    let (port, log) = fake_server();
    let p = params(serde_json::json!({
        "driver": "postgres", "host": "127.0.0.1", "port": port,
        "username": "u", "password": "super-secret-pw", "database": "d"
    }));
    let err = open(p).await.err().unwrap();
    assert_eq!(err.code, OPEN_FAILED);
    assert!(!err.message.contains("super-secret-pw"));
    // `disable` (mặc định) chỉ nối thường, đúng một lần.
    assert_eq!(*log.lock().unwrap(), ["plain"]);
}

// ---- kết nối: thứ tự thử theo từng chế độ ----

#[tokio::test]
async fn disable_tries_only_plain() {
    let (order, err) = attempts(TlsMode::Disable).await;
    assert_eq!(order, ["plain"]);
    assert_eq!(err.code, OPEN_FAILED);
}

#[tokio::test]
async fn allow_tries_plain_then_tls() {
    let (order, err) = attempts(TlsMode::Allow).await;
    assert_eq!(order, ["plain", "ssl"]);
    // Trả lỗi của lần thử CUỐI (TLS), không phải lần thường.
    assert_eq!(err.code, OPEN_FAILED);
    assert!(err.message.contains("TLS"), "{}", err.message);
}

#[tokio::test]
async fn prefer_tries_tls_then_plain() {
    let (order, err) = attempts(TlsMode::Prefer).await;
    assert_eq!(order, ["ssl", "plain"]);
    // Lần cuối là nối thường nên lỗi không nhắc tới TLS.
    assert_eq!(err.code, OPEN_FAILED);
    assert!(!err.message.contains("TLS"), "{}", err.message);
}

#[tokio::test]
async fn require_and_verify_modes_try_only_tls() {
    for mode in [TlsMode::Require, TlsMode::VerifyCa, TlsMode::VerifyFull] {
        // `connect` chỉ xem có cấu hình TLS hay không; dùng config không kiểm cert cho cả ba
        // để khỏi cần CA thật (việc kiểm chứng chỉ do `drivers::tls` lo và test riêng).
        let (port, log) = fake_server();
        let tls = tls_for(TlsMode::Require);
        let err = connect(&config(port), mode, tls.as_ref())
            .await
            .err()
            .unwrap();
        assert_eq!(*log.lock().unwrap(), ["ssl"], "{mode:?}");
        assert!(err.message.contains("TLS"), "{mode:?}: {}", err.message);
    }
}

#[tokio::test]
async fn without_a_tls_config_only_plain_is_tried_whatever_the_mode() {
    let (port, log) = fake_server();
    let err = connect(&config(port), TlsMode::Prefer, None)
        .await
        .err()
        .unwrap();
    assert_eq!(err.code, OPEN_FAILED);
    assert_eq!(*log.lock().unwrap(), ["plain"]);
}

#[tokio::test]
async fn connect_errors_never_contain_the_password() {
    for mode in [
        TlsMode::Disable,
        TlsMode::Allow,
        TlsMode::Prefer,
        TlsMode::Require,
    ] {
        let (_, err) = attempts(mode).await;
        assert!(!err.message.contains("super-secret-pw"), "{mode:?}");
    }
}

// ---- error_text ----

#[tokio::test]
async fn error_text_chains_the_causes_of_a_connection_error() {
    let port = closed_port();
    let e = connect_plain(&config(port)).await.err().unwrap();
    let text = error_text(&e);
    // `Display` của tokio-postgres chỉ có phần chung; nguyên nhân thật phải được nối vào.
    assert!(text.starts_with(&e.to_string()), "{text}");
    assert!(text.contains(": "), "{text}");
    assert!(text.len() > e.to_string().len(), "{text}");
    assert!(!text.contains("super-secret-pw"));
}

#[test]
fn default_port_is_the_postgres_port() {
    assert_eq!(DEFAULT_PORT, 5432);
    assert_eq!(DRIVER, "postgres");
}
