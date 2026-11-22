//! Test TLS của driver MongoDB với server thật (`s3b-test-mongo`, `--tlsMode allowTLS`: nhận cả
//! kết nối thường lẫn TLS, không đòi chứng chỉ client). Không có server thì mỗi test in `SKIP ...`
//! rồi đạt.
//!
//! Cách biết kết nối có mã hoá thật: mỗi test đặt một PROXY TCP nghe thử byte đầu của từng kết nối
//! client mở (TLS bắt đầu bằng record `0x16 0x03`, giao thức MongoDB thường bắt đầu bằng độ dài
//! message nên byte thứ hai không bao giờ là `0x03`) rồi chuyển tiếp tới server thật. Nhờ vậy đếm
//! được từng kiểu kết nối của CHÍNH test đó, không phụ thuộc bộ đếm toàn cục của server (các test
//! chạy song song). Proxy còn từ chối được một kiểu (để thử fallback) và đặt được ở `127.0.0.2`
//! (host ngoài chứng chỉ).
//!
//! Chứng chỉ server ký bởi CA của `test-env/certs/ca.pem`, SAN gồm `localhost` và `127.0.0.1`.
//! Driver `mongodb` nối lại tới khi hết thời gian chọn server nên mọi lỗi nối đều mất cỡ 10 giây
//! (`CONNECT_TIMEOUT`); các test lỗi nối vì thế chạy các mode song song trong thread riêng.

mod common;
mod mongo_common;

use common::*;
use mongo_common::*;
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

