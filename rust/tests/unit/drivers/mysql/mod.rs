use super::*;
use crate::drivers::common::cancelled;
use crate::protocol::CANCELLED;
use crate::registry::CancelSignal;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

/// Id thread mà server giả báo trong lời chào; `conn.id()` của client phải bằng nó.
const THREAD_ID: u32 = 4242;
const PASSWORD: &str = "super-secret-pw";

// ---- server MySQL giả ----

/// Ghi một gói của giao thức MySQL: 3 byte độ dài (little-endian) + 1 byte số thứ tự + nội dung.
fn write_packet(s: &mut TcpStream, seq: u8, payload: &[u8]) {
    let mut buf = Vec::with_capacity(4 + payload.len());
    buf.extend_from_slice(&u32::try_from(payload.len()).unwrap().to_le_bytes()[..3]);
    buf.push(seq);
    buf.extend_from_slice(payload);
    let _ = s.write_all(&buf);
}

fn read_packet(s: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
    let mut head = [0u8; 4];
    s.read_exact(&mut head).ok()?;
    let len = u32::from_le_bytes([head[0], head[1], head[2], 0]) as usize;
    let mut payload = vec![0u8; len];
    s.read_exact(&mut payload).ok()?;
    Some((head[3], payload))
}

/// Gói chào (Initial Handshake v10): server nói trước. Khai báo hỗ trợ SSL để client chịu
/// gửi SSLRequest khi có cấu hình TLS (không có cờ này client từ chối ngay).
fn greeting() -> Vec<u8> {
    let mut p = vec![0x0a];
    p.extend_from_slice(b"8.0.0\0");
    p.extend_from_slice(&THREAD_ID.to_le_bytes());
    p.extend_from_slice(b"abcdefgh\0");
    // LONG_PASSWORD | PROTOCOL_41 | SSL | SECURE_CONNECTION.
    p.extend_from_slice(&0x8a01u16.to_le_bytes());
    p.push(45);
    p.extend_from_slice(&2u16.to_le_bytes());
    // PLUGIN_AUTH (nửa cao của cờ khả năng).
    p.extend_from_slice(&0x0008u16.to_le_bytes());
    p.push(21);
    p.extend_from_slice(&[0u8; 10]);
    p.extend_from_slice(b"ijklmnopqrst\0");
    p.extend_from_slice(b"mysql_native_password\0");
    p
}

/// Gói OK rỗng.
const OK: [u8; 7] = [0, 0, 0, 2, 0, 0, 0];

/// Phục vụ một connection. Ghi vào `log`: `ssl` (client gửi SSLRequest, 32 byte), `plain`
/// (gửi thẳng HandshakeResponse) rồi mỗi câu lệnh dạng `q:<sql>`. `accept = false` thì đóng
/// socket ngay sau đó (nối thất bại); `true` thì trả OK cho đăng nhập và mọi câu lệnh.
fn serve(mut s: TcpStream, accept: bool, log: UnboundedSender<String>) {
    write_packet(&mut s, 0, &greeting());
    let Some((seq, first)) = read_packet(&mut s) else {
        return;
    };
    if first.len() == 32 {
        let _ = log.send("ssl".into());
        return;
    }
    let _ = log.send("plain".into());
    if !accept {
        return;
    }
    write_packet(&mut s, seq + 1, &OK);
    // 0x03 = COM_QUERY; mọi lệnh khác (COM_QUIT...) kết thúc connection.
    while let Some((_, p)) = read_packet(&mut s) {
        if p.first() != Some(&0x03) {
            return;
        }
        let _ = log.send(format!("q:{}", String::from_utf8_lossy(&p[1..])));
        write_packet(&mut s, 1, &OK);
    }
}

