//! Test TLS của driver Redis với server thật (`s3b-test-redis`): cổng thường (`REDIS_PORT`, chỉ
//! nói chuyện thường) và cổng TLS (`REDIS_TLS_PORT`, chỉ nói TLS, không đòi chứng chỉ client).
//! Không có server hoặc thiếu một trong hai cổng thì mỗi test in `SKIP ...` rồi đạt.
//!
//! Cách biết kết nối có mã hoá thật: mỗi test đặt một PROXY TCP nghe thử byte đầu của từng kết nối
//! client mở (TLS bắt đầu bằng record `0x16 0x03`, RESP thường bắt đầu bằng `*` nên không bao giờ
//! trùng) rồi chuyển tiếp tới server thật. Nhờ vậy đếm được từng kiểu kết nối của CHÍNH test đó,
//! không phụ thuộc bộ đếm toàn cục (các test chạy song song). Proxy còn từ chối được một kiểu (để
//! thử fallback) và đặt được ở `127.0.0.2` (host ngoài chứng chỉ).
//!
//! Chứng chỉ server ký bởi CA của `test-env/certs/ca.pem`, SAN gồm `localhost` và `127.0.0.1`.
//! Mọi lỗi nối đều bị chặn bởi `CONNECT_TIMEOUT` (10 giây) nên các test mong đợi lỗi chạy các
//! mode song song trong thread riêng và chỉ kiểm mỗi tình huống một lần.

mod common;
mod redis_common;

use common::*;
use redis_common::*;
use serde_json::{Value, json};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const MODES: [&str; 6] = [
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "verify-full",
];
/// Mode mã hoá bắt buộc (không bao giờ hạ xuống kết nối thường).
const SECURE_MODES: [&str; 3] = ["require", "verify-ca", "verify-full"];
/// Trần cho một lần `open` thất bại: 10 giây của `CONNECT_TIMEOUT` cộng dư.
const FAIL_LIMIT: Duration = Duration::from_secs(20);

/// Kiểu kết nối proxy từ chối (đóng ngay sau khi nhận byte đầu).
#[derive(Clone, Copy, PartialEq)]
enum Refuse {
    Nothing,
    Plain,
    Tls,
}

/// Proxy TCP có đếm kiểu kết nối.
struct Proxy {
    port: u16,
    tls: Arc<AtomicUsize>,
    plain: Arc<AtomicUsize>,
}

impl Proxy {
    fn tls(&self) -> usize {
        self.tls.load(Ordering::SeqCst)
    }

    fn plain(&self) -> usize {
        self.plain.load(Ordering::SeqCst)
    }
}

/// Chuyển tiếp `from` sang `to` tới khi một bên đóng, rồi đóng nốt chiều còn lại.
fn pipe(mut from: TcpStream, mut to: TcpStream) {
    let _ = std::io::copy(&mut from, &mut to);
    let _ = to.shutdown(Shutdown::Both);
    let _ = from.shutdown(Shutdown::Both);
}

/// Proxy nghe ở `bind` tới cổng `target_port` của server thật. `None` nếu không bind được (ví dụ
/// `127.0.0.2`).
fn proxy(target_port: u16, bind: &str, refuse: Refuse) -> Option<Proxy> {
    let listener = TcpListener::bind((bind, 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let target = SocketAddr::from(([127, 0, 0, 1], target_port));
    let (tls, plain) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
    let (tls2, plain2) = (Arc::clone(&tls), Arc::clone(&plain));
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            let (tls, plain) = (Arc::clone(&tls2), Arc::clone(&plain2));
            std::thread::spawn(move || {
                let _ = client.set_read_timeout(Some(Duration::from_secs(15)));
                let mut head = [0u8; 2];
                if !matches!(client.peek(&mut head), Ok(2)) {
                    return;
                }
                let is_tls = head[0] == 0x16 && head[1] == 0x03;
                let counter = if is_tls { &tls } else { &plain };
                counter.fetch_add(1, Ordering::SeqCst);
                let refused =
                    (is_tls && refuse == Refuse::Tls) || (!is_tls && refuse == Refuse::Plain);
                if refused {
                    return; // `client` bị thả: kết nối đóng
                }
                let _ = client.set_read_timeout(None);
                let Ok(server) = TcpStream::connect(target) else {
                    return;
                };
                let (Ok(c2), Ok(s2)) = (client.try_clone(), server.try_clone()) else {
                    return;
                };
                std::thread::spawn(move || pipe(c2, s2));
                pipe(server, client);
            });
        }
    });
    Some(Proxy { port, tls, plain })
}

