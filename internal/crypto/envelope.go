package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// EnvelopeCipher provides AES-256-GCM encryption for integration credentials.
type EnvelopeCipher struct {
	aead cipher.AEAD
}

func NewEnvelopeCipher(hexKey string) (*EnvelopeCipher, error) {
	key, err := hex.DecodeString(hexKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM AEAD: %w", err)
	}

	return &EnvelopeCipher{aead: aead}, nil
}

// Encrypt prepends the 12-byte random nonce to the authenticated ciphertext.
func (c *EnvelopeCipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt extracts the prepended nonce and verifies/decrypts the ciphertext.
func (c *EnvelopeCipher) Decrypt(payload []byte) ([]byte, error) {
	nonceSize := c.aead.NonceSize()
	if len(payload) < nonceSize {
		return nil, errors.New("ciphertext payload too short")
	}
	nonce, ciphertext := payload[:nonceSize], payload[nonceSize:]
	return c.aead.Open(nil, nonce, ciphertext, nil)
}
