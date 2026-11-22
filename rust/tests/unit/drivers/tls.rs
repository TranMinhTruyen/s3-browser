use super::*;
use rustls::internal::msgs::codec::{Codec, Reader};
use rustls::pki_types::PrivateKeyDer;
use rustls::{ClientConnection, Connection, ServerConfig, ServerConnection};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Đường dẫn file trong `rust/tests/fixtures/` (cert dựng sẵn bằng `gen.sh`, không cần Docker).
fn fx(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn cert(name: &str) -> CertificateDer<'static> {
    CertificateDer::from_pem_file(fx(name)).unwrap()
}

fn tls(mode: TlsMode, ca_file: Option<&str>) -> TlsParams {
    TlsParams {
        mode,
        ca_file: ca_file.map(str::to_owned),
    }
}

/// `client_config` nhưng các test không gọi đồng thời: cache là biến toàn cục của process và
/// hai lần dựng cùng khoá cùng lúc (hợp lệ trong production) làm `Arc` đầu bị thay, khiến
/// các assert `ptr_eq` giữa các test chạy song song bị chập chờn.
fn serial(p: &TlsParams) -> DbResult<Option<Arc<ClientConfig>>> {
    static SERIAL: Mutex<()> = Mutex::new(());
    let _guard = lock(&SERIAL);
    client_config(p)
}

/// Config của mode `mode` (phải `Ok(Some)`).
fn config(mode: TlsMode, ca_file: Option<&str>) -> Arc<ClientConfig> {
    serial(&tls(mode, ca_file)).unwrap().unwrap()
}

/// File tạm có nội dung cho trước, tự xoá khi drop.
struct TempFile(std::path::PathBuf);

impl TempFile {
    fn new(contents: &[u8]) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let path = std::env::temp_dir().join(format!(
            "s3b_tls_test_{}_{}.pem",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, contents).unwrap();
        Self(path)
    }

    fn path(&self) -> &str {
        self.0.to_str().unwrap()
    }

    /// Đặt thời điểm sửa file (để kiểm khoá cache theo mtime mà không phải chờ đồng hồ).
    fn set_mtime(&self, secs_since_epoch: u64) {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&self.0)
            .unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs_since_epoch))
            .unwrap();
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Chạy bắt tay TLS trong bộ nhớ giữa `client_cfg` và một server dùng chứng chỉ `server_cert`
/// (khoá `server.key`). Trả lỗi đầu tiên của bên client (kiểm chứng chỉ) nếu có.
fn handshake(client_cfg: Arc<ClientConfig>, server_cert: &str, name: &str) -> Result<(), Error> {
    let key = PrivateKeyDer::from_pem_file(fx("server.key")).unwrap();
    let server_cfg = ServerConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert(server_cert)], key)
        .unwrap();
    let name = ServerName::try_from(name.to_owned()).unwrap();
    let mut client: Connection = ClientConnection::new(client_cfg, name).unwrap().into();
    let mut server: Connection = ServerConnection::new(Arc::new(server_cfg)).unwrap().into();
    for _ in 0..10 {
        if !client.is_handshaking() && !server.is_handshaking() {
            return Ok(());
        }
        pump(&mut client, &mut server)?;
        pump(&mut server, &mut client)?;
    }
    panic!("handshake did not finish");
}

/// Chuyển mọi byte `from` muốn gửi sang `to` và xử lý chúng.
fn pump(from: &mut Connection, to: &mut Connection) -> Result<(), Error> {
    let mut buf = Vec::new();
    while from.wants_write() {
        from.write_tls(&mut buf).unwrap();
    }
    let mut rd = buf.as_slice();
    while !rd.is_empty() {
        to.read_tls(&mut rd).unwrap();
        to.process_new_packets()?;
    }
    Ok(())
}

fn is_unknown_issuer(e: &Error) -> bool {
    matches!(
        e,
        Error::InvalidCertificate(CertificateError::UnknownIssuer)
    )
}

fn is_wrong_name(e: &Error) -> bool {
    matches!(
        e,
        Error::InvalidCertificate(
            CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. }
        )
    )
}

fn is_expired(e: &Error) -> bool {
    matches!(
        e,
        Error::InvalidCertificate(
            CertificateError::Expired | CertificateError::ExpiredContext { .. }
        )
    )
}

