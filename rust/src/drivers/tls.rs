//! Cấu hình TLS (rustls) cho các driver mạng: cài provider mã hoá, dựng `ClientConfig` theo
//! `tls.mode` của `open`, nạp root CA, và các verifier chứng chỉ tự viết.
//!
//! Vị trí trong luồng: `ffi::s3b_init` gọi `install_provider` một lần; mỗi driver mạng khi `open`
//! gọi `client_config` để lấy `ClientConfig` rồi đưa cho crate của nó (tokio-postgres,
//! mysql_async...). SQLite không dùng file này.
//!
//! Ngữ nghĩa các chế độ theo `sslmode` của libpq:
//!
//! | mode | kiểm chuỗi CA | kiểm hostname |
//! |---|---|---|
//! | `disable` | không dùng TLS | - |
//! | `allow`, `prefer`, `require` | không | không |
//! | `verify-ca` | có | không |
//! | `verify-full` | có | có |
//!
//! `allow`/`prefer` chỉ khác `require` ở chỗ thử không-TLS/TLS trước (việc của driver), còn
//! `ClientConfig` giống nhau.
//!
//! Khái niệm Rust: `Arc<dyn Trait>` là con trỏ chung tới một giá trị bất kỳ cài `Trait` (như biến
//! kiểu interface của Go); `OnceLock` là biến toàn cục khởi tạo đúng một lần, an toàn giữa các thread.

use crate::protocol::{DbError, DbResult, OPEN_FAILED, TlsMode, TlsParams};
use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{
    CryptoProvider, WebPkiSupportedAlgorithms, ring, verify_tls12_signature, verify_tls13_signature,
};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, Error, RootCertStore, SignatureScheme,
};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::SystemTime;

/// Lỗi `openFailed` với thông báo không chứa dữ liệu nhạy cảm.
fn open_failed(message: impl Into<String>) -> DbError {
    DbError::new(OPEN_FAILED, message)
}

/// Cài `ring` làm `CryptoProvider` mặc định của cả process, để mọi crate gọi
/// `ClientConfig::builder()` cũng dùng `ring` (không kéo `aws-lc-rs`). Đã có provider thì bỏ qua.
pub fn install_provider() {
    // `install_default` trả `Err` nếu đã cài: không phải lỗi nên bỏ qua.
    let _ = ring::default_provider().install_default();
}

/// Provider dùng cho mọi `ClientConfig` của ta, tạo một lần.
fn provider() -> Arc<CryptoProvider> {
    static PROVIDER: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    PROVIDER
        .get_or_init(|| Arc::new(ring::default_provider()))
        .clone()
}

/// Ba kiểu `ClientConfig` khác nhau thật sự (6 `mode` gộp lại).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    /// Không kiểm chứng chỉ (`allow`, `prefer`, `require`).
    Insecure,
    /// Kiểm chuỗi CA, bỏ qua hostname (`verify-ca`).
    VerifyCa,
    /// Kiểm chuỗi CA và hostname (`verify-full`).
    VerifyFull,
}

/// Khoá cache: kiểu config, đường dẫn `caFile` và thời điểm sửa file (để đổi nội dung file thì
/// config mới được dựng lại mà không cần khởi động lại app).
type CacheKey = (Kind, Option<String>, Option<SystemTime>);

/// `ClientConfig` theo `tls` của `open`; `None` khi `mode = disable` (không dùng TLS).
///
/// Kết quả được cache theo (kiểu, `caFile`, thời điểm sửa file). Lần đầu cho `verify-*` không
/// có `caFile` sẽ nạp kho chứng chỉ Windows (một lần cho cả process) và đọc file đồng bộ
/// nhưng nhanh, nên gọi thẳng trong hàm `open` async được.
/// Lỗi (`openFailed`): `caFile` không đọc được, không phải PEM hoặc không có chứng chỉ nào dùng được.
pub fn client_config(tls: &TlsParams) -> DbResult<Option<Arc<ClientConfig>>> {
    let kind = match tls.mode {
        TlsMode::Disable => return Ok(None),
        TlsMode::Allow | TlsMode::Prefer | TlsMode::Require => Kind::Insecure,
        TlsMode::VerifyCa => Kind::VerifyCa,
        TlsMode::VerifyFull => Kind::VerifyFull,
    };
    // `caFile` chỉ có nghĩa khi có kiểm chứng chỉ; chuỗi rỗng coi như không có.
    let ca = tls
        .ca_file
        .as_deref()
        .filter(|path| !path.is_empty() && kind != Kind::Insecure);
    let stamp = ca.and_then(|path| std::fs::metadata(path).ok()?.modified().ok());
    let key = (kind, ca.map(str::to_owned), stamp);

    static CACHE: OnceLock<Mutex<HashMap<CacheKey, Arc<ClientConfig>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Mutex::default);
    // Không giữ lock khi dựng config (có đọc file); hai lần mở đồng thời dựng hai lần là vô hại.
    if let Some(found) = lock(cache).get(&key) {
        return Ok(Some(found.clone()));
    }
    let config = Arc::new(build(kind, ca)?);
    lock(cache).insert(key, config.clone());
    Ok(Some(config))
}

