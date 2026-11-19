//! Test TLS của driver MySQL và MariaDB với server thật (`s3b-test-mysql`, `s3b-test-mariadb`,
//! TLS tuỳ chọn, chứng chỉ ký bởi `test-env/certs/ca.pem`). Không có server thì mỗi test in
//! `SKIP ...` rồi đạt (xem `my_common`).
//!
//! Dùng `Ssl_cipher` của session để biết connection THẬT SỰ có mã hoá hay không, không chỉ tin vào
//! việc `open` thành công. Thứ tự thử `allow`/`prefer` khi server không nhận một trong hai kiểu
//! được kiểm bằng server giả ở unit test của `drivers/mysql/mod.rs`.

mod common;
mod my_common;

use common::*;
use my_common::*;
use serde_json::{Value, json};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

const MODES: [&str; 6] = [
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "verify-full",
];

/// Tên cipher của session (chuỗi rỗng nếu không mã hoá).
fn cipher(c: &Conn) -> String {
    let r = c.exec("show session status like 'Ssl_cipher'");
    ok(&r)["statements"][0]["rows"][0][1]
        .as_str()
        .unwrap_or("")
        .to_owned()
}

fn is_ssl(c: &Conn) -> bool {
    !cipher(c).is_empty()
}

fn message(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

/// Chuyển tiếp TCP từ `127.0.0.2:<cổng tự chọn>` tới server test. Chứng chỉ server chỉ có
/// `localhost`, `127.0.0.1`, `::1` và tên service nên `127.0.0.2` là host "không có trong SAN"
/// (Docker chỉ publish cổng ở 127.0.0.1 nên không nối thẳng tới 127.0.0.2 được). Trả `(host, cổng)`,
/// `None` nếu máy không bind được 127.0.0.2. Thread chuyển tiếp chạy tới hết tiến trình test.
fn host_outside_the_certificate(s: &Server) -> Option<(String, u16)> {
    let listener = TcpListener::bind(("127.0.0.2", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let target = SocketAddr::from(([127, 0, 0, 1], s.port));
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            let Ok(server) = TcpStream::connect(target) else {
                continue;
            };
            let (mut c_read, mut s_read) =
                (client.try_clone().unwrap(), server.try_clone().unwrap());
            let (mut c_write, mut s_write) = (client, server);
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut c_read, &mut s_write);
            });
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut s_read, &mut c_write);
            });
        }
    });
    Some(("127.0.0.2".to_owned(), port))
}

/// Nguồn dòng khổng lồ chạy ngay, có `marker` để nhận ra câu ở server.
fn endless_rows(marker: &str) -> String {
    format!(
        "with recursive c(x) as (select 1 union all select x+1 from c where x<500) \
         select a.x, '{marker}' as m from c a, c b, c d"
    )
}