fn is_not_yet_valid(e: &Error) -> bool {
    matches!(
        e,
        Error::InvalidCertificate(
            CertificateError::NotValidYet | CertificateError::NotValidYetContext { .. }
        )
    )
}

/// Verifier chuẩn (verify-full) cùng root là `ca.pem`; `IgnoreHostname` bọc nó (verify-ca).
fn standard() -> Arc<WebPkiServerVerifier> {
    WebPkiServerVerifier::builder_with_provider(roots(Some(&fx("ca.pem"))).unwrap(), provider())
        .build()
        .unwrap()
}

fn name(s: &str) -> ServerName<'static> {
    ServerName::try_from(s.to_owned()).unwrap()
}

/// 200 năm sau hiện tại: chứng chỉ 100 năm của fixture chắc chắn đã hết hạn.
fn far_future() -> UnixTime {
    UnixTime::since_unix_epoch(Duration::from_secs(
        UnixTime::now().as_secs() + 200 * 365 * 86_400,
    ))
}

/// Năm 2001: trước ngày fixture bắt đầu có hiệu lực.
fn far_past() -> UnixTime {
    UnixTime::since_unix_epoch(Duration::from_secs(1_000_000_000))
}

fn dss(scheme: SignatureScheme, sig: &[u8]) -> DigitallySignedStruct {
    let mut bytes = Vec::new();
    scheme.encode(&mut bytes);
    bytes.extend_from_slice(&u16::try_from(sig.len()).unwrap().to_be_bytes());
    bytes.extend_from_slice(sig);
    DigitallySignedStruct::read(&mut Reader::init(&bytes)).unwrap()
}

/// Chữ ký ECDSA P-256 hợp lệ của `message` bằng `server.key`.
fn sign(message: &[u8]) -> Vec<u8> {
    let key = PrivateKeyDer::from_pem_file(fx("server.key")).unwrap();
    let key = provider().key_provider.load_private_key(key).unwrap();
    key.choose_scheme(&[SignatureScheme::ECDSA_NISTP256_SHA256])
        .unwrap()
        .sign(message)
        .unwrap()
}

const MSG: &[u8] = b"handshake transcript";
const ECDSA: SignatureScheme = SignatureScheme::ECDSA_NISTP256_SHA256;

// ---- install_provider ----

#[test]
fn install_provider_twice_does_not_panic() {
    install_provider();
    install_provider();
    assert!(CryptoProvider::get_default().is_some());
}

// ---- client_config: dựng đúng cấu hình cho 6 mode ----

#[test]
fn disable_has_no_tls_config_even_with_bad_ca_file() {
    assert!(serial(&tls(TlsMode::Disable, None)).unwrap().is_none());
    assert!(
        serial(&tls(TlsMode::Disable, Some("Z:/nope.pem")))
            .unwrap()
            .is_none()
    );
}

#[test]
fn all_other_modes_have_a_config() {
    for mode in [
        TlsMode::Allow,
        TlsMode::Prefer,
        TlsMode::Require,
        TlsMode::VerifyCa,
        TlsMode::VerifyFull,
    ] {
        assert!(
            serial(&tls(mode, Some(&fx("ca.pem")))).unwrap().is_some(),
            "{mode:?}"
        );
    }
}

#[test]
fn allow_prefer_require_share_one_config_and_differ_from_verifying_ones() {
    let allow = config(TlsMode::Allow, None);
    assert!(Arc::ptr_eq(&allow, &config(TlsMode::Prefer, None)));
    assert!(Arc::ptr_eq(&allow, &config(TlsMode::Require, None)));
    let ca = fx("ca.pem");
    let verify_ca = config(TlsMode::VerifyCa, Some(&ca));
    let verify_full = config(TlsMode::VerifyFull, Some(&ca));
    assert!(!Arc::ptr_eq(&allow, &verify_ca));
    assert!(!Arc::ptr_eq(&allow, &verify_full));
    assert!(!Arc::ptr_eq(&verify_ca, &verify_full));
}

// ---- require / prefer / allow: mã hoá, không xác thực server ----

