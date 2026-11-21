//! Test TLS của driver PostgreSQL với server thật (`s3b-test-postgres`, `ssl=on`, chứng chỉ ký
//! bởi `test-env/certs/ca.pem`). Không có server thì mỗi test in `SKIP ...` rồi đạt.
//!
//! Dùng `pg_stat_ssl` để biết connection THẬT SỰ có mã hoá hay không, không chỉ tin vào việc `open`
//! thành công. Thứ tự thử `allow`/`prefer` khi server không nhận một trong hai kiểu được kiểm bằng
//! server giả ở unit test của `drivers/postgres/mod.rs`.

mod common;
mod pg_common;

use common::*;
use pg_common::*;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const MODES: [&str; 6] = [
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "verify-full",
];

/// Connection này có đang mã hoá không (theo server).
fn is_ssl(c: &Conn) -> bool {
    c.first("select ssl from pg_stat_ssl where pid = pg_backend_pid()") == "t"
}

fn message(r: &Value) -> &str {
    r["error"]["message"].as_str().unwrap_or("")
}

#[test]
fn every_mode_opens_and_pg_stat_ssl_matches_the_mode() {
    let Some(pg) = server("every_mode_opens") else {
        return;
    };
    // `allow` thử không mã hoá trước và server test chấp nhận nên ra `f`; `prefer` thử TLS trước.
    let expected = [
        ("disable", false),
        ("allow", false),
        ("prefer", true),
        ("require", true),
        ("verify-ca", true),
        ("verify-full", true),
    ];
    for (mode, ssl) in expected {
        let c = pg.connect(mode);
        assert_eq!(is_ssl(&c), ssl, "mode {mode}");
        assert_eq!(c.first("select 1"), "1", "mode {mode}");
    }
}

#[test]
fn require_and_prefer_do_not_need_a_ca_file() {
    let Some(pg) = server("require_without_ca") else {
        return;
    };
    for mode in ["allow", "prefer", "require"] {
        let r = call("open", pg.params_with(mode, json!({"tls": {"mode": mode}})));
        let c = Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
        };
        assert_eq!(c.first("select 1"), "1", "{mode}");
    }
}

#[test]
fn ca_file_is_ignored_when_the_mode_does_not_verify() {
    let Some(pg) = server("ca_file_ignored") else {
        return;
    };
    for mode in ["require", "prefer"] {
        let r = call(
            "open",
            pg.params_with(
                mode,
                json!({"tls": {"mode": mode, "caFile": "Z:/khong/ton/tai.pem"}}),
            ),
        );
        let c = Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
        };
        assert!(is_ssl(&c), "{mode}");
    }
}

#[test]
fn verify_modes_fail_with_an_unreadable_or_invalid_ca_file() {
    let Some(pg) = server("verify_bad_ca_file") else {
        return;
    };
    let dir = TempDir::new();
    let junk = dir.file("junk.pem");
    std::fs::write(&junk, "this is not a certificate").unwrap();
    for mode in ["verify-ca", "verify-full"] {
        for ca in [junk.as_str(), "Z:/khong/ton/tai.pem"] {
            let r = call(
                "open",
                pg.params_with(mode, json!({"tls": {"mode": mode, "caFile": ca}})),
            );
            assert_eq!(err_code(&r), "openFailed", "{mode} {ca}");
            assert!(!pg.password_leaks_in(&r));
        }
    }
}

#[test]
fn verify_modes_reject_a_server_whose_ca_is_not_trusted() {
    let Some(pg) = server("verify_untrusted_ca") else {
        return;
    };
    // Không có `caFile` thì dùng kho chứng chỉ Windows, nơi không có CA của test-env.
    for mode in ["verify-ca", "verify-full"] {
        let r = call("open", pg.params_with(mode, json!({"tls": {"mode": mode}})));
        assert_eq!(err_code(&r), "openFailed", "{mode}: {r}");
        assert!(!pg.password_leaks_in(&r));
    }
}