/// Server giả: trả cổng và kênh nhận log. Thread chặn ở `accept` tới hết process; cổng tự
/// chọn nên các test không đụng nhau.
fn fake_server(accept: bool) -> (u16, UnboundedReceiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = unbounded_channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let log = tx.clone();
            std::thread::spawn(move || serve(stream, accept, log));
        }
    });
    (port, rx)
}

/// Server nhận TCP nhưng không nói gì (để thử timeout). Giữ socket mở tới hết process.
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

/// Lấy hết những gì đã có trong log (không chờ).
fn drain(rx: &mut UnboundedReceiver<String>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(line) = rx.try_recv() {
        out.push(line);
    }
    out
}

/// Chờ dòng log kế tiếp (có chặn trên để test không treo nếu code sai).
async fn next(rx: &mut UnboundedReceiver<String>) -> String {
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("hết hạn chờ server giả")
        .expect("server giả đóng kênh")
}

/// Cấu hình nối tới `port`. Đặt sẵn `max_allowed_packet`/`wait_timeout` để client khỏi hỏi
/// server hai biến đó lúc nối (server giả không trả được result set).
fn base(port: u16) -> OptsBuilder {
    OptsBuilder::default()
        .ip_or_hostname("127.0.0.1")
        .tcp_port(port)
        .user(Some("u"))
        .pass(Some(PASSWORD))
        .prefer_socket(false)
        .stmt_cache_size(0usize)
        .max_allowed_packet(Some(1 << 24))
        .wait_timeout(Some(3600))
}

fn tls(mode: TlsMode, ca_file: Option<&str>) -> TlsParams {
    TlsParams {
        mode,
        ca_file: ca_file.map(str::to_owned),
    }
}

/// File trong `rust/tests/fixtures/` (cert dựng sẵn, không cần Docker).
fn fx(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn params(json: serde_json::Value) -> OpenParams {
    serde_json::from_value(json).unwrap()
}

/// `Shared` trỏ tới server giả `port`, thread id 777.
fn shared(port: u16) -> Arc<Shared> {
    Arc::new(Shared {
        kill_opts: Opts::from(base(port)),
        thread_id: 777,
        seq: AtomicU64::new(0),
        busy: AtomicBool::new(false),
        broken: AtomicBool::new(false),
        handle: Handle::current(),
    })
}

/// Thứ tự các lần nối server giả thấy khi `connect` ở `mode` (server luôn đóng socket),
/// kèm lỗi cuối.
async fn attempts(mode: TlsMode, ssl: Option<SslOpts>) -> (Vec<String>, DbError) {
    tls::install_provider();
    let (port, mut rx) = fake_server(false);
    let Err(err) = connect(&base(port), mode, ssl).await else {
        panic!("server giả không bao giờ cho nối");
    };
    (drain(&mut rx), err)
}

// ---- ssl_opts: ánh xạ 6 mode ----

#[test]
fn disable_has_no_ssl_opts_even_with_a_bad_ca_file() {
    assert!(
        ssl_opts(&tls(TlsMode::Disable, Some("Z:/khong/ton/tai.pem")))
            .unwrap()
            .is_none()
    );
}

#[test]
fn allow_prefer_require_encrypt_without_verifying_and_ignore_ca_file() {
    for mode in [TlsMode::Allow, TlsMode::Prefer, TlsMode::Require] {
        // caFile hỏng cũng không sao: các mode này không dùng tới nó.
        let o = ssl_opts(&tls(mode, Some("Z:/khong/ton/tai.pem")))
            .unwrap()
            .unwrap();
        assert!(o.accept_invalid_certs(), "{mode:?}");
        assert!(o.skip_domain_validation(), "{mode:?}");
        assert!(o.root_certs().is_empty(), "{mode:?}");
        assert!(!o.disable_built_in_roots(), "{mode:?}");
    }
}

#[test]
fn verify_ca_skips_only_the_hostname_check() {
    let ca = fx("ca.pem");
    let o = ssl_opts(&tls(TlsMode::VerifyCa, Some(&ca)))
        .unwrap()
        .unwrap();
    assert!(!o.accept_invalid_certs());
    assert!(o.skip_domain_validation());
}

#[test]
fn verify_full_checks_chain_and_hostname() {
    let ca = fx("ca.pem");
    let o = ssl_opts(&tls(TlsMode::VerifyFull, Some(&ca)))
        .unwrap()
        .unwrap();
    assert!(!o.accept_invalid_certs());
    assert!(!o.skip_domain_validation());
}

#[test]
fn verify_modes_with_ca_file_trust_only_that_file() {
    let ca = fx("ca.pem");
    let mut bundle = std::fs::read(&ca).unwrap();
    bundle.extend(std::fs::read(fx("ca_other.pem")).unwrap());
    let two = std::env::temp_dir().join(format!("s3b_my_ca_{}.pem", std::process::id()));
    std::fs::write(&two, &bundle).unwrap();
    for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
        let one = ssl_opts(&tls(mode, Some(&ca))).unwrap().unwrap();
        assert_eq!(one.root_certs().len(), 1, "{mode:?}");
        assert!(one.disable_built_in_roots(), "{mode:?}");
        let both = ssl_opts(&tls(mode, two.to_str())).unwrap().unwrap();
        assert_eq!(both.root_certs().len(), 2, "{mode:?}");
        assert!(both.disable_built_in_roots(), "{mode:?}");
    }
    let _ = std::fs::remove_file(&two);
}