#[test]
fn insecure_modes_accept_self_signed_unknown_ca_and_wrong_hostname() {
    for mode in [TlsMode::Allow, TlsMode::Prefer, TlsMode::Require] {
        let cfg = config(mode, None);
        for (server_cert, host) in [
            ("server.pem", "localhost"),
            ("server.pem", "wrong.host"),
            ("server_other_ca.pem", "localhost"),
            ("selfsigned.pem", "localhost"),
            ("selfsigned.pem", "other.test"),
        ] {
            handshake(cfg.clone(), server_cert, host)
                .unwrap_or_else(|e| panic!("{mode:?} {server_cert} {host}: {e}"));
        }
    }
}

#[test]
fn insecure_modes_ignore_ca_file_even_when_it_is_bad() {
    for mode in [TlsMode::Allow, TlsMode::Prefer, TlsMode::Require] {
        assert!(
            serial(&tls(mode, Some("Z:/does/not/exist.pem")))
                .unwrap()
                .is_some()
        );
    }
}

#[test]
fn accept_any_cert_accepts_any_certificate_bytes() {
    let verifier = AcceptAnyCert {
        supported: provider().signature_verification_algorithms,
    };
    let garbage = CertificateDer::from(vec![1, 2, 3]);
    assert!(
        verifier
            .verify_server_cert(&garbage, &[], &name("x.test"), &[], UnixTime::now())
            .is_ok()
    );
    assert_eq!(format!("{verifier:?}"), "AcceptAnyCert");
    assert!(verifier.supported_verify_schemes().contains(&ECDSA));
}

#[test]
fn accept_any_cert_still_checks_handshake_signatures() {
    let verifier = AcceptAnyCert {
        supported: provider().signature_verification_algorithms,
    };
    let server = cert("server.pem");
    let good = dss(ECDSA, &sign(MSG));
    assert!(verifier.verify_tls12_signature(MSG, &server, &good).is_ok());
    assert!(verifier.verify_tls13_signature(MSG, &server, &good).is_ok());

    // Sai thông điệp, sai chữ ký, chữ ký rỗng, khoá khác, scheme không khớp khoá: đều bị từ chối.
    let mut broken = sign(MSG);
    let last = broken.len() - 1;
    broken[last] ^= 0xff;
    let ca = cert("ca.pem");
    let cases = [
        (&b"another message"[..], &server, good.clone()),
        (MSG, &server, dss(ECDSA, &broken)),
        (MSG, &server, dss(ECDSA, &[])),
        (MSG, &ca, good.clone()),
        (MSG, &server, dss(SignatureScheme::ED25519, &sign(MSG))),
    ];
    for (msg, cert, sig) in &cases {
        assert!(verifier.verify_tls12_signature(msg, cert, sig).is_err());
        assert!(verifier.verify_tls13_signature(msg, cert, sig).is_err());
    }
}

// ---- verify-full ----

#[test]
fn verify_full_accepts_matching_hostname_and_rejects_the_rest() {
    let ca = fx("ca.pem");
    let cfg = config(TlsMode::VerifyFull, Some(&ca));
    for host in ["localhost", "db.test", "127.0.0.1"] {
        handshake(cfg.clone(), "server.pem", host).unwrap_or_else(|e| panic!("{host}: {e}"));
    }
    let e = handshake(cfg.clone(), "server.pem", "other.host").unwrap_err();
    assert!(is_wrong_name(&e), "{e:?}");
    let e = handshake(cfg.clone(), "server.pem", "127.0.0.2").unwrap_err();
    assert!(is_wrong_name(&e), "{e:?}");
    // CA lạ (tên đúng) và cert tự ký đều không được tin.
    let e = handshake(cfg.clone(), "server_other_ca.pem", "localhost").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
    let e = handshake(cfg, "selfsigned.pem", "other.test").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
}

#[test]
fn verify_full_rejects_expired_and_not_yet_valid_certificates() {
    let verifier = standard();
    let server = cert("server.pem");
    let host = name("localhost");
    assert!(
        verifier
            .verify_server_cert(&server, &[], &host, &[], UnixTime::now())
            .is_ok()
    );
    let e = verifier
        .verify_server_cert(&server, &[], &host, &[], far_future())
        .unwrap_err();
    assert!(is_expired(&e), "{e:?}");
    let e = verifier
        .verify_server_cert(&server, &[], &host, &[], far_past())
        .unwrap_err();
    assert!(is_not_yet_valid(&e), "{e:?}");
}