/// `open` chạy ở thread riêng để nhiều lần chờ-hết-hạn chạy song song.
fn open_in_thread(params: Value) -> std::thread::JoinHandle<(Value, Duration)> {
    std::thread::spawn(move || {
        let t0 = Instant::now();
        let r = call("open", params);
        (r, t0.elapsed())
    })
}

fn ping(c: &Conn) {
    assert_eq!(c.text("PING"), "PONG");
}

/// Params tới `proxy` (cổng của proxy) với TLS `mode`, DB mới.
fn via(s: &Server, p: &Proxy, mode: &str) -> Value {
    s.params_on(p.port, mode, next_db())
}

/// `open` với mật khẩu sai tới cổng `port` (qua proxy đếm): phải báo `WRONGPASS` trong vài giây, không
/// lộ mật khẩu, và chỉ mở kiểu kết nối đầu tiên của mode (`allow`/`disable` thường, còn lại TLS).
fn assert_wrongpass_at_once(s: &Server, mode: &str, port: u16) {
    let wrong = s.wrong_password();
    let p = proxy(port, "127.0.0.1", Refuse::Nothing).unwrap();
    let t0 = Instant::now();
    let r = call("open", merge(via(s, &p, mode), json!({"password": wrong})));
    assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
    assert!(message(&r).contains("WRONGPASS"), "{mode}: {r}");
    assert!(!r.to_string().contains(&wrong), "{mode}: {r}");
    assert!(!s.password_leaks_in(&r), "{mode}");
    assert!(
        t0.elapsed() < Duration::from_secs(5),
        "{mode}: {:?}",
        t0.elapsed()
    );
    if matches!(mode, "disable" | "allow") {
        assert_eq!(p.tls(), 0, "{mode}: không được thử TLS");
    } else {
        assert_eq!(p.plain(), 0, "{mode}: không được thử kết nối thường");
    }
}

