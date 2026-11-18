//! N4: `s3b_init` cài provider mã hoá TLS (một lần, gọi lại vô hại) và `client_config` dùng được
//! qua API công khai của crate. Test chi tiết về chế độ TLS nằm trong `drivers/tls.rs`.

mod common;

use common::*;
use rustls::crypto::CryptoProvider;
use s3b_db::drivers::tls::{client_config, install_provider};
use s3b_db::ffi::s3b_init;
use s3b_db::protocol::{TlsMode, TlsParams};

#[test]
fn init_installs_the_default_crypto_provider() {
    assert_eq!(s3b_init(), 0);
    assert!(CryptoProvider::get_default().is_some());
}

#[test]
fn init_and_install_provider_can_be_repeated() {
    for _ in 0..3 {
        assert_eq!(s3b_init(), 0);
        install_provider();
    }
    let first = CryptoProvider::get_default().cloned().unwrap();
    assert_eq!(s3b_init(), 0);
    let again = CryptoProvider::get_default().cloned().unwrap();
    // Cùng một provider: lần init sau không thay cái đã cài.
    assert!(std::sync::Arc::ptr_eq(&first, &again));
}

#[test]
fn concurrent_init_is_safe() {
    let handles: Vec<_> = (0..8).map(|_| std::thread::spawn(|| s3b_init())).collect();
    for h in handles {
        assert_eq!(h.join().unwrap(), 0);
    }
    assert!(CryptoProvider::get_default().is_some());
}

#[test]
fn client_config_works_through_the_public_api_after_init() {
    init();
    let off = client_config(&TlsParams::default()).unwrap();
    assert!(off.is_none(), "disable không có cấu hình TLS");
    let require = TlsParams {
        mode: TlsMode::Require,
        ca_file: None,
    };
    assert!(client_config(&require).unwrap().is_some());
}

#[test]
fn bad_ca_file_is_open_failed_and_does_not_leak_the_path() {
    init();
    let secret_dir = "C:\\Users\\someone-private\\certs";
    let params = TlsParams {
        mode: TlsMode::VerifyFull,
        ca_file: Some(format!("{secret_dir}\\missing.pem")),
    };
    let err = client_config(&params).expect_err("phải lỗi");
    assert_eq!(err.code, "openFailed");
    assert!(!err.message.contains("someone-private"), "{}", err.message);
}