#[test]
fn verify_full_and_ca_without_ca_file_use_windows_store_not_the_test_ca() {
    for mode in [TlsMode::VerifyFull, TlsMode::VerifyCa] {
        let e = handshake(config(mode, None), "server.pem", "localhost").unwrap_err();
        assert!(is_unknown_issuer(&e), "{mode:?}: {e:?}");
    }
}

// ---- verify-ca ----

#[test]
fn verify_ca_accepts_wrong_hostname_but_rejects_unknown_ca() {
    let ca = fx("ca.pem");
    let cfg = config(TlsMode::VerifyCa, Some(&ca));
    for host in ["localhost", "other.host", "127.0.0.2"] {
        handshake(cfg.clone(), "server.pem", host).unwrap_or_else(|e| panic!("{host}: {e}"));
    }
    let e = handshake(cfg.clone(), "server_other_ca.pem", "other.host").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
    let e = handshake(cfg, "selfsigned.pem", "other.test").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
}

#[test]
fn verify_ca_rejects_expired_and_not_yet_valid_even_with_wrong_hostname() {
    let verifier = IgnoreHostname { inner: standard() };
    let server = cert("server.pem");
    let wrong = name("other.host");
    assert!(
        verifier
            .verify_server_cert(&server, &[], &wrong, &[], UnixTime::now())
            .is_ok()
    );
    let e = verifier
        .verify_server_cert(&server, &[], &wrong, &[], far_future())
        .unwrap_err();
    assert!(is_expired(&e), "{e:?}");
    let e = verifier
        .verify_server_cert(&server, &[], &wrong, &[], far_past())
        .unwrap_err();
    assert!(is_not_yet_valid(&e), "{e:?}");
    // CA lạ vẫn bị từ chối, không bị nhầm với lỗi tên.
    let other = cert("server_other_ca.pem");
    let e = verifier
        .verify_server_cert(&other, &[], &wrong, &[], UnixTime::now())
        .unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
}

#[test]
fn verify_ca_and_full_still_check_handshake_signatures() {
    let server = cert("server.pem");
    let good = dss(ECDSA, &sign(MSG));
    let bad = dss(ECDSA, &sign(b"other message"));
    let ignore = IgnoreHostname { inner: standard() };
    let full = standard();
    let verifiers: [&dyn ServerCertVerifier; 2] = [&ignore, full.as_ref()];
    for v in verifiers {
        assert!(v.verify_tls12_signature(MSG, &server, &good).is_ok());
        assert!(v.verify_tls13_signature(MSG, &server, &good).is_ok());
        assert!(v.verify_tls12_signature(MSG, &server, &bad).is_err());
        assert!(v.verify_tls13_signature(MSG, &server, &bad).is_err());
        assert!(v.supported_verify_schemes().contains(&ECDSA));
    }
}

// ---- caFile ----

#[test]
fn ca_file_is_the_only_trust_anchor() {
    let other = fx("ca_other.pem");
    let cfg = config(TlsMode::VerifyFull, Some(&other));
    handshake(cfg.clone(), "server_other_ca.pem", "localhost").unwrap();
    // server.pem do `ca` ký, `ca` không có trong file nên bị từ chối.
    let e = handshake(cfg, "server.pem", "localhost").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
}

#[test]
fn ca_file_with_several_certificates_trusts_all_of_them() {
    let mut bundle = std::fs::read(fx("ca.pem")).unwrap();
    bundle.extend(std::fs::read(fx("ca_other.pem")).unwrap());
    let file = TempFile::new(&bundle);
    let cfg = config(TlsMode::VerifyFull, Some(file.path()));
    handshake(cfg.clone(), "server.pem", "localhost").unwrap();
    handshake(cfg, "server_other_ca.pem", "localhost").unwrap();
}

#[test]
fn empty_ca_file_string_means_no_ca_file() {
    let empty = config(TlsMode::VerifyFull, Some(""));
    assert!(Arc::ptr_eq(&empty, &config(TlsMode::VerifyFull, None)));
}

