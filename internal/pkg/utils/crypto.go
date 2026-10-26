package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "S3Browser"
	keyringUser    = "db-encryption-key"
)

var ErrInvalidCiphertext = errors.New("ciphertext invalid")

type KeyManager struct {
	key []byte
}

func NewKeyManager() (*KeyManager, error) {
	keyB64, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			return nil, fmt.Errorf("read keyring: %w", err)
		}
		key := make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, key); err != nil {
			return nil, fmt.Errorf("generate key: %w", err)
		}
		keyB64 = base64.StdEncoding.EncodeToString(key)
		if err := keyring.Set(keyringService, keyringUser, keyB64); err != nil {
			return nil, fmt.Errorf("store keyring: %w", err)
		}
		return &KeyManager{key: key}, nil
	}

	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("decode key from keyring: %w", err)
	}
	return &KeyManager{key: key}, nil
}

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