/// Khoá mutex; poison chỉ do panic ngoài ý muốn và dữ liệu cache vẫn nhất quán.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Dựng `ClientConfig` cho một kiểu: chọn verifier rồi không dùng chứng chỉ client (chưa có mTLS).
fn build(kind: Kind, ca: Option<&str>) -> DbResult<ClientConfig> {
    let provider = provider();
    let builder = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| open_failed(format!("TLS configuration failed: {e}")))?;
    if kind == Kind::Insecure {
        let verifier = Arc::new(AcceptAnyCert {
            supported: provider.signature_verification_algorithms,
        });
        return Ok(builder
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth());
    }
    let standard = WebPkiServerVerifier::builder_with_provider(roots(ca)?, provider)
        .build()
        .map_err(|e| open_failed(format!("no trusted CA certificates: {e}")))?;
    Ok(match kind {
        Kind::VerifyFull => builder.with_webpki_verifier(standard).with_no_client_auth(),
        _ => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(IgnoreHostname { inner: standard }))
            .with_no_client_auth(),
    })
}

/// Root CA tin cậy: chỉ các CA trong `caFile` nếu có, không thì kho chứng chỉ của Windows.
fn roots(ca: Option<&str>) -> DbResult<Arc<RootCertStore>> {
    let Some(path) = ca else {
        return Ok(system_roots().clone());
    };
    let mut store = RootCertStore::empty();
    let (added, _ignored) = store.add_parsable_certificates(ca_file_certs(path)?);
    if added == 0 {
        return Err(open_failed("caFile has no usable certificates"));
    }
    Ok(Arc::new(store))
}

/// Đọc mọi chứng chỉ trong `caFile` (PEM). Lỗi không chứa đường dẫn hay nội dung file.
fn ca_file_certs(path: &str) -> DbResult<Vec<CertificateDer<'static>>> {
    let bytes = std::fs::read(path)
        .map_err(|e| open_failed(format!("cannot read caFile: {}", e.kind())))?;
    // `pem_slice_iter` đọc từng khối `-----BEGIN CERTIFICATE-----`, bỏ qua khối loại khác.
    CertificateDer::pem_slice_iter(&bytes)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| open_failed("caFile is not valid PEM"))
}

/// Root CA tin cậy dạng DER cho crate tự dựng `ClientConfig` từ chứng chỉ thô (`mysql_async`):
/// chỉ các CA trong `caFile` nếu có, không thì kho chứng chỉ của Windows. Chỉ giữ chứng chỉ
/// rustls dùng được, vì `mysql_async` hỏng cả kết nối nếu gặp một chứng chỉ không đọc được.
/// Lỗi (`openFailed`) giống `client_config`.
pub fn root_certs_der(ca: Option<&str>) -> DbResult<Vec<CertificateDer<'static>>> {
    let ca = ca.filter(|path| !path.is_empty());
    let Some(path) = ca else {
        return match native_certs() {
            [] => Err(open_failed("no trusted CA certificates")),
            certs => Ok(certs.to_vec()),
        };
    };
    let usable: Vec<_> = ca_file_certs(path)?
        .into_iter()
        .filter(is_usable_root)
        .collect();
    if usable.is_empty() {
        return Err(open_failed("caFile has no usable certificates"));
    }
    Ok(usable)
}

/// rustls nhận chứng chỉ này làm root không.
fn is_usable_root(cert: &CertificateDer<'static>) -> bool {
    RootCertStore::empty().add(cert.clone()).is_ok()
}

/// Chứng chỉ gốc của Windows dùng được, nạp một lần cho cả process (gọi API crypt32, hơi
/// chậm). Chứng chỉ lỗi bị bỏ qua.
fn native_certs() -> &'static [CertificateDer<'static>] {
    static CERTS: OnceLock<Vec<CertificateDer<'static>>> = OnceLock::new();
    CERTS.get_or_init(|| {
        let loaded = rustls_native_certs::load_native_certs();
        loaded.certs.into_iter().filter(is_usable_root).collect()
    })
}

/// Kho chứng chỉ của Windows, dựng một lần từ `native_certs`. Kho rỗng thì `build` báo lỗi rõ
/// ràng khi dựng verifier.
fn system_roots() -> &'static Arc<RootCertStore> {
    static ROOTS: OnceLock<Arc<RootCertStore>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        let mut store = RootCertStore::empty();
        store.add_parsable_certificates(native_certs().iter().cloned());
        Arc::new(store)
    })
}

/// Verifier cho `allow`/`prefer`/`require`: chấp nhận mọi chứng chỉ (như `sslmode=require` của
/// libpq: chỉ mã hoá, không xác thực server) nhưng vẫn kiểm chữ ký của bắt tay, để kết nối
/// thật sự mã hoá với đúng khoá trong chứng chỉ server đã gửi.
struct AcceptAnyCert {
    supported: WebPkiSupportedAlgorithms,
}

/// `Debug` bắt buộc bởi trait `ServerCertVerifier`; `WebPkiSupportedAlgorithms` không có `Debug`.
impl fmt::Debug for AcceptAnyCert {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AcceptAnyCert")
    }
}

impl ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls12_signature(message, cert, dss, &self.supported)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, cert, dss, &self.supported)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.supported.supported_schemes()
    }
}

/// Verifier cho `verify-ca`: bọc verifier chuẩn (kiểm chuỗi CA, hạn dùng, chữ ký) và bỏ qua
/// riêng lỗi "tên không khớp chứng chỉ".
#[derive(Debug)]
struct IgnoreHostname {
    inner: Arc<WebPkiServerVerifier>,
}

impl ServerCertVerifier for IgnoreHostname {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        // Verifier chuẩn kiểm chuỗi CA trước rồi mới kiểm tên, nên lỗi "sai tên" nghĩa là
        // phần chuỗi CA đã hợp lệ.
        match self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        ) {
            Err(Error::InvalidCertificate(
                CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. },
            )) => Ok(ServerCertVerified::assertion()),
            other => other,
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

#[cfg(test)]
#[path = "../../tests/unit/drivers/tls.rs"]
mod tests;
