package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
)

const (
	kdfPBKDF2SHA256   = "pbkdf2-sha256"
	kdfIterations     = 600_000
	minKdfIterations  = 100_000    // below this a file would be too cheap to brute force
	maxKdfIterations  = 10_000_000 // above this a crafted file could freeze the app
	passwordSaltSize  = 16
	passwordNonceSize = 12
	passwordKeySize   = 32
)

var (
	// ErrWrongPassword được OpenWithPassword trả về nếu xác thực thất bại: mật khẩu sai hoặc dữ liệu bị hỏng.
	ErrWrongPassword = errors.New("wrong password or damaged data")
	// ErrInvalidSealed được OpenWithPassword trả về nếu tham số KDF không được chấp nhận.
	ErrInvalidSealed = errors.New("sealed data invalid")
)

// PasswordSealed chứa dữ liệu được mã hóa bằng AES-256-GCM với khóa dẫn xuất từ mật khẩu (PBKDF2-SHA256).
// Các trường []byte được biểu diễn bằng base64 trong JSON.
type PasswordSealed struct {
	KDF        string `json:"kdf"`
	Iterations int    `json:"iterations"`
	Salt       []byte `json:"salt"`
	Nonce      []byte `json:"nonce"`
	Data       []byte `json:"data"`
}

// SealWithPassword mã hóa plain bằng password với salt và nonce ngẫu nhiên mới. aad được xác thực nhưng không mã hóa:
// OpenWithPassword cần cùng aad nên ciphertext được gắn với dữ liệu mà bên gọi truyền vào.
func SealWithPassword(plain []byte, password string, aad []byte) (PasswordSealed, error) {
	sealed := PasswordSealed{
		KDF:        kdfPBKDF2SHA256,
		Iterations: kdfIterations,
		Salt:       make([]byte, passwordSaltSize),
		Nonce:      make([]byte, passwordNonceSize),
	}
	if _, err := io.ReadFull(rand.Reader, sealed.Salt); err != nil {
		return PasswordSealed{}, fmt.Errorf("generate salt: %w", err)
	}
	if _, err := io.ReadFull(rand.Reader, sealed.Nonce); err != nil {
		return PasswordSealed{}, fmt.Errorf("generate nonce: %w", err)
	}

	gcm, err := passwordGCM(password, sealed)
	if err != nil {
		return PasswordSealed{}, err
	}
	sealed.Data = gcm.Seal(nil, sealed.Nonce, plain, aad)
	return sealed, nil
}

// OpenWithPassword thực hiện ngược lại SealWithPassword. Tham số nằm ngoài giới hạn được chấp nhận sẽ trả ErrInvalidSealed
// trước khi dẫn xuất khóa; xác thực thất bại (mật khẩu sai, dữ liệu hỏng hoặc aad khác) sẽ trả ErrWrongPassword.
func OpenWithPassword(s PasswordSealed, password string, aad []byte) ([]byte, error) {
	if s.KDF != kdfPBKDF2SHA256 || s.Iterations < minKdfIterations || s.Iterations > maxKdfIterations ||
		len(s.Salt) != passwordSaltSize || len(s.Nonce) != passwordNonceSize {
		return nil, ErrInvalidSealed
	}

	gcm, err := passwordGCM(password, s)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, s.Nonce, s.Data, aad)
	if err != nil {
		return nil, ErrWrongPassword
	}
	return plain, nil
}

// passwordGCM dẫn xuất khóa của s từ password rồi trả cipher AES-256-GCM tương ứng.
func passwordGCM(password string, s PasswordSealed) (cipher.AEAD, error) {
	key, err := pbkdf2.Key(sha256.New, password, s.Salt, s.Iterations, passwordKeySize)
	if err != nil {
		return nil, fmt.Errorf("derive key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}
	return cipher.NewGCM(block)
}