redis_tls! {
    /// Cổng TLS (chỉ nói TLS): `disable` không nối được, `allow` thử thường rồi lên TLS, các mode
    /// còn lại mã hoá ngay.
    fn the_tls_port_accepts_every_mode_except_disable_and_the_transport_matches(s: &Server) {
        let runs: Vec<_> = MODES
            .into_iter()
            .map(|mode| {
                let p = proxy(s.tls_port, "127.0.0.1", Refuse::Nothing).unwrap();
                let h = open_in_thread(via(s, &p, mode));
                (mode, p, h)
            })
            .collect();
        for (mode, p, h) in runs {
            let (r, took) = h.join().unwrap();
            assert!(took < FAIL_LIMIT, "{mode}: {took:?}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            if mode == "disable" {
                assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
                assert_eq!(p.tls(), 0, "disable không được thử TLS");
                continue;
            }
            let id = ok(&r)["connId"].as_u64().unwrap();
            let c = Conn::adopt(id);
            ping(&c);
            assert!(p.tls() >= 1, "{mode}: tls={} plain={}", p.tls(), p.plain());
            if mode == "allow" {
                assert!(p.plain() >= 1, "allow thử thường trước");
            } else {
                assert_eq!(p.plain(), 0, "{mode} không được mở kết nối thường");
            }
        }
    }

    /// Cổng thường (chỉ nói thường): `disable`/`allow` dùng được, `prefer` thử TLS rồi lùi về
    /// thường, các mode bắt buộc TLS không bao giờ mở kết nối thường.
    fn the_plain_port_accepts_disable_allow_prefer_but_not_the_secure_modes(s: &Server) {
        let runs: Vec<_> = MODES
            .into_iter()
            .map(|mode| {
                let p = proxy(s.port, "127.0.0.1", Refuse::Nothing).unwrap();
                let h = open_in_thread(via(s, &p, mode));
                (mode, p, h)
            })
            .collect();
        for (mode, p, h) in runs {
            let (r, took) = h.join().unwrap();
            assert!(took < FAIL_LIMIT, "{mode}: {took:?}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            if SECURE_MODES.contains(&mode) {
                assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
                assert_eq!(p.plain(), 0, "{mode} không được hạ xuống kết nối thường");
                assert!(p.tls() >= 1, "{mode} phải thử TLS");
                continue;
            }
            let c = Conn::adopt(ok(&r)["connId"].as_u64().unwrap());
            ping(&c);
            assert!(p.plain() >= 1, "{mode}");
            match mode {
                "disable" | "allow" => assert_eq!(p.tls(), 0, "{mode} không được thử TLS"),
                _ => assert!(p.tls() >= 1, "prefer thử TLS trước"),
            }
        }
    }

    /// `allow`: thử thường trước; proxy từ chối thường thì dùng TLS.
    fn allow_falls_back_to_tls_when_plain_is_refused(s: &Server) {
        let p = proxy(s.tls_port, "127.0.0.1", Refuse::Plain).unwrap();
        let t0 = Instant::now();
        let c = Conn::adopt(ok(&call("open", via(s, &p, "allow")))["connId"].as_u64().unwrap());
        ping(&c);
        assert!(p.plain() >= 1, "phải thử thường trước");
        assert!(p.tls() >= 1, "rồi mới tới TLS");
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    }

    /// `prefer`: thử TLS trước; proxy từ chối TLS thì dùng kết nối thường.
    fn prefer_falls_back_to_plain_when_tls_is_refused(s: &Server) {
        let p = proxy(s.port, "127.0.0.1", Refuse::Tls).unwrap();
        let t0 = Instant::now();
        let c = Conn::adopt(ok(&call("open", via(s, &p, "prefer")))["connId"].as_u64().unwrap());
        ping(&c);
        assert!(p.tls() >= 1, "phải thử TLS trước");
        assert!(p.plain() >= 1, "rồi mới tới thường");
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    }

    /// Mode bắt buộc không hạ xuống thường, `disable` không lên TLS, khi kiểu duy nhất của mode
    /// bị từ chối thì `open` lỗi và không mở kiểu kia.
    fn modes_never_switch_to_the_other_transport_when_theirs_is_refused(s: &Server) {
        let cases = [
            ("require", Refuse::Tls, s.tls_port),
            ("verify-ca", Refuse::Tls, s.tls_port),
            ("verify-full", Refuse::Tls, s.tls_port),
            ("disable", Refuse::Plain, s.port),
        ];
        let runs: Vec<_> = cases
            .into_iter()
            .map(|(mode, refuse, port)| {
                let p = proxy(port, "127.0.0.1", refuse).unwrap();
                let h = open_in_thread(via(s, &p, mode));
                (mode, p, h)
            })
            .collect();
        for (mode, p, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < FAIL_LIMIT, "{mode}: {took:?}");
            if mode == "disable" {
                assert_eq!(p.tls(), 0, "disable không được thử TLS");
            } else {
                assert_eq!(p.plain(), 0, "{mode} không được thử kết nối thường");
            }
        }
    }

    /// Server đã trả lời và từ chối (sai mật khẩu) thì dừng ngay và giữ nguyên lời server
    /// (`WRONGPASS`). Mode chỉ có một kiểu kết nối (`disable`, `require`, `verify-*`) nên không có
    /// kiểu nào khác để thử.
    fn wrong_password_with_a_single_transport_mode_reports_wrongpass_at_once(s: &Server) {
        let cases = [
            ("disable", s.port),
            ("require", s.tls_port),
            ("verify-ca", s.tls_port),
            ("verify-full", s.tls_port),
        ];
        for (mode, port) in cases {
            assert_wrongpass_at_once(s, mode, port);
        }
    }

    /// `allow` (thường rồi TLS) và `prefer` (TLS rồi thường) phải dừng ở lần thử đầu khi server đã
    /// trả `WRONGPASS`, không thử kiểu kết nối kia (nó sẽ treo tới hết thời gian nối vì cổng không
    /// nói kiểu đó) và không che lời server bằng lỗi nối.
    fn wrong_password_with_allow_stops_at_the_plain_attempt(s: &Server) {
        assert_wrongpass_at_once(s, "allow", s.port);
    }

    fn wrong_password_with_prefer_stops_at_the_tls_attempt(s: &Server) {
        assert_wrongpass_at_once(s, "prefer", s.tls_port);
    }

    fn verify_modes_accept_the_names_in_the_certificate_with_the_ca_file(s: &Server) {
        for mode in ["verify-ca", "verify-full"] {
            for host in ["localhost", "127.0.0.1"] {
                let c = s.conn_from(s.params_on_with(s.tls_port, mode, next_db(), json!({"host": host})));
                ping(&c);
            }
        }
    }

    fn require_prefer_and_allow_do_not_need_a_ca_file(s: &Server) {
        for mode in ["allow", "prefer", "require"] {
            let over = json!({"tls": {"mode": mode}});
            let c = s.conn_from(s.params_on_with(s.tls_port, mode, next_db(), over));
            ping(&c);
        }
    }

    fn ca_file_is_ignored_when_the_mode_does_not_verify(s: &Server) {
        for (mode, port) in [("disable", s.port), ("allow", s.tls_port), ("prefer", s.tls_port), ("require", s.tls_port)] {
            let over = json!({"tls": {"mode": mode, "caFile": "Z:/no/such/ca.pem"}});
            let c = s.conn_from(s.params_on_with(port, mode, next_db(), over));
            ping(&c);
        }
    }

    fn verify_modes_with_a_missing_or_junk_ca_file_fail_naming_the_ca_file(s: &Server) {
        let junk = std::env::temp_dir().join(format!("s3b_junk_redis_ca_{}.pem", std::process::id()));
        std::fs::write(&junk, "this is not a certificate").unwrap();
        for mode in ["verify-ca", "verify-full"] {
            for ca in ["Z:/no/such/ca-secret-name.pem".to_owned(), junk.to_string_lossy().into_owned()] {
                let t0 = Instant::now();
                let over = json!({"tls": {"mode": mode, "caFile": ca}});
                let r = call("open", s.params_on_with(s.tls_port, mode, next_db(), over));
                assert_eq!(err_code(&r), "openFailed", "{mode} {ca}");
                assert!(message(&r).contains("caFile"), "{mode} {ca}: {r}");
                assert!(!r.to_string().contains("ca-secret-name"), "{r}");
                assert!(!r.to_string().contains(&junk.to_string_lossy().into_owned()), "{r}");
                assert!(!s.password_leaks_in(&r));
                // Lỗi `caFile` có trước khi nối, nên trả ngay chứ không chờ hết thời gian nối.
                assert!(t0.elapsed() < Duration::from_secs(2), "{mode}: {:?}", t0.elapsed());
            }
        }
        let _ = std::fs::remove_file(&junk);
    }

    /// Không có `caFile` thì verify dùng kho chứng chỉ của Windows, không có CA của test-env nên
    /// chứng chỉ bị từ chối.
    fn verify_modes_without_a_ca_file_reject_the_untrusted_test_ca(s: &Server) {
        let runs: Vec<_> = ["verify-ca", "verify-full"]
            .into_iter()
            .map(|mode| {
                let over = json!({"tls": {"mode": mode}});
                (mode, open_in_thread(s.params_on_with(s.tls_port, mode, next_db(), over)))
            })
            .collect();
        for (mode, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < FAIL_LIMIT, "{mode}: {took:?}");
        }
    }

    /// `caFile` là CA khác (không ký chứng chỉ của server) thì bị từ chối.
    fn verify_modes_reject_a_ca_that_did_not_sign_the_server_certificate(s: &Server) {
        let other = format!("{}/tests/fixtures/ca_other.pem", env!("CARGO_MANIFEST_DIR"));
        let runs: Vec<_> = ["verify-ca", "verify-full"]
            .into_iter()
            .map(|mode| {
                let over = json!({"tls": {"mode": mode, "caFile": other}});
                (mode, open_in_thread(s.params_on_with(s.tls_port, mode, next_db(), over)))
            })
            .collect();
        for (mode, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < FAIL_LIMIT, "{mode}: {took:?}");
        }
    }

    /// Host ngoài chứng chỉ (proxy `127.0.0.2`): `verify-full` từ chối; `verify-ca` bỏ qua hostname
    /// và `require` không kiểm nên cả hai mở được.
    fn only_verify_full_rejects_a_host_not_in_the_certificate(s: &Server) {
        let Some(p) = proxy(s.tls_port, "127.0.0.2", Refuse::Nothing) else {
            println!("SKIP verify hostname: không bind được 127.0.0.2");
            return;
        };
        let over = json!({"host": "127.0.0.2", "port": p.port});
        let full = open_in_thread(merge(s.params_on(p.port, "verify-full", next_db()), over.clone()));
        for mode in ["verify-ca", "require"] {
            let c = s.conn_from(merge(s.params_on(p.port, mode, next_db()), over.clone()));
            ping(&c);
        }
        assert!(p.tls() >= 2);
        let (r, took) = full.join().unwrap();
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(!s.password_leaks_in(&r));
        assert!(took < FAIL_LIMIT, "{took:?}");
    }

    fn unknown_tls_mode_is_invalid_request(s: &Server) {
        let over = json!({"tls": {"mode": "yes-please"}});
        let r = call("open", s.params_on_with(s.tls_port, "require", next_db(), over));
        assert_eq!(err_code(&r), "invalidRequest");
        assert!(!s.password_leaks_in(&r));
    }

    fn big_results_and_paging_work_over_tls(s: &Server) {
        for mode in ["require", "verify-full"] {
            let c = s.conn_from(s.params_on(s.tls_port, mode, next_db()));
            let k = c.key("tlsbig");
            let n = 3000usize;
            let items: Vec<String> = (0..n).map(|i| i.to_string()).collect();
            c.exec(&format!("RPUSH {k} {}", items.join(" ")));
            let r = c.exec_page(&format!("LRANGE {k} 0 -1"), 500, MAX_BYTES);
            let pages = walk(&c, stmt(&r, 0), 500, MAX_BYTES);
            assert_eq!(pages.len(), 6);
            assert_eq!(pages.into_iter().flatten().collect::<Vec<_>>(), items);
            let value = "é".repeat(500_000);
            c.exec(&format!("SET {k}_s {value}"));
            c.exec(&format!("DEL {k}_s"));
            let big = c.key("tlsstr");
            c.exec(&format!("SET {big} {value}"));
            assert_eq!(c.text(&format!("GET {big}")), value);
        }
    }

    fn the_whole_command_set_works_over_tls_including_errors(s: &Server) {
        let c = s.conn_from(s.params_on(s.tls_port, "verify-full", next_db()));
        let k = c.key("tlsbasic");
        let r = c.exec(&format!("SET {k} v\nLPUSH {k} x\nGET {k}"));
        let list = ok(&r)["statements"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert!(message_of(&list[1]).starts_with("WRONGTYPE "), "{r}");
        assert_eq!(c.text(&format!("GET {k}")), "v");
    }

    /// Huỷ qua TLS: `cancelled` nhanh, nối lại vẫn đi qua TLS (không bao giờ thường) và giữ DB.
    fn cancel_over_tls_is_fast_and_the_reconnect_stays_encrypted(s: &Server) {
        let monitor = s.conn();
        let p = proxy(s.tls_port, "127.0.0.1", Refuse::Nothing).unwrap();
        let c = s.conn_from(s.params_on(p.port, "verify-full", 14));
        let (name, k) = (client_name("s3b_test_tlscancel"), c.key("blpop"));
        c.exec("SELECT 13");
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        wait_until_gone(&monitor, &name);
        assert!(c.text("CLIENT INFO").contains(" db=13 "));
        assert_eq!(p.tls(), 2, "một lúc mở, một lúc nối lại");
        assert_eq!(p.plain(), 0, "mọi kết nối phải là TLS");
    }

    /// Mode `allow` trên cổng TLS lên TLS sau khi thường bị từ chối; nối lại sau khi huỷ phải đi
    /// thẳng TLS (cấu hình thành công được nhớ), không thử thường lần nữa.
    fn the_reconnect_after_a_cancel_reuses_the_transport_that_worked(s: &Server) {
        let monitor = s.conn();
        let p = proxy(s.tls_port, "127.0.0.1", Refuse::Nothing).unwrap();
        let c = s.conn_from(s.params_on(p.port, "allow", 15));
        let (plain_before, tls_before) = (p.plain(), p.tls());
        assert!(plain_before >= 1 && tls_before >= 1);
        let (name, k) = (client_name("s3b_test_allowre"), c.key("blpop"));
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        ping(&c);
        assert_eq!(p.plain(), plain_before, "nối lại không được thử thường nữa");
        assert_eq!(p.tls(), tls_before + 1);
    }

    /// Ngược lại: `prefer` trên cổng thường lùi về thường; nối lại đi thẳng thường, không thử TLS.
    fn prefer_that_fell_back_to_plain_reconnects_plain_without_trying_tls(s: &Server) {
        let monitor = s.conn();
        let p = proxy(s.port, "127.0.0.1", Refuse::Nothing).unwrap();
        let c = s.conn_from(s.params_on(p.port, "prefer", 15));
        let (plain_before, tls_before) = (p.plain(), p.tls());
        assert!(plain_before >= 1 && tls_before >= 1);
        let (name, k) = (client_name("s3b_test_preferre"), c.key("blpop"));
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("CLIENT SETNAME {name}\nBLPOP {k} 0"));
        wait_until_blocked(&monitor, &name);
        cancel(id);
        assert_eq!(err_code(&t.join().unwrap()), "cancelled");
        ping(&c);
        assert_eq!(p.tls(), tls_before, "nối lại không được thử TLS nữa");
        assert_eq!(p.plain(), plain_before + 1);
    }

    fn many_tls_connections_open_and_query_in_parallel(s: &Server) {
        let params = s.params_on(s.tls_port, "verify-full", next_db());
        let handles: Vec<_> = (0..6)
            .map(|t| {
                let params = params.clone();
                std::thread::spawn(move || {
                    let id = ok(&call("open", params))["connId"].as_u64().unwrap();
                    for i in 0..20 {
                        let r = exec(id, &format!("ECHO t{t}_{i}"));
                        assert_eq!(stmt(&r, 0)["rows"], json!([[format!("t{t}_{i}")]]), "thread {t}");
                    }
                    call("close", json!({"connId": id}));
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    fn a_missing_password_over_tls_is_noauth_and_never_leaks(s: &Server) {
        let over = json!({"password": null});
        let r = call("open", s.params_on_with(s.tls_port, "require", next_db(), over));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(message(&r).contains("NOAUTH"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }
}
