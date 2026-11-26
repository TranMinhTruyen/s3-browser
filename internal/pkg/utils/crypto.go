package utils

import (
	"S3Browser/internal/pkg/portable"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "S3Browser"
	keyringUser    = "db-encryption-key"
)

// ErrInvalidCiphertext được Decrypt trả về nếu đầu vào sai định dạng hoặc đã bị sửa đổi.
var ErrInvalidCiphertext = errors.New("ciphertext invalid")

// KeyManager mã hóa và giải mã thông tin bí mật bằng AES-256-GCM.
// Khóa được lưu trong keyring của hệ điều hành hoặc trong <thư mục dữ liệu>/key ở chế độ portable nếu máy không có keyring.
type KeyManager struct {
	key []byte
}

// NewKeyManager tải khóa mã hóa từ keyring hoặc từ <thư mục dữ liệu>/key ở chế độ portable.
// Nếu chưa có khóa, hàm tạo khóa mới rồi lưu lại.
func NewKeyManager(appName string) (*KeyManager, error) {
	keyB64, err := readKey(appName)
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			return nil, fmt.Errorf("read key: %w", err)
		}
		key := make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, key); err != nil {
			return nil, fmt.Errorf("generate key: %w", err)
		}
		keyB64 = base64.StdEncoding.EncodeToString(key)
		if err := writeKey(appName, keyB64); err != nil {
			return nil, fmt.Errorf("store key: %w", err)
		}
		return &KeyManager{key: key}, nil
	}

	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("decode key: %w", err)
	}
	return &KeyManager{key: key}, nil
}

// readKey trả keyring.ErrNotFound nếu chưa có khóa nào được lưu.
func readKey(appName string) (string, error) {
	if !portable.Enabled {
		return keyring.Get(keyringService, keyringUser)
	}

	path, err := keyFilePath(appName)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", keyring.ErrNotFound
	}
	return strings.TrimSpace(string(data)), err
}

// writeKey lưu khóa base64 vào keyring hoặc vào file khóa (mode 0600) ở chế độ portable.
func writeKey(appName, keyB64 string) error {
	if !portable.Enabled {
		return keyring.Set(keyringService, keyringUser, keyB64)
	}

	path, err := keyFilePath(appName)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(keyB64), 0o600)
}

// keyFilePath chỉ được dùng ở chế độ portable.
func keyFilePath(appName string) (string, error) {
	dir, err := portable.DataDir(appName)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "key"), nil
}

// Encrypt trả về base64(nonce || ciphertext) với nonce ngẫu nhiên mới, nhờ đó cùng đầu vào vẫn cho đầu ra khác nhau.
func (km *KeyManager) Encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(km.key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt thực hiện ngược lại Encrypt. Mọi lỗi đều được ánh xạ thành ErrInvalidCiphertext để bên gọi không phân biệt
// được base64 sai, đầu vào quá ngắn hay xác thực thất bại.
func (km *KeyManager) Decrypt(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", ErrInvalidCiphertext
	}

	block, err := aes.NewCipher(km.key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	if len(data) < gcm.NonceSize() {
		return "", ErrInvalidCiphertext
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrInvalidCiphertext
	}
	return string(plaintext), nil
}
