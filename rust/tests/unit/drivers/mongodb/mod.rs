use super::*;
use mongodb::error::CommandError;
use serde_json::json;
use std::net::TcpListener;

const PASSWORD: &str = "super-secret-pw";

fn params(v: serde_json::Value) -> OpenParams {
    serde_json::from_value(v).expect("params hợp lệ")
}

fn base(mode: &str) -> OpenParams {
    params(json!({
        "driver": "mongodb", "host": "db.example", "port": 12345,
        "username": "root", "password": PASSWORD, "tls": {"mode": mode}
    }))
}

fn fx(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

/// Cổng chắc chắn không có ai nghe: bind rồi nhả ngay.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Dạng gọn của kế hoạch TLS: `None` = thường, `Some(true)` = TLS không kiểm chứng chỉ,
/// `Some(false)` = TLS kiểm chứng chỉ.
fn plan(options: &[ClientOptions]) -> Vec<Option<bool>> {
    options
        .iter()
        .map(|o| match &o.tls {
            None => None,
            Some(Tls::Enabled(t)) => Some(t.allow_invalid_certificates == Some(true)),
            Some(Tls::Disabled) => panic!("không dùng Tls::Disabled"),
        })
        .collect()
}

fn command_error(code: i32, name: &str, message: &str) -> MongoError {
    let c: CommandError =
        serde_json::from_value(json!({"code": code, "codeName": name, "errmsg": message})).unwrap();
    ErrorKind::Command(c).into()
}

// ---- budget ----

#[test]
fn budget_splits_the_connect_timeout_evenly() {
    assert_eq!(budget(1), CONNECT_TIMEOUT);
    assert_eq!(budget(2), CONNECT_TIMEOUT / 2);
    assert_eq!(budget(4), CONNECT_TIMEOUT / 4);
}

#[test]
fn budget_of_zero_tries_does_not_divide_by_zero() {
    assert_eq!(budget(0), CONNECT_TIMEOUT);
}

#[test]
fn budget_with_an_absurd_number_of_tries_does_not_panic() {
    // `u32::try_from` thất bại thì lùi về 1 lần, không panic.
    assert_eq!(budget(usize::MAX), CONNECT_TIMEOUT);
}

// ---- attempts: địa chỉ, tài khoản ----

#[test]
fn attempts_use_the_default_port_when_none_is_given() {
    let p = params(json!({"driver": "mongodb", "host": "h"}));
    let o = attempts(&p, "h").unwrap();
    assert_eq!(
        o[0].hosts,
        vec![ServerAddress::Tcp {
            host: "h".to_owned(),
            port: Some(27017)
        }]
    );
}

#[test]
fn attempts_use_the_given_host_and_port() {
    let o = attempts(&base("disable"), "db.example").unwrap();
    assert_eq!(
        o[0].hosts,
        vec![ServerAddress::Tcp {
            host: "db.example".to_owned(),
            port: Some(12345)
        }]
    );
}

#[test]
fn attempts_connect_directly_to_the_one_server_with_the_app_name() {
    let o = attempts(&base("disable"), "db.example").unwrap();
    assert_eq!(o[0].direct_connection, Some(true));
    assert_eq!(o[0].app_name.as_deref(), Some("S3Browser"));
}

#[test]
fn attempts_authenticate_against_admin_with_the_given_account() {
    let o = attempts(&base("disable"), "db.example").unwrap();
    let c = o[0].credential.as_ref().expect("có credential");
    assert_eq!(c.username.as_deref(), Some("root"));
    assert_eq!(c.password.as_deref(), Some(PASSWORD));
    assert_eq!(c.source.as_deref(), Some("admin"));
}

#[test]
fn attempts_without_a_username_do_not_authenticate() {
    for user in [json!(null), json!("")] {
        let p = params(json!({
            "driver": "mongodb", "host": "h", "username": user, "password": PASSWORD
        }));
        let o = attempts(&p, "h").unwrap();
        assert!(
            o[0].credential.is_none(),
            "{user}: không auth khi thiếu username"
        );
    }
}

#[test]
fn attempts_accept_a_username_without_a_password() {
    let p = params(json!({"driver": "mongodb", "host": "h", "username": "u"}));
    let o = attempts(&p, "h").unwrap();
    let c = o[0].credential.as_ref().unwrap();
    assert_eq!(c.username.as_deref(), Some("u"));
    assert_eq!(c.password, None);
}

// ---- attempts: kế hoạch TLS cho từng mode ----

#[test]
fn tls_plan_per_mode_follows_libpq_order() {
    let cases: [(&str, Vec<Option<bool>>); 6] = [
        ("disable", vec![None]),
        ("allow", vec![None, Some(true)]),
        ("prefer", vec![Some(true), None]),
        ("require", vec![Some(true)]),
        // Có `caFile` hợp lệ để verify-* chạy được.
        ("verify-ca", vec![Some(false)]),
        ("verify-full", vec![Some(false)]),
    ];
    for (mode, expected) in cases {
        let mut p = base(mode);
        p.tls.ca_file = Some(fx("ca.pem"));
        let o = attempts(&p, "db.example").unwrap();
        assert_eq!(plan(&o), expected, "mode {mode}");
    }
}

#[test]
fn default_mode_is_disable() {
    let p = params(json!({"driver": "mongodb", "host": "h"}));
    assert_eq!(plan(&attempts(&p, "h").unwrap()), vec![None]);
}

#[test]
fn each_attempt_gets_an_equal_share_of_the_connect_timeout() {
    for (mode, tries) in [
        ("disable", 1u32),
        ("allow", 2),
        ("prefer", 2),
        ("require", 1),
    ] {
        let o = attempts(&base(mode), "db.example").unwrap();
        assert_eq!(o.len(), tries as usize, "{mode}");
        for one in &o {
            assert_eq!(one.connect_timeout, Some(CONNECT_TIMEOUT / tries), "{mode}");
            assert_eq!(
                one.server_selection_timeout,
                Some(CONNECT_TIMEOUT / tries),
                "{mode}"
            );
        }
    }
}

#[test]
fn unverified_modes_have_no_ca_file_even_if_one_is_given() {
    for mode in ["allow", "prefer", "require"] {
        let mut p = base(mode);
        p.tls.ca_file = Some(fx("ca.pem"));
        let o = attempts(&p, "db.example").unwrap();
        for one in o {
            if let Some(Tls::Enabled(t)) = one.tls {
                assert!(t.ca_file_path.is_none(), "{mode}");
                assert_eq!(t.allow_invalid_certificates, Some(true), "{mode}");
            }
        }
    }
}

#[test]
fn verify_modes_trust_only_the_given_ca_file() {
    for mode in ["verify-ca", "verify-full"] {
        let mut p = base(mode);
        p.tls.ca_file = Some(fx("ca.pem"));
        let o = attempts(&p, "db.example").unwrap();
        let Some(Tls::Enabled(t)) = &o[0].tls else {
            panic!("{mode}: phải bật TLS");
        };
        assert_eq!(t.ca_file_path, Some(PathBuf::from(fx("ca.pem"))), "{mode}");
        assert_ne!(t.allow_invalid_certificates, Some(true), "{mode}");
    }
}

#[test]
fn verify_modes_without_a_ca_file_use_the_system_roots() {
    for ca in [None, Some(String::new())] {
        for mode in ["verify-ca", "verify-full"] {
            let mut p = base(mode);
            p.tls.ca_file = ca.clone();
            let o = attempts(&p, "db.example").unwrap();
            let Some(Tls::Enabled(t)) = &o[0].tls else {
                panic!("{mode}: phải bật TLS");
            };
            assert!(t.ca_file_path.is_none(), "{mode} {ca:?}");
            assert_ne!(t.allow_invalid_certificates, Some(true), "{mode} {ca:?}");
        }
    }
}

#[test]
fn verify_modes_with_an_unreadable_ca_file_fail_without_leaking_the_path() {
    for mode in ["verify-ca", "verify-full"] {
        let mut p = base(mode);
        p.tls.ca_file = Some("Z:/khong/ton/tai/ca-secret-name.pem".to_owned());
        let Err(e) = attempts(&p, "db.example") else {
            panic!("{mode}: caFile không đọc được phải lỗi");
        };
        assert_eq!(e.code, OPEN_FAILED, "{mode}");
        assert!(e.message.contains("caFile"), "{mode}: {}", e.message);
        assert!(
            !e.message.contains("ca-secret-name"),
            "{mode}: {}",
            e.message
        );
        assert!(!e.message.contains(PASSWORD), "{mode}");
    }
}

#[test]
fn verify_modes_reject_a_ca_file_with_no_certificate() {
    // File tồn tại nhưng không phải PEM chứng chỉ (Cargo.toml).
    let mut p = base("verify-full");
    p.tls.ca_file = Some(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")));
    let Err(e) = attempts(&p, "db.example") else {
        panic!("file không có chứng chỉ phải lỗi");
    };
    assert_eq!(e.code, OPEN_FAILED);
    assert!(e.message.contains("caFile"), "{}", e.message);
}

#[test]
fn non_verify_modes_ignore_an_unreadable_ca_file() {
    for mode in ["disable", "allow", "prefer", "require"] {
        let mut p = base(mode);
        p.tls.ca_file = Some("Z:/khong/ton/tai/ca.pem".to_owned());
        assert!(attempts(&p, "db.example").is_ok(), "{mode}");
    }
}

// ---- error_text ----

#[test]
fn command_errors_read_name_code_and_message() {
    let e = command_error(59, "CommandNotFound", "no such command: 'x'");
    assert_eq!(error_text(&e), "CommandNotFound (59): no such command: 'x'");
}

#[test]
fn command_error_with_missing_name_and_message_still_formats() {
    let c: CommandError = serde_json::from_value(json!({"code": 13})).unwrap();
    let e: MongoError = ErrorKind::Command(c).into();
    assert_eq!(error_text(&e), " (13): ");
}

#[test]
fn other_errors_use_the_crate_display_text() {
    let e = MongoError::custom("bad thing");
    assert_eq!(error_text(&e), e.kind.to_string());
}

// ---- open / connect_any ----

#[tokio::test]
async fn open_requires_a_host() {
    for host in [json!(null), json!("")] {
        let p = params(json!({
            "driver": "mongodb", "host": host, "username": "u", "password": PASSWORD
        }));
        let Err(e) = open(p).await else {
            panic!("thiếu host phải lỗi");
        };
        assert_eq!(e.code, INVALID_REQUEST, "{host}");
        assert_eq!(e.message, "missing host");
    }
}

#[tokio::test]
async fn open_with_an_unreadable_ca_file_fails_before_connecting() {
    // Cổng đóng nhưng lỗi vẫn là về caFile (và trả ngay, không chờ hết timeout).
    let mut p = params(json!({
        "driver": "mongodb", "host": "127.0.0.1", "port": closed_port(),
        "username": "u", "password": PASSWORD, "tls": {"mode": "verify-full"}
    }));
    p.tls.ca_file = Some("Z:/khong/ton/tai/ca.pem".to_owned());
    let started = std::time::Instant::now();
    let Err(e) = open(p).await else {
        panic!("phải lỗi");
    };
    assert_eq!(e.code, OPEN_FAILED);
    assert!(e.message.contains("caFile"), "{}", e.message);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn connect_any_without_options_reports_a_generic_failure() {
    let Err(e) = connect_any(Vec::new()).await else {
        panic!("không có lần thử nào phải lỗi");
    };
    assert_eq!(e.code, OPEN_FAILED);
    assert_eq!(e.message, "connection failed");
}

/// Lần thử tới cổng đóng với timeout rất ngắn: lỗi là của lần thử cuối, không lộ mật khẩu.
#[tokio::test]
async fn connect_any_to_a_closed_port_reports_the_last_error_without_the_password() {
    let port = closed_port();
    let mut p = params(json!({
        "driver": "mongodb", "host": "127.0.0.1", "port": port,
        "username": "root", "password": PASSWORD, "tls": {"mode": "allow"}
    }));
    p.tls.ca_file = None;
    let mut tries = attempts(&p, "127.0.0.1").unwrap();
    assert_eq!(tries.len(), 2);
    for t in &mut tries {
        t.server_selection_timeout = Some(Duration::from_millis(300));
        t.connect_timeout = Some(Duration::from_millis(300));
    }
    let started = std::time::Instant::now();
    let Err(e) = connect_any(tries).await else {
        panic!("cổng đóng phải lỗi");
    };
    assert_eq!(e.code, OPEN_FAILED);
    assert!(!e.message.is_empty());
    assert!(!e.message.contains(PASSWORD), "{}", e.message);
    assert!(started.elapsed() < Duration::from_secs(8));
}

// ---- kho chứng chỉ hệ thống: needs_system_roots, RootsFile, new_client ----

/// Các test tạo file tạm chạy lần lượt để so tập file trước/sau không bị test khác chen vào.
static ROOTS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// File `s3b-ca-<pid hiện tại>-*.pem` đang có trong `%TEMP%`.
fn own_roots_files() -> Vec<PathBuf> {
    let prefix = format!("s3b-ca-{}-", std::process::id());
    std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .map(|e| e.path())
        .collect()
}

fn first_try(p: &OpenParams) -> ClientOptions {
    attempts(p, "db.example").unwrap().remove(0)
}

#[test]
fn needs_system_roots_only_for_verify_modes_without_a_ca_file() {
    for mode in ["verify-ca", "verify-full"] {
        for ca in [None, Some(String::new())] {
            let mut p = base(mode);
            p.tls.ca_file = ca.clone();
            assert!(needs_system_roots(&first_try(&p)), "{mode} {ca:?}");
        }
        let mut p = base(mode);
        p.tls.ca_file = Some(fx("ca.pem"));
        assert!(!needs_system_roots(&first_try(&p)), "{mode} có caFile");
    }
    for mode in ["disable", "allow", "prefer", "require"] {
        for one in attempts(&base(mode), "db.example").unwrap() {
            assert!(!needs_system_roots(&one), "{mode}");
        }
    }
}

#[test]
fn roots_file_holds_the_windows_store_as_pem_and_is_removed_on_drop() {
    use rustls::pki_types::CertificateDer;
    use rustls::pki_types::pem::PemObject;
    let _serial = ROOTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let guard = RootsFile::create().unwrap();
    let path = guard.0.clone();
    assert!(path.exists());
    let name = path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with(&format!("s3b-ca-{}-", std::process::id())),
        "{name}"
    );
    assert!(name.ends_with(".pem"), "{name}");
    let parsed: Vec<CertificateDer<'static>> = CertificateDer::pem_file_iter(&path)
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(!parsed.is_empty());
    assert_eq!(parsed, tls::root_certs_der(None).unwrap());
    drop(guard);
    assert!(!path.exists());
}

#[test]
fn roots_file_names_differ_between_creations() {
    let _serial = ROOTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let a = RootsFile::create().unwrap();
    let b = RootsFile::create().unwrap();
    assert_ne!(a.0, b.0);
    assert!(a.0.exists() && b.0.exists());
}

#[tokio::test]
async fn new_client_removes_its_temporary_roots_file() {
    let _serial = ROOTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let before = own_roots_files();
    for mode in ["verify-ca", "verify-full"] {
        let mut p = base(mode);
        p.tls.ca_file = None;
        let opts = first_try(&p);
        assert!(needs_system_roots(&opts));
        let client = new_client(opts).expect("dựng client không chạm mạng");
        // Crate đã đọc xong file nên file đã bị xoá dù client còn sống.
        assert_eq!(own_roots_files(), before, "{mode}");
        drop(client);
    }
}

#[tokio::test]
async fn new_client_with_an_unreadable_ca_file_errors_and_leaves_no_temporary_file() {
    let _serial = ROOTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut p = base("verify-full");
    p.tls.ca_file = Some(fx("ca.pem"));
    let mut opts = first_try(&p);
    if let Some(Tls::Enabled(t)) = &mut opts.tls {
        t.ca_file_path = Some(PathBuf::from("Z:/khong/ton/tai/ca.pem"));
    }
    let before = own_roots_files();
    assert!(new_client(opts).is_err());
    assert_eq!(own_roots_files(), before);
}

#[tokio::test]
async fn new_client_without_verification_creates_no_temporary_file() {
    let _serial = ROOTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let before = own_roots_files();
    for mode in ["disable", "require"] {
        for opts in attempts(&base(mode), "db.example").unwrap() {
            drop(new_client(opts).unwrap());
        }
    }
    assert_eq!(own_roots_files(), before);
}

#[test]
fn no_interrupt_is_a_no_op() {
    // Huỷ do actor tự làm; `interrupt` của registry không được panic hay chặn.
    NoInterrupt.interrupt();
}