#[test]
fn verify_modes_without_ca_file_use_only_the_windows_store_and_never_built_in_roots() {
    for ca in [None, Some("")] {
        for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
            let o = ssl_opts(&tls(mode, ca)).unwrap().unwrap();
            assert!(!o.root_certs().is_empty(), "{mode:?}: kho Windows rỗng");
            // C1: `roots` đã là kho Windows nên bộ CA có sẵn luôn tắt.
            assert!(o.disable_built_in_roots(), "{mode:?}");
        }
    }
}

#[test]
fn verify_modes_with_a_bad_ca_file_fail_with_open_failed() {
    for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
        let Err(e) = ssl_opts(&tls(mode, Some("Z:/khong/ton/tai.pem"))) else {
            panic!("{mode:?} phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED);
        assert!(!e.message.contains("khong/ton/tai"), "{}", e.message);
    }
}

// ---- open: kiểm input ----

#[tokio::test]
async fn open_requires_a_host() {
    for host in [serde_json::Value::Null, serde_json::json!("")] {
        let p = params(serde_json::json!({
            "driver": "mysql", "host": host, "username": "u"
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, INVALID_REQUEST);
        assert_eq!(err.message, "missing host");
    }
    let p = params(serde_json::json!({"driver": "mariadb", "username": "u"}));
    assert_eq!(open(p).await.err().unwrap().code, INVALID_REQUEST);
}

#[tokio::test]
async fn open_requires_a_username() {
    for user in [serde_json::Value::Null, serde_json::json!("")] {
        let p = params(serde_json::json!({
            "driver": "mysql", "host": "127.0.0.1", "username": user
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
            "driver": "mysql", "host": "127.0.0.1", "port": port, "username": "u",
            "password": PASSWORD,
            "tls": {"mode": mode, "caFile": "Z:/khong/ton/tai/ca.pem"}
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED, "{mode}");
        assert!(err.message.contains("caFile"), "{}", err.message);
        assert!(!err.message.contains(PASSWORD));
    }
}

#[tokio::test]
async fn open_to_a_refused_port_is_open_failed_without_the_password() {
    let p = params(serde_json::json!({
        "driver": "mysql", "host": "127.0.0.1", "port": closed_port(),
        "username": "u", "password": PASSWORD
    }));
    let err = open(p).await.err().unwrap();
    assert_eq!(err.code, OPEN_FAILED);
    assert!(!err.message.is_empty());
    assert!(!err.message.contains(PASSWORD), "{}", err.message);
}

#[tokio::test]
async fn open_to_a_server_that_hangs_up_is_open_failed() {
    for driver in ["mysql", "mariadb"] {
        let (port, mut rx) = fake_server(false);
        let p = params(serde_json::json!({
            "driver": driver, "host": "127.0.0.1", "port": port,
            "username": "u", "password": PASSWORD, "database": "d"
        }));
        let err = open(p).await.err().unwrap();
        assert_eq!(err.code, OPEN_FAILED, "{driver}");
        assert!(!err.message.contains(PASSWORD), "{}", err.message);
        // `disable` (mặc định) chỉ nối thường, đúng một lần.
        assert_eq!(drain(&mut rx), ["plain"], "{driver}");
    }
}

#[tokio::test(start_paused = true)]
async fn open_to_a_silent_server_times_out() {
    // Đồng hồ ảo: tự nhảy tới 10 giây khi mọi task đang chờ, nên không chờ thật.
    let p = params(serde_json::json!({
        "driver": "mysql", "host": "127.0.0.1", "port": silent_server(),
        "username": "u", "password": PASSWORD
    }));
    let err = open(p).await.err().unwrap();
    assert_eq!(err.code, OPEN_FAILED);
    assert_eq!(err.message, "connection timed out");
}

// ---- connect: thứ tự thử theo từng mode (server giả luôn từ chối) ----

#[tokio::test]
async fn disable_tries_only_plain() {
    let (order, err) = attempts(TlsMode::Disable, None).await;
    assert_eq!(order, ["plain"]);
    assert_eq!(err.code, OPEN_FAILED);
}

#[tokio::test]
async fn allow_tries_plain_then_tls() {
    let ssl = ssl_opts(&tls(TlsMode::Allow, None)).unwrap();
    let (order, err) = attempts(TlsMode::Allow, ssl).await;
    assert_eq!(order, ["plain", "ssl"]);
    assert_eq!(err.code, OPEN_FAILED);
}

#[tokio::test]
async fn prefer_tries_tls_then_plain() {
    let ssl = ssl_opts(&tls(TlsMode::Prefer, None)).unwrap();
    let (order, err) = attempts(TlsMode::Prefer, ssl).await;
    assert_eq!(order, ["ssl", "plain"]);
    assert_eq!(err.code, OPEN_FAILED);
}

#[tokio::test]
async fn require_and_verify_modes_try_only_tls() {
    let ca = fx("ca.pem");
    for mode in [TlsMode::Require, TlsMode::VerifyCa, TlsMode::VerifyFull] {
        let ssl = ssl_opts(&tls(mode, Some(&ca))).unwrap();
        let (order, err) = attempts(mode, ssl).await;
        assert_eq!(order, ["ssl"], "{mode:?}");
        assert_eq!(err.code, OPEN_FAILED, "{mode:?}");
    }
}

#[tokio::test]
async fn without_ssl_opts_only_plain_is_tried_whatever_the_mode() {
    let (order, _) = attempts(TlsMode::Prefer, None).await;
    assert_eq!(order, ["plain"]);
}

#[tokio::test]
async fn connect_errors_never_contain_the_password() {
    for mode in [
        TlsMode::Disable,
        TlsMode::Allow,
        TlsMode::Prefer,
        TlsMode::Require,
    ] {
        let ssl = ssl_opts(&tls(mode, None)).unwrap();
        let (_, err) = attempts(mode, ssl).await;
        assert!(!err.message.contains(PASSWORD), "{mode:?}: {}", err.message);
    }
}

// ---- connect: server giả chấp nhận ----

#[tokio::test]
async fn connect_runs_init_on_the_main_connection_only() {
    let (port, mut rx) = fake_server(true);
    let (conn, kill_opts) = connect(&base(port), TlsMode::Disable, None).await.unwrap();
    assert_eq!(conn.id(), THREAD_ID);
    assert_eq!(drain(&mut rx), ["plain", &format!("q:{INIT}")]);
    // Connection phụ gửi KILL không chạy lệnh INIT.
    assert!(kill_opts.init().is_empty());
    assert!(kill_opts.ssl_opts().is_none());
    conn.disconnect().await.unwrap();
}

#[tokio::test]
async fn allow_stops_at_the_first_success_and_keeps_plain_for_kill() {
    let ssl = ssl_opts(&tls(TlsMode::Allow, None)).unwrap();
    let (port, mut rx) = fake_server(true);
    let (conn, kill_opts) = connect(&base(port), TlsMode::Allow, ssl).await.unwrap();
    assert_eq!(drain(&mut rx), ["plain", &format!("q:{INIT}")]);
    assert!(kill_opts.ssl_opts().is_none());
    conn.disconnect().await.unwrap();
}

#[tokio::test]
async fn prefer_falls_back_to_plain_and_kill_uses_the_kind_that_worked() {
    tls::install_provider();
    let ssl = ssl_opts(&tls(TlsMode::Prefer, None)).unwrap();
    let (port, mut rx) = fake_server(true);
    // Server giả không bắt tay TLS được nên lần TLS rớt, lần thường thành công.
    let (conn, kill_opts) = connect(&base(port), TlsMode::Prefer, ssl).await.unwrap();
    assert_eq!(drain(&mut rx), ["ssl", "plain", &format!("q:{INIT}")]);
    assert!(kill_opts.ssl_opts().is_none());
    conn.disconnect().await.unwrap();
}

// ---- kill_query ----

#[tokio::test]
async fn kill_query_without_seq_always_sends_kill() {
    let (port, mut rx) = fake_server(true);
    let s = shared(port);
    kill_query(&s, None).await;
    assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);
}

#[tokio::test]
async fn kill_query_sends_kill_only_while_that_seq_is_still_running() {
    let (port, mut rx) = fake_server(true);
    let s = shared(port);
    let cancel = CancelSignal::new();

    // Đang chạy đúng lần 1: gửi.
    let op = s.begin(&cancel).unwrap();
    kill_query(&s, Some(1)).await;
    assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);

    // Lần 1 đã xong (không còn busy): chỉ nối rồi đóng, không KILL.
    drop(op);
    kill_query(&s, Some(1)).await;
    assert_eq!(drain(&mut rx), ["plain"]);

    // Đang chạy lần 2 mà người gọi nhắm lần 1: không được huỷ nhầm câu sau.
    let _op = s.begin(&cancel).unwrap();
    kill_query(&s, Some(1)).await;
    assert_eq!(drain(&mut rx), ["plain"]);
    kill_query(&s, Some(2)).await;
    assert_eq!(drain(&mut rx), ["plain", "q:KILL QUERY 777"]);
}

#[tokio::test]
async fn kill_query_to_an_unreachable_server_returns_quietly() {
    // Từ chối kết nối trên Windows mất ~2 giây, nên chỉ thử một lần.
    let s = shared(closed_port());
    kill_query(&s, None).await;
}

#[tokio::test(start_paused = true)]
async fn kill_query_gives_up_after_the_timeout_on_a_silent_server() {
    let s = shared(silent_server());
    kill_query(&s, None).await;
}

// ---- Interrupt ----

#[tokio::test]
async fn interrupt_when_idle_spawns_nothing() {
    let (port, mut rx) = fake_server(true);
    let s = shared(port);
    let int = MySqlInterrupt(s.clone());
    let metrics = Handle::current().metrics();
    let before = metrics.num_alive_tasks();
    int.interrupt();
    assert_eq!(metrics.num_alive_tasks(), before);
    assert!(drain(&mut rx).is_empty());
}

#[tokio::test]
async fn interrupt_while_busy_sends_kill_query_for_the_connection() {
    let (port, mut rx) = fake_server(true);
    let s = shared(port);
    let int = MySqlInterrupt(s.clone());
    let _op = s.begin(&CancelSignal::new()).unwrap();
    let metrics = Handle::current().metrics();
    let before = metrics.num_alive_tasks();
    // `interrupt` trả về ngay (chỉ spawn), việc gửi KILL chạy ở task riêng.
    int.interrupt();
    assert_eq!(metrics.num_alive_tasks(), before + 1);
    assert_eq!(next(&mut rx).await, "plain");
    assert_eq!(next(&mut rx).await, "q:KILL QUERY 777");
}

// ---- Shared / Op ----

#[tokio::test]
async fn begin_marks_busy_until_the_op_is_dropped() {
    let s = shared(closed_port());
    let cancel = CancelSignal::new();
    assert!(!s.busy.load(Ordering::SeqCst));
    let op = s.begin(&cancel).unwrap();
    assert!(s.busy.load(Ordering::SeqCst));
    assert!(s.is_running(1));
    assert!(!s.is_running(2));
    drop(op);
    assert!(!s.busy.load(Ordering::SeqCst));
    assert!(!s.is_running(1));
    // Lần sau tăng seq.
    let _op = s.begin(&cancel).unwrap();
    assert!(s.is_running(2));
    assert!(!s.is_running(1));
}

#[tokio::test]
async fn begin_on_a_cancelled_request_fails_and_clears_busy() {
    let s = shared(closed_port());
    let cancel = CancelSignal::new();
    cancel.cancel();
    let Err(err) = s.begin(&cancel) else {
        panic!("request đã huỷ thì begin phải lỗi");
    };
    assert_eq!(err.code, CANCELLED);
    assert_eq!(err.message, cancelled().message);
    // Op đã bị thả trong `begin` nên không để `busy` kẹt (sẽ khiến `interrupt` KILL nhầm).
    assert!(!s.busy.load(Ordering::SeqCst));
    assert!(!s.is_running(1));
}

#[tokio::test]
async fn broken_flag_is_sticky() {
    let s = shared(closed_port());
    assert!(!s.is_broken());
    s.mark_broken();
    assert!(s.is_broken());
    s.mark_broken();
    assert!(s.is_broken());
}

// ---- error_text ----

#[test]
fn error_text_of_a_server_error_looks_like_the_mysql_client() {
    let e = mysql_async::Error::Server(mysql_async::ServerError {
        code: 1045,
        state: "28000".into(),
        message: "Access denied for user 'u'@'h' (using password: YES)".into(),
    });
    assert_eq!(
        error_text(&e),
        "ERROR 1045 (28000): Access denied for user 'u'@'h' (using password: YES)"
    );
}

#[test]
fn error_text_of_an_io_error_has_one_io_prefix() {
    let e = mysql_async::Error::Io(mysql_async::IoError::Io(std::io::Error::other("boom")));
    let text = error_text(&e);
    assert_eq!(text, "Input/output error: boom");
    assert_eq!(text.matches("Input/output error").count(), 1);
}

#[test]
fn error_text_of_other_errors_is_their_display() {
    let e = mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed);
    assert_eq!(error_text(&e), e.to_string());
    assert!(!error_text(&e).is_empty());
}

#[tokio::test]
async fn error_text_of_a_refused_connection_names_the_cause_without_the_password() {
    let e = Conn::new(Opts::from(base(closed_port())))
        .await
        .err()
        .unwrap();
    let text = error_text(&e);
    assert!(text.starts_with("Input/output error"), "{text}");
    assert_eq!(text.matches("Input/output error").count(), 1, "{text}");
    assert!(!text.contains(PASSWORD));
}

#[test]
fn constants_match_the_mysql_defaults() {
    assert_eq!(DEFAULT_PORT, 3306);
    assert_eq!(DRIVER, "mysql");
    assert_eq!(MARIADB, "mariadb");
}
