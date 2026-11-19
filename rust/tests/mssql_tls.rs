//! Test TLS của driver SQL Server với server thật (`s3b-test-mssql`, `forceencryption = 0`: cho
//! phép cả client không mã hoá). Không có server thì mỗi test in `SKIP ...` rồi đạt.
//!
//! Cách biết connection có mã hoá thật: `sys.dm_exec_connections.encrypt_option` của chính
//! session (`TRUE`/`FALSE`), không suy từ việc `open` thành công.
//!
//! Chứng chỉ server ký bởi CA của `test-env/certs/ca.pem`, SAN gồm `localhost` và `127.0.0.1`.

mod common;
mod mssql_common;

use common::*;
use mssql_common::*;
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

fn message(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

/// Session này có mã hoá không (theo server).
fn is_encrypted(c: &Conn) -> bool {
    c.first("SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id = @@SPID")
        == "TRUE"
}

/// `net_packet_size` của session hiện tại.
fn packet_size(c: &Conn) -> u32 {
    c.first("SELECT net_packet_size FROM sys.dm_exec_connections WHERE session_id = @@SPID")
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

/// Proxy TCP ở `127.0.0.2` tới server thật: chứng chỉ không có `127.0.0.2` trong SAN nên đây là
/// host "ngoài chứng chỉ" (Docker chỉ publish cổng ở 127.0.0.1). `None` nếu không bind được.
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

mssql! {
    /// Plan 10.5: `disable`/`allow` không mã hoá (server không bắt buộc), `prefer`/`require`/
    /// `verify-*` có mã hoá.
    fn every_mode_opens_and_encrypt_option_matches_the_mode(s: &Server) {
        let expected = [
            ("disable", false),
            ("allow", false),
            ("prefer", true),
            ("require", true),
            ("verify-ca", true),
            ("verify-full", true),
        ];
        for (mode, encrypted) in expected {
            let c = s.connect(mode);
            assert_eq!(is_encrypted(&c), encrypted, "mode {mode}");
            assert_eq!(c.first("SELECT 1"), "1", "mode {mode}");
        }
    }

    /// Driver luôn xin packet 32767. Server cấp 32576 khi không mã hoá nhưng chỉ 16554 khi có TLS
    /// (SQL Server giới hạn packet của connection mã hoá quanh 16 KiB): lệch so với plan 10.8 N7
    /// ("đúng giá trị yêu cầu") do server, không do driver. Test khoá hành vi: vẫn lớn hơn mặc
    /// định 4096 ở mọi mode.
    fn packet_size_stays_large_in_every_mode(s: &Server) {
        for mode in MODES {
            let c = s.connect(mode);
            let size = packet_size(&c);
            let range = if is_encrypted(&c) { 16_000..=32_767 } else { 32_000..=32_767 };
            assert!(range.contains(&size), "mode {mode}: {size}");
        }
    }

    fn require_prefer_and_allow_do_not_need_a_ca_file(s: &Server) {
        for mode in ["allow", "prefer", "require"] {
            let c = s.conn_with(mode, json!({"tls": {"mode": mode}}));
            assert_eq!(c.first("SELECT 1"), "1", "{mode}");
        }
        let c = s.conn_with("require", json!({"tls": {"mode": "require"}}));
        assert!(is_encrypted(&c));
    }

    fn ca_file_is_ignored_when_the_mode_does_not_verify(s: &Server) {
        for mode in ["require", "prefer"] {
            let c = s.conn_with(mode, json!({"tls": {"mode": mode, "caFile": "Z:/no/such/ca.pem"}}));
            assert_eq!(c.first("SELECT 1"), "1", "{mode}");
        }
    }

    fn verify_modes_with_a_missing_or_junk_ca_file_fail_naming_the_ca_file(s: &Server) {
        let junk = std::env::temp_dir().join(format!("s3b_junk_ca_{}.pem", std::process::id()));
        std::fs::write(&junk, "this is not a certificate").unwrap();
        for mode in ["verify-ca", "verify-full"] {
            for ca in ["Z:/no/such/ca-secret-name.pem".to_owned(), junk.to_string_lossy().into_owned()] {
                let r = call("open", s.params_with(mode, json!({"tls": {"mode": mode, "caFile": ca}})));
                assert_eq!(err_code(&r), "openFailed", "{mode} {ca}");
                assert!(message(&r).contains("caFile"), "{mode} {ca}: {r}");
                assert!(!r.to_string().contains("ca-secret-name"), "{r}");
                assert!(!s.password_leaks_in(&r));
            }
        }
        let _ = std::fs::remove_file(&junk);
    }

    /// Không có `caFile` thì verify dùng kho chứng chỉ hệ thống, không có CA của test-env nên
    /// chứng chỉ bị từ chối (và không lộ mật khẩu).
    fn verify_modes_without_a_ca_file_reject_the_untrusted_test_ca(s: &Server) {
        for mode in ["verify-ca", "verify-full"] {
            let r = call("open", s.params_with(mode, json!({"tls": {"mode": mode}})));
            assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
        }
    }

    fn verify_full_accepts_the_names_in_the_certificate(s: &Server) {
        for host in ["localhost", "127.0.0.1"] {
            let c = s.conn_with("verify-full", json!({"host": host}));
            assert!(is_encrypted(&c), "{host}");
            assert_eq!(c.first("SELECT 1"), "1", "{host}");
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
        assert!(is_encrypted(&c));
        assert_eq!(c.first("SELECT 1"), "1");
    }

    /// GIỚI HẠN ĐÃ BIẾT (mô tả hành vi hiện tại): plan 10.5 nói `verify-ca` chỉ kiểm chuỗi chứng
    /// chỉ, không kiểm tên host, nhưng `tiberius` không có chế độ đó nên `verify-ca` chặt như
    /// `verify-full`. Khi sửa được thì test này phải đổi sang assert `verify-ca` mở được.
    fn known_limit_verify_ca_still_rejects_a_host_not_in_the_certificate(s: &Server) {
        let Some((host, port)) = host_outside_the_certificate(s) else {
            println!("SKIP known_limit_verify_ca: không bind được 127.0.0.2");
            return;
        };
        let r = call("open", s.params_with("verify-ca", json!({"host": host, "port": port})));
        assert_eq!(err_code(&r), "openFailed", "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn wrong_password_is_open_failed_in_every_mode_without_leaking_it(s: &Server) {
        let wrong = s.wrong_password();
        for mode in MODES {
            let r = call("open", s.params_with(mode, json!({"password": wrong})));
            assert_eq!(err_code(&r), "openFailed", "{mode}");
            assert!(message(&r).contains("Login failed"), "{mode}: {r}");
            assert!(!r.to_string().contains(&wrong), "{mode}: {r}");
            assert!(!s.password_leaks_in(&r), "{mode}");
        }
    }

    fn wrong_database_is_open_failed_over_tls(s: &Server) {
        let r = call("open", s.params_with("require", json!({"database": "no_such_db_zz"})));
        assert_eq!(err_code(&r), "openFailed");
        assert!(message(&r).contains("no_such_db_zz"), "{r}");
        assert!(!s.password_leaks_in(&r));
    }

    fn unknown_tls_mode_is_invalid_request(s: &Server) {
        let r = call("open", s.params_with("yes-please", json!({})));
        assert_eq!(err_code(&r), "invalidRequest");
        assert!(!s.password_leaks_in(&r));
    }

    fn big_results_and_paging_work_over_tls(s: &Server) {
        let c = s.connect("require");
        let r = c.exec("SELECT REPLICATE(CAST(N'é' AS nvarchar(max)), 500000) AS big");
        assert_eq!(first_cell(&r).as_str().unwrap().chars().count(), 500_000);
        let r = c.exec_page(&series_ms(1234), 500, MAX_BYTES);
        let cursor = ok(&r)["statements"][0]["cursorId"].as_u64().unwrap();
        let mut total = 500;
        loop {
            let f = c.fetch_page(cursor, 500, MAX_BYTES);
            let page = ok(&f);
            total += page["rows"].as_array().unwrap().len();
            if page["done"] == true {
                break;
            }
        }
        assert_eq!(total, 1234);
        assert!(is_encrypted(&c));
    }

    /// Huỷ qua TLS: `cancelled` nhanh; connection nối lại vẫn mã hoá, vẫn packet lớn, session mới.
    fn cancel_over_tls_is_fast_and_the_new_connection_is_still_encrypted(s: &Server) {
        let monitor = s.conn();
        let c = s.connect("require");
        let old_link = c.link();
        let size_before = packet_size(&c);
        let m = marker("tls_cancel");
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("WAITFOR DELAY '00:00:30'; SELECT '{m}' AS m"));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{r}");
        assert!(t0.elapsed() < Duration::from_secs(2), "{:?}", t0.elapsed());

        assert_eq!(c.first("SELECT 1"), "1");
        assert_ne!(c.link(), old_link);
        assert!(is_encrypted(&c), "nối lại phải giữ TLS");
        // Connection nối lại có packet size bằng connection đầu (cùng cấu hình), không rơi về 4096.
        assert_eq!(packet_size(&c), size_before);
        wait_until_gone(&monitor, &m);
    }

    /// Bỏ cursor vô tận qua TLS rồi chạy lệnh kế: connection thay mới vẫn mã hoá (verify-full).
    fn abandoning_a_cursor_over_tls_keeps_the_connection_encrypted(s: &Server) {
        let monitor = s.conn();
        let c = s.connect("verify-full");
        let m = marker("tls_abandon");
        let r = c.exec_page(&endless_rows(&m), 10, MAX_BYTES);
        assert_eq!(ok(&r)["statements"][0]["done"], false);
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        assert_eq!(c.first("SELECT 5"), "5");
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
        assert!(is_encrypted(&c));
        wait_until_gone(&monitor, &m);
    }

    /// Server bị `KILL` qua TLS: lệnh kế lỗi một lần rồi nối lại, vẫn mã hoá.
    fn a_killed_tls_session_reconnects_encrypted(s: &Server) {
        let monitor = s.conn();
        let c = s.connect("require");
        let old = c.spid();
        ok(&monitor.exec(&format!("KILL {old}")));
        wait_for(Duration::from_secs(10), "session bị kill", || {
            !session_exists(&monitor, &old)
        });
        let r = c.exec("SELECT 1");
        assert!(r["ok"] == false || !statements(&r)[0]["error"].is_null(), "{r}");
        assert_eq!(c.first("SELECT 2"), "2");
        assert!(is_encrypted(&c));
    }
}
