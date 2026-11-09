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
	// ErrWrongPassword is returned by OpenWithPassword when authentication fails: wrong password or damaged data.
	ErrWrongPassword = errors.New("wrong password or damaged data")
	// ErrInvalidSealed is returned by OpenWithPassword when the KDF parameters are not acceptable.
	ErrInvalidSealed = errors.New("sealed data invalid")
)

// PasswordSealed is data encrypted with AES-256-GCM under a key derived from a password (PBKDF2-SHA256).
// []byte fields are base64 in JSON.
type PasswordSealed struct {
	KDF        string `json:"kdf"`
	Iterations int    `json:"iterations"`
	Salt       []byte `json:"salt"`
	Nonce      []byte `json:"nonce"`
	Data       []byte `json:"data"`
}

// SealWithPassword encrypts plain under password, with a fresh random salt and nonce. aad is authenticated but not
// encrypted: OpenWithPassword needs the same aad, so it binds the ciphertext to the data the caller passes.
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

// OpenWithPassword reverses SealWithPassword. Parameters outside the accepted range give ErrInvalidSealed
// before any key is derived; a failed authentication (wrong password,
// damaged data or a different aad) gives ErrWrongPassword.
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

// passwordGCM derives the key of s from password and returns the AES-256-GCM cipher for it.
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