/// Proxy nghe ở `bind` tới server thật. `None` nếu không bind được (ví dụ `127.0.0.2`).
fn proxy(s: &Server, bind: &str, refuse: Refuse) -> Option<Proxy> {
    let listener = TcpListener::bind((bind, 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let target = SocketAddr::from(([127, 0, 0, 1], s.port));
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

fn message(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

fn ping(c: &Conn) {
    assert_eq!(c.doc(r#"{"ping":1}"#)["ok"], 1.0);
}

/// `open` chạy ở thread riêng để nhiều lần chờ-hết-hạn chạy song song.
fn open_in_thread(params: Value) -> std::thread::JoinHandle<(Value, Duration)> {
    std::thread::spawn(move || {
        let t0 = Instant::now();
        let r = call("open", params);
        (r, t0.elapsed())
    })
}

mongo! {
    /// `disable` và `allow` nói chuyện thường (server không bắt buộc TLS), các mode còn lại mã hoá.
    fn every_mode_opens_and_the_transport_matches_the_mode(s: &Server) {
        for mode in MODES {
            let p = proxy(s, "127.0.0.1", Refuse::Nothing).unwrap();
            let c = s.conn_with(mode, json!({"port": p.port}));
            ping(&c);
            let encrypted = !matches!(mode, "disable" | "allow");
            if encrypted {
                assert!(p.tls() >= 1 && p.plain() == 0, "{mode}: tls={} plain={}", p.tls(), p.plain());
            } else {
                assert!(p.plain() >= 1 && p.tls() == 0, "{mode}: tls={} plain={}", p.tls(), p.plain());
            }
        }
    }

    /// `allow`: thử thường trước; server (proxy) từ chối thường thì dùng TLS trong phần thời gian
    /// còn lại của lần thứ hai.
    fn allow_falls_back_to_tls_when_plain_is_refused(s: &Server) {
        let p = proxy(s, "127.0.0.1", Refuse::Plain).unwrap();
        let t0 = Instant::now();
        let c = s.conn_with("allow", json!({"port": p.port}));
        ping(&c);
        assert!(p.plain() >= 1, "phải thử thường trước");
        assert!(p.tls() >= 1, "rồi mới tới TLS");
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    }

    /// `prefer`: thử TLS trước; bị từ chối thì dùng kết nối thường.
    fn prefer_falls_back_to_plain_when_tls_is_refused(s: &Server) {
        let p = proxy(s, "127.0.0.1", Refuse::Tls).unwrap();
        let t0 = Instant::now();
        let c = s.conn_with("prefer", json!({"port": p.port}));
        ping(&c);
        assert!(p.tls() >= 1, "phải thử TLS trước");
        assert!(p.plain() >= 1, "rồi mới tới thường");
        assert!(t0.elapsed() < Duration::from_secs(10), "{:?}", t0.elapsed());
    }

    /// `require` và `verify-*` không bao giờ hạ xuống kết nối thường, `disable` không bao giờ lên
    /// TLS: khi kiểu duy nhất của mode bị từ chối thì `open` lỗi và không mở kiểu kia.
    fn modes_never_switch_to_the_other_transport_when_theirs_is_refused(s: &Server) {
        let cases = [
            ("require", Refuse::Tls),
            ("verify-ca", Refuse::Tls),
            ("verify-full", Refuse::Tls),
            ("disable", Refuse::Plain),
        ];
        let runs: Vec<_> = cases
            .into_iter()
            .map(|(mode, refuse)| {
                let p = proxy(s, "127.0.0.1", refuse).unwrap();
                let h = open_in_thread(s.params_with(mode, json!({"port": p.port})));
                (mode, p, h)
            })
            .collect();
        for (mode, p, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < Duration::from_secs(20), "{mode}: {took:?}");
            if mode == "disable" {
                assert_eq!(p.tls(), 0, "disable không được thử TLS");
            } else {
                assert_eq!(p.plain(), 0, "{mode} không được thử kết nối thường");
            }
        }
    }

    /// Server đã trả lời và từ chối (sai mật khẩu) thì dừng ngay, không thử kiểu kết nối kia: `allow`
    /// chỉ mở kết nối thường, `prefer` chỉ mở TLS. Nhanh (không chờ hết thời gian nối).
    fn wrong_password_stops_at_once_without_trying_the_other_transport(s: &Server) {
        let wrong = s.wrong_password();
        for mode in MODES {
            let p = proxy(s, "127.0.0.1", Refuse::Nothing).unwrap();
            let t0 = Instant::now();
            let r = call("open", s.params_with(mode, json!({"port": p.port, "password": wrong})));
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(message(&r).contains("Authentication failed"), "{mode}: {r}");
            assert!(!r.to_string().contains(&wrong), "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(t0.elapsed() < Duration::from_secs(5), "{mode}: {:?}", t0.elapsed());
            match mode {
                "disable" | "allow" => assert_eq!(p.tls(), 0, "{mode}: không được thử TLS"),
                _ => assert_eq!(p.plain(), 0, "{mode}: không được thử kết nối thường"),
            }
        }
    }

    fn verify_modes_accept_the_names_in_the_certificate_with_the_ca_file(s: &Server) {
        for mode in ["verify-ca", "verify-full"] {
            for host in ["localhost", "127.0.0.1"] {
                let c = s.conn_with(mode, json!({"host": host}));
                ping(&c);
            }
        }
    }

    fn require_prefer_and_allow_do_not_need_a_ca_file(s: &Server) {
        for mode in ["allow", "prefer", "require"] {
            let c = s.conn_with(mode, json!({"tls": {"mode": mode}}));
            ping(&c);
        }
    }

    fn ca_file_is_ignored_when_the_mode_does_not_verify(s: &Server) {
        for mode in ["disable", "allow", "prefer", "require"] {
            let c = s.conn_with(mode, json!({"tls": {"mode": mode, "caFile": "Z:/no/such/ca.pem"}}));
            ping(&c);
        }
    }

    fn verify_modes_with_a_missing_or_junk_ca_file_fail_naming_the_ca_file(s: &Server) {
        let junk = std::env::temp_dir().join(format!("s3b_junk_mongo_ca_{}.pem", std::process::id()));
        std::fs::write(&junk, "this is not a certificate").unwrap();
        for mode in ["verify-ca", "verify-full"] {
            for ca in ["Z:/no/such/ca-secret-name.pem".to_owned(), junk.to_string_lossy().into_owned()] {
                let t0 = Instant::now();
                let r = call("open", s.params_with(mode, json!({"tls": {"mode": mode, "caFile": ca}})));
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

    /// Không có `caFile` thì verify dùng kho chứng chỉ gốc của Windows, không có CA của test-env nên
    /// chứng chỉ bị từ chối.
    fn verify_modes_without_a_ca_file_reject_the_untrusted_test_ca(s: &Server) {
        let runs: Vec<_> = ["verify-ca", "verify-full"]
            .into_iter()
            .map(|mode| (mode, open_in_thread(s.params_with(mode, json!({"tls": {"mode": mode}})))))
            .collect();
        for (mode, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < Duration::from_secs(20), "{mode}: {took:?}");
        }
    }

    /// `caFile` là CA khác (không ký chứng chỉ của server) thì bị từ chối.
    fn verify_modes_reject_a_ca_that_did_not_sign_the_server_certificate(s: &Server) {
        let other = format!("{}/tests/fixtures/ca_other.pem", env!("CARGO_MANIFEST_DIR"));
        let runs: Vec<_> = ["verify-ca", "verify-full"]
            .into_iter()
            .map(|mode| {
                let p = s.params_with(mode, json!({"tls": {"mode": mode, "caFile": other}}));
                (mode, open_in_thread(p))
            })
            .collect();
        for (mode, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < Duration::from_secs(20), "{mode}: {took:?}");
        }
    }

    /// Host ngoài chứng chỉ (proxy `127.0.0.2`): `verify-full` từ chối, `require` vẫn nhận.
    /// `verify-ca` cũng từ chối: GIỚI HẠN ĐÃ BIẾT, `mongodb` không có chế độ kiểm chuỗi mà bỏ qua
    /// hostname (khi sửa được thì dòng `verify-ca` phải đổi sang mong đợi mở được).
    fn verify_modes_reject_a_host_not_in_the_certificate_but_require_accepts_it(s: &Server) {
        let Some(p) = proxy(s, "127.0.0.2", Refuse::Nothing) else {
            skip_or_fail("SKIP verify hostname: không bind được 127.0.0.2");
            return;
        };
        let over = json!({"host": "127.0.0.2", "port": p.port});
        let runs: Vec<_> = ["verify-ca", "verify-full"]
            .into_iter()
            .map(|mode| (mode, open_in_thread(s.params_with(mode, over.clone()))))
            .collect();
        let c = s.conn_with("require", over);
        ping(&c);
        assert!(p.tls() >= 1);
        for (mode, h) in runs {
            let (r, took) = h.join().unwrap();
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
            assert!(took < Duration::from_secs(20), "{mode}: {took:?}");
        }
    }

    fn unknown_tls_mode_is_invalid_request(s: &Server) {
        let r = call("open", s.params_with("yes-please", json!({})));
        assert_eq!(err_code(&r), "invalidRequest");
        assert!(!s.password_leaks_in(&r));
    }

    fn big_results_and_paging_work_over_tls(s: &Server) {
        for mode in ["require", "verify-full"] {
            let c = s.connect(mode);
            let db = c.scratch_db("tlsbig");
            c.seed(&db, "c", 1234, 100);
            let q = cmd("find", json!("c"), json!({"sort": {"_id": 1}}), Some(&db));
            let r = c.exec_page(&q, 500, MAX_BYTES);
            let st = &ok(&r)["statements"][0];
            let pages = walk(&c, st, 500, MAX_BYTES);
            assert_eq!(pages.iter().flatten().copied().collect::<Vec<_>>(), (0..1234).collect::<Vec<i64>>());
            let text: String = "é".repeat(500_000);
            let ins = cmd("insert", json!("big"), json!({"documents": [{"_id": 1, "t": text}]}), Some(&db));
            assert_eq!(ok(&c.exec(&ins))["statements"][0]["rowsAffected"], 1);
            let back = c.doc(&cmd("find", json!("big"), json!({}), Some(&db)));
            assert_eq!(back["t"].as_str().unwrap().chars().count(), 500_000);
        }
    }

    /// Huỷ qua TLS: `cancelled` nhanh, connection dùng lại được và vẫn đi qua TLS.
    fn cancel_over_tls_is_fast_and_the_connection_stays_encrypted(s: &Server) {
        let monitor = s.conn();
        let p = proxy(s, "127.0.0.1", Refuse::Nothing).unwrap();
        let c = s.conn_with("verify-full", json!({"port": p.port}));
        let db = c.scratch_db("tlscancel");
        c.seed(&db, "c", 2, 0);
        let m = marker("tls_cancel");
        let text = cmd(
            "find",
            json!("c"),
            json!({"filter": {"$where": "sleep(6000) || true"}, "comment": m}),
            Some(&db),
        );
        let id = next_id();
        let t = c.exec_in_thread(id, &text);
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());
        ping(&c);
        assert_eq!(p.plain(), 0, "mọi kết nối phải là TLS");
    }

    /// Bỏ cursor qua TLS: server vẫn nhận `killCursors` và đóng cursor.
    fn abandoning_a_cursor_over_tls_closes_it_on_the_server(s: &Server) {
        let monitor = s.conn();
        let c = s.connect("verify-full");
        let db = c.scratch_db("tlsabandon");
        c.seed(&db, "c", 100, 0);
        let q = cmd("find", json!("c"), json!({"sort": {"_id": 1}}), Some(&db));
        let r = c.exec_page(&q, 10, MAX_BYTES);
        assert_eq!(ok(&r)["statements"][0]["done"], false);
        assert_eq!(monitor.idle_cursors(&db, "c"), 1);
        ping(&c);
        wait_until_no_cursors(&monitor, &db, "c");
    }
}