#[test]
fn verify_full_checks_the_host_name_but_verify_ca_does_not() {
    let Some(pg) = server("verify_full_hostname") else {
        return;
    };
    // `localhost` có trong SAN của chứng chỉ server nên verify-full qua.
    let r = call(
        "open",
        pg.params_with("verify-full", json!({"host": "localhost"})),
    );
    let c = Conn {
        id: ok(&r)["connId"].as_u64().unwrap(),
    };
    assert!(is_ssl(&c));
    drop(c);

    // `127.0.0.2` (proxy tới server) không có trong SAN: verify-full phải từ chối, các mode không
    // kiểm hostname vẫn qua.
    let Some((host, port)) = host_outside_the_certificate(pg.port) else {
        skip_or_fail(
            "SKIP verify_full_hostname (phần host ngoài chứng chỉ): không bind được 127.0.0.2",
        );
        return;
    };
    let other = json!({"host": host, "port": port});
    let r = call("open", pg.params_with("verify-full", other.clone()));
    assert_eq!(err_code(&r), "openFailed", "{r}");
    assert!(!pg.password_leaks_in(&r));
    for mode in ["verify-ca", "require"] {
        let r = call("open", pg.params_with(mode, other.clone()));
        let c = Conn {
            id: ok(&r)["connId"].as_u64().unwrap(),
        };
        assert!(is_ssl(&c), "{mode}");
    }
}

#[test]
fn wrong_password_is_open_failed_in_every_mode_without_leaking_it() {
    let Some(pg) = server("tls_wrong_password") else {
        return;
    };
    let wrong = pg.wrong_password();
    for mode in MODES {
        let r = call("open", pg.params_with(mode, json!({"password": wrong})));
        assert_eq!(err_code(&r), "openFailed", "{mode}");
        assert!(!r.to_string().contains(&wrong), "{mode}: {r}");
        assert!(!pg.password_leaks_in(&r), "{mode}");
    }
}

#[test]
fn unknown_tls_mode_is_invalid_request() {
    let Some(pg) = server("unknown_tls_mode") else {
        return;
    };
    let r = call("open", pg.params_with("yes-please", json!({})));
    assert_eq!(err_code(&r), "invalidRequest");
    assert!(!pg.password_leaks_in(&r));
}

#[test]
fn tls_connection_moves_large_results_correctly() {
    let Some(pg) = server("tls_large_results") else {
        return;
    };
    for mode in ["require", "verify-full"] {
        let c = pg.connect(mode);
        let r = c.exec("select repeat('é', 500000) as big, x from generate_series(1,3) x");
        let s = &statements(&r)[0];
        assert_eq!(s["rows"].as_array().unwrap().len(), 3);
        assert_eq!(s["rows"][2][0].as_str().unwrap().chars().count(), 500_000);
        assert_eq!(s["rows"][2][1], "3");
    }
}

#[test]
fn cancel_over_tls_returns_cancelled_and_the_connection_keeps_working() {
    let Some(pg) = server("cancel_over_tls") else {
        return;
    };
    let monitor = pg.conn();
    for mode in ["require", "verify-full"] {
        let c = pg.connect(mode);
        let m = marker("ctls");
        let id = next_id();
        let t = c.exec_in_thread(id, &format!("select 1 as x, '{m}' as m from pg_sleep(30)"));
        wait_until_active(&monitor, &m);
        let t0 = Instant::now();
        cancel(id);
        let r = t.join().unwrap();
        assert_eq!(err_code(&r), "cancelled", "{mode}: {r}");
        assert!(
            t0.elapsed() < Duration::from_secs(5),
            "{mode}: {:?}",
            t0.elapsed()
        );
        assert_eq!(c.first("select 1"), "1", "{mode}");
    }
}

#[test]
fn abandoning_a_cursor_over_tls_works() {
    let Some(pg) = server("abandon_over_tls") else {
        return;
    };
    for mode in ["require", "verify-full"] {
        let c = pg.connect(mode);
        let r = c.exec_page("select * from generate_series(1,3000000) x", 10, MAX_BYTES);
        assert_eq!(statements(&r)[0]["done"], false);
        let t0 = Instant::now();
        assert_eq!(c.first("select 5"), "5", "{mode}");
        assert!(
            t0.elapsed() < Duration::from_secs(10),
            "{mode}: {:?}",
            t0.elapsed()
        );
        // Huỷ câu phía server bằng connection TLS mới: trạng thái connection gốc vẫn sạch.
        assert!(is_ssl(&c), "{mode}");
    }
}

#[test]
fn error_text_of_a_failed_tls_open_has_no_secret_and_is_not_empty() {
    let Some(pg) = server("failed_tls_open_text") else {
        return;
    };
    let r = call(
        "open",
        pg.params_with("verify-full", json!({"tls": {"mode": "verify-full"}})),
    );
    assert_eq!(err_code(&r), "openFailed");
    assert!(!message(&r).is_empty());
    assert!(!pg.password_leaks_in(&r));
}