#[test]
fn bad_ca_file_is_open_failed_without_leaking_path_or_content() {
    let secret = "SECRET-CONTENT-123";
    let bad_pem = format!("-----BEGIN CERTIFICATE-----\n{secret}!!!\n-----END CERTIFICATE-----\n");
    let garbage_der = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
    let key_only = std::fs::read_to_string(fx("server.key")).unwrap();
    let files = [
        TempFile::new(bad_pem.as_bytes()),
        TempFile::new(garbage_der.as_bytes()),
        TempFile::new(key_only.as_bytes()),
        TempFile::new(b""),
        TempFile::new(secret.as_bytes()),
    ];
    let mut paths: Vec<String> = files.iter().map(|f| f.path().to_owned()).collect();
    paths.push("Z:/no/such/dir/ca.pem".to_owned());
    // Thư mục không đọc được như file.
    paths.push(std::env::temp_dir().to_str().unwrap().to_owned());
    for path in &paths {
        for mode in [TlsMode::VerifyCa, TlsMode::VerifyFull] {
            // `ClientConfig` không `Debug` nên không dùng được `unwrap_err`.
            let Err(e) = serial(&tls(mode, Some(path))) else {
                panic!("{mode:?} {path} should fail");
            };
            assert_eq!(e.code, OPEN_FAILED, "{path}");
            assert!(!e.message.contains(path.as_str()), "{}", e.message);
            assert!(!e.message.contains(secret), "{}", e.message);
            assert!(!e.message.is_empty());
        }
    }
}

#[test]
fn failed_ca_file_is_not_cached_and_later_fix_works() {
    let file = TempFile::new(b"not a pem");
    file.set_mtime(1_000_000_000);
    assert!(serial(&tls(TlsMode::VerifyFull, Some(file.path()))).is_err());
    std::fs::write(&file.0, std::fs::read(fx("ca.pem")).unwrap()).unwrap();
    file.set_mtime(1_000_000_010);
    assert!(serial(&tls(TlsMode::VerifyFull, Some(file.path()))).is_ok());
}

// ---- root_certs_der (cho mysql_async) ----

const GARBAGE_CERT: &str = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";

#[test]
fn root_certs_der_with_ca_file_returns_exactly_its_certificates() {
    let ca = fx("ca.pem");
    assert_eq!(root_certs_der(Some(&ca)).unwrap(), [cert("ca.pem")]);

    let mut bundle = std::fs::read(fx("ca.pem")).unwrap();
    bundle.extend(std::fs::read(fx("ca_other.pem")).unwrap());
    let file = TempFile::new(&bundle);
    assert_eq!(
        root_certs_der(Some(file.path())).unwrap(),
        [cert("ca.pem"), cert("ca_other.pem")]
    );
}

#[test]
fn root_certs_der_without_ca_file_returns_the_windows_store() {
    let store = native_certs().to_vec();
    assert!(!store.is_empty(), "kho chứng chỉ Windows rỗng");
    assert_eq!(root_certs_der(None).unwrap(), store);
    // Chuỗi rỗng coi như không có caFile.
    assert_eq!(root_certs_der(Some("")).unwrap(), store);
}

#[test]
fn root_certs_der_drops_unusable_certificates_but_keeps_the_good_ones() {
    let mixed = format!(
        "{}{GARBAGE_CERT}",
        std::fs::read_to_string(fx("ca.pem")).unwrap()
    );
    let file = TempFile::new(mixed.as_bytes());
    assert_eq!(root_certs_der(Some(file.path())).unwrap(), [cert("ca.pem")]);
}

#[test]
fn root_certs_der_bad_ca_file_is_open_failed_without_leaking_path_or_content() {
    let secret = "SECRET-CONTENT-123";
    let bad_pem = format!("-----BEGIN CERTIFICATE-----\n{secret}!!!\n-----END CERTIFICATE-----\n");
    let key_only = std::fs::read_to_string(fx("server.key")).unwrap();
    let files = [
        TempFile::new(bad_pem.as_bytes()),
        // PEM hợp lệ nhưng không phải chứng chỉ rustls dùng được: không còn CA nào.
        TempFile::new(GARBAGE_CERT.as_bytes()),
        TempFile::new(key_only.as_bytes()),
        TempFile::new(b""),
        TempFile::new(secret.as_bytes()),
    ];
    let mut paths: Vec<String> = files.iter().map(|f| f.path().to_owned()).collect();
    paths.push("Z:/no/such/dir/ca.pem".to_owned());
    paths.push(std::env::temp_dir().to_str().unwrap().to_owned());
    for path in &paths {
        let Err(e) = root_certs_der(Some(path)) else {
            panic!("{path} should fail");
        };
        assert_eq!(e.code, OPEN_FAILED, "{path}");
        assert!(!e.message.is_empty());
        assert!(!e.message.contains(path.as_str()), "{}", e.message);
        assert!(!e.message.contains(secret), "{}", e.message);
    }
}