both! {
    fn every_mode_opens_and_ssl_cipher_matches_the_mode(s: &Server) {
        // `allow` thử không mã hoá trước và server test chấp nhận nên không có cipher;
        // `prefer` thử TLS trước.
        let expected = [
            ("disable", false),
            ("allow", false),
            ("prefer", true),
            ("require", true),
            ("verify-ca", true),
            ("verify-full", true),
        ];
        for (mode, ssl) in expected {
            let c = s.connect(mode);
            assert_eq!(is_ssl(&c), ssl, "mode {mode}");
            assert_eq!(c.first("select 1"), "1", "mode {mode}");
        }
    }

    fn require_and_prefer_do_not_need_a_ca_file(s: &Server) {
        for mode in ["allow", "prefer", "require"] {
            let c = s.conn_with(mode, json!({"tls": {"mode": mode}}));
            assert_eq!(c.first("select 1"), "1", "{mode}");
        }
        let c = s.conn_with("require", json!({"tls": {"mode": "require"}}));
        assert!(is_ssl(&c));
    }

    fn ca_file_is_ignored_when_the_mode_does_not_verify(s: &Server) {
        for mode in ["require", "prefer"] {
            let c = s.conn_with(
                mode,
                json!({"tls": {"mode": mode, "caFile": "Z:/khong/ton/tai.pem"}}),
            );
            assert!(is_ssl(&c), "{mode}");
        }
    }

    fn verify_modes_fail_with_an_unreadable_or_invalid_ca_file(s: &Server) {
        let dir = TempDir::new();
        let junk = dir.file("junk.pem");
        std::fs::write(&junk, "this is not a certificate").unwrap();
        for mode in ["verify-ca", "verify-full"] {
            for ca in [junk.as_str(), "Z:/khong/ton/tai.pem"] {
                let r = call(
                    "open",
                    s.params_with(mode, json!({"tls": {"mode": mode, "caFile": ca}})),
                );
                assert_eq!(err_code(&r), "openFailed", "{mode} {ca}");
                assert!(message(&r).contains("caFile"), "{mode} {ca}: {r}");
                assert!(!s.password_leaks_in(&r));
            }
        }
    }

    fn verify_modes_reject_a_server_whose_ca_is_not_trusted(s: &Server) {
        // Không có `caFile` thì dùng kho chứng chỉ Windows + gốc webpki, nơi không có CA của test-env.
        for mode in ["verify-ca", "verify-full"] {
            let r = call("open", s.params_with(mode, json!({"tls": {"mode": mode}})));
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(message(&r).contains("UnknownIssuer"), "{mode}: {r}");
            assert!(!s.password_leaks_in(&r));
        }
    }

    fn verify_full_accepts_a_host_in_the_certificate(s: &Server) {
        // `localhost` và 127.0.0.1 có trong SAN của chứng chỉ server.
        for host in ["localhost", "127.0.0.1"] {
            let c = s.conn_with("verify-full", json!({"host": host}));
            assert!(is_ssl(&c), "{host}");
        }
    }

    fn verify_full_rejects_a_host_not_in_the_certificate_but_require_accepts_it(s: &Server) {
        let Some((host, port)) = host_outside_the_certificate(s) else {
            println!("SKIP verify_full_hostname: không bind được 127.0.0.2");
            return;
        };
        let over = json!({"host": host, "port": port});
        let r = call("open", s.params_with("verify-full", over.clone()));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(!s.password_leaks_in(&r));
        let c = s.conn_with("require", over);
        assert!(is_ssl(&c));
    }

    /// GIỚI HẠN ĐÃ BIẾT (mô tả hành vi hiện tại): `verify-ca` đáng lẽ chỉ kiểm chuỗi chứng chỉ mà
    /// không kiểm tên host, nhưng kết quả thật là `verify-ca` chặt như `verify-full`. Khi sửa được
    /// thì test này phải đổi sang assert `verify-ca` mở được.
    fn known_limit_verify_ca_still_rejects_a_host_not_in_the_certificate(s: &Server) {
        let Some((host, port)) = host_outside_the_certificate(s) else {
            println!("SKIP known_limit_verify_ca: không bind được 127.0.0.2");
            return;
        };
        let over = json!({"host": host, "port": port});
        let r = call("open", s.params_with("verify-ca", over));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(message(&r).contains("not valid for name"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn wrong_password_is_open_failed_in_every_mode_without_leaking_it(s: &Server) {
        let wrong = s.wrong_password();
        for mode in MODES {
            let r = call("open", s.params_with(mode, json!({"password": wrong})));
            assert_eq!(err_code(&r), "openFailed", "{mode}");
            assert!(message(&r).starts_with("ERROR 1045"), "{mode}: {r}");
            assert!(!r.to_string().contains(&wrong), "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
        }
    }

    fn wrong_database_is_open_failed_over_tls(s: &Server) {
        let r = call(
            "open",
            s.params_with("require", json!({"database": "no_such_db_zz"})),
        );
        assert_eq!(err_code(&r), "openFailed");
        assert!(message(&r).starts_with("ERROR 1049"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn unknown_tls_mode_is_invalid_request(s: &Server) {
        let r = call("open", s.params_with("yes-please", json!({})));
        assert_eq!(err_code(&r), "invalidRequest");
        assert!(!s.password_leaks_in(&r));
    }

    fn tls_connection_moves_large_results_correctly(s: &Server) {
        for mode in ["require", "verify-full"] {
            let c = s.connect(mode);
            let r = c.exec("select repeat('é', 500000) as big, 3 as x");
            let st = &statements(&r)[0];
            assert_eq!(st["rows"][0][0].as_str().unwrap().chars().count(), 500_000);
            assert_eq!(st["rows"][0][1], "3");
        }
    }

    fn cancel_over_tls_returns_cancelled_and_the_connection_keeps_working(s: &Server) {
        let monitor = s.conn();
        for mode in ["require", "verify-full"] {
            let c = s.connect(mode);
            let m = marker("ctls");
            let id = next_id();
            let t = c.exec_in_thread(id, &format!("select sleep(30), '{m}' as m"));
            wait_until_active(&monitor, &m);
            let t0 = Instant::now();
            cancel(id);
            let r = t.join().unwrap();
            assert_eq!(err_code(&r), "cancelled", "{mode}: {r}");
            assert!(t0.elapsed() < Duration::from_secs(5), "{mode}: {:?}", t0.elapsed());
            assert_eq!(c.first("select 1"), "1", "{mode}");
            // KILL đi bằng connection thứ hai nhưng connection chính vẫn là TLS.
            assert!(is_ssl(&c), "{mode}");
        }
    }

    fn abandoning_a_cursor_over_tls_works(s: &Server) {
        for mode in ["require", "verify-full"] {
            let c = s.connect(mode);
            let r = c.exec_page(&endless_rows(&marker("atls")), 10, MAX_BYTES);
            assert_eq!(statements(&r)[0]["done"], false, "{mode}");
            let t0 = Instant::now();
            assert_eq!(c.first("select 5"), "5", "{mode}");
            assert!(t0.elapsed() < Duration::from_secs(10), "{mode}: {:?}", t0.elapsed());
            assert!(is_ssl(&c), "{mode}");
        }
    }

    fn error_text_of_a_failed_tls_open_has_no_secret_and_is_not_empty(s: &Server) {
        let r = call(
            "open",
            s.params_with("verify-full", json!({"tls": {"mode": "verify-full"}})),
        );
        assert_eq!(err_code(&r), "openFailed");
        assert!(!message(&r).is_empty());
        assert!(!s.password_leaks_in(&r));
    }
}
