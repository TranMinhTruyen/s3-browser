package bucket

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io/fs"
	"os"

	"github.com/youmark/pkcs8"
)

// loadClientCertificate đọc chứng chỉ PEM và khóa riêng của hồ sơ minioCert. Khóa có thể không mã hóa hoặc được mã hóa
// theo PKCS#8 ("ENCRYPTED PRIVATE KEY", cần mật khẩu). Không hỗ trợ kiểu mã hóa OpenSSL cũ (Proc-Type: 4,ENCRYPTED).
// Lỗi trả về là credError: S3E042 (thiếu file), S3E048 (thiếu mật khẩu) và S3E043 (các lỗi khác).
func loadClientCertificate(certPath, keyPath, password string) (tls.Certificate, error) {
	certPEM, err := readAuthFile(certPath)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyPEM, err := readAuthFile(keyPath)
	if err != nil {
		return tls.Certificate{}, err
	}

	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return tls.Certificate{}, &credError{code: S3E043, params: map[string]any{"path": keyPath},
			err: errors.New("the key file has no PEM block")}
	}
	if _, legacy := block.Headers["Proc-Type"]; legacy {
		return tls.Certificate{}, &credError{code: S3E043, params: map[string]any{"path": keyPath},
			err: errors.New("legacy encrypted PEM keys are not supported, convert with: openssl pkcs8 -topk8")}
	}

	if block.Type == "ENCRYPTED PRIVATE KEY" {
		if password == "" {
			return tls.Certificate{}, &credError{code: S3E048, params: map[string]any{"path": keyPath},
				err: errors.New("the private key needs a password")}
		}
		keyPEM, err = decryptPKCS8(block.Bytes, password)
		if err != nil {
			return tls.Certificate{}, &credError{code: S3E043, params: map[string]any{"path": keyPath}, err: err}
		}
	}

	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, &credError{code: S3E043, params: map[string]any{"path": certPath}, err: err}
	}
	return cert, nil
}

// decryptPKCS8 giải mã khóa PKCS#8 rồi trả về dưới dạng khối PEM không mã hóa.
func decryptPKCS8(der []byte, password string) ([]byte, error) {
	key, err := pkcs8.ParsePKCS8PrivateKey(der, []byte(password))
	if err != nil {
		return nil, err
	}
	plain, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: plain}), nil
}

// readAuthFile đọc file chứng chỉ hoặc khóa; file không tồn tại sẽ trả S3E042.
func readAuthFile(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, &credError{code: S3E042, params: map[string]any{"path": path}, err: err}
	}
	if err != nil {
		return nil, &credError{code: S3E043, params: map[string]any{"path": path}, err: err}
	}
	return data, nil
}

// loadCaPool trả về kho CA của hệ thống cùng các chứng chỉ trong file PEM caPath. File không tồn tại, không đọc được
// hoặc không có chứng chỉ hợp lệ sẽ trả S3E049.
func loadCaPool(caPath string) (*x509.CertPool, error) {
	fail := func(err error) (*x509.CertPool, error) {
		return nil, &credError{code: S3E049, params: map[string]any{"path": caPath}, err: err}
	}

	data, err := os.ReadFile(caPath)
	if err != nil {
		return fail(err)
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(data) {
		return fail(errors.New("the file has no valid PEM certificate"))
	}
	return pool, nil
}