// ---- kho chứng chỉ Windows ----

#[test]
fn system_roots_are_loaded_once_and_not_empty() {
    let first = system_roots();
    assert!(!first.roots.is_empty(), "kho chứng chỉ Windows rỗng");
    assert!(std::ptr::eq(first, system_roots()));
    // Hai lần `roots(None)` trả cùng một kho.
    assert!(Arc::ptr_eq(&roots(None).unwrap(), &roots(None).unwrap()));
}

// ---- cache ----

#[test]
fn cache_returns_same_config_for_same_mode_and_ca_file() {
    let ca = fx("ca.pem");
    let a = config(TlsMode::VerifyFull, Some(&ca));
    assert!(Arc::ptr_eq(&a, &config(TlsMode::VerifyFull, Some(&ca))));
    let c = config(TlsMode::VerifyCa, Some(&ca));
    assert!(Arc::ptr_eq(&c, &config(TlsMode::VerifyCa, Some(&ca))));
    assert!(!Arc::ptr_eq(&a, &c));
    // Không caFile: kho Windows, cũng cache.
    let s = config(TlsMode::VerifyFull, None);
    assert!(Arc::ptr_eq(&s, &config(TlsMode::VerifyFull, None)));
    assert!(!Arc::ptr_eq(&a, &s));
}

#[test]
fn cache_distinguishes_ca_files() {
    let a = config(TlsMode::VerifyFull, Some(&fx("ca.pem")));
    let b = config(TlsMode::VerifyFull, Some(&fx("ca_other.pem")));
    assert!(!Arc::ptr_eq(&a, &b));
}

#[test]
fn cache_rebuilds_when_ca_file_mtime_changes() {
    let file = TempFile::new(&std::fs::read(fx("ca.pem")).unwrap());
    file.set_mtime(1_000_000_000);
    let first = config(TlsMode::VerifyFull, Some(file.path()));
    assert!(Arc::ptr_eq(
        &first,
        &config(TlsMode::VerifyFull, Some(file.path()))
    ));
    // Đổi nội dung sang CA khác và mtime: config mới tin CA mới, không tin CA cũ.
    std::fs::write(&file.0, std::fs::read(fx("ca_other.pem")).unwrap()).unwrap();
    file.set_mtime(1_000_000_010);
    let second = config(TlsMode::VerifyFull, Some(file.path()));
    assert!(!Arc::ptr_eq(&first, &second));
    handshake(second.clone(), "server_other_ca.pem", "localhost").unwrap();
    let e = handshake(second.clone(), "server.pem", "localhost").unwrap_err();
    assert!(is_unknown_issuer(&e), "{e:?}");
    assert!(Arc::ptr_eq(
        &second,
        &config(TlsMode::VerifyFull, Some(file.path()))
    ));
}

#[test]
fn cache_does_not_serve_a_config_for_a_deleted_ca_file() {
    let file = TempFile::new(&std::fs::read(fx("ca.pem")).unwrap());
    let path = file.path().to_owned();
    assert!(serial(&tls(TlsMode::VerifyFull, Some(&path))).is_ok());
    drop(file);
    assert!(serial(&tls(TlsMode::VerifyFull, Some(&path))).is_err());
}

#[test]
fn concurrent_builds_all_work_and_then_agree() {
    // File riêng của test này => khoá cache riêng, không bị test khác chen vào.
    let file = TempFile::new(&std::fs::read(fx("ca.pem")).unwrap());
    let ca = file.path().to_owned();
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let ca = ca.clone();
            // Gọi thẳng `client_config` (không qua `serial`) để các lần dựng thật sự đồng thời.
            std::thread::spawn(move || {
                client_config(&tls(TlsMode::VerifyFull, Some(&ca)))
                    .unwrap()
                    .unwrap()
            })
        })
        .collect();
    let configs: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    // Sau khi các lần dựng đồng thời xong, mọi lần gọi tiếp theo trả cùng một config.
    let settled = config(TlsMode::VerifyFull, Some(&ca));
    assert!(Arc::ptr_eq(
        &settled,
        &config(TlsMode::VerifyFull, Some(&ca))
    ));
    for c in configs {
        handshake(c, "server.pem", "localhost").unwrap();
    }
}
