package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

type jwkRaw struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	// RSA
	N string `json:"n"`
	E string `json:"e"`
	// EC / OKP
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type jwkEntry struct {
	kid string
	alg string
	use string
	kty string
	pub crypto.PublicKey
}

type JWKSProvider struct {
	httpClient *http.Client

	mu              sync.RWMutex
	jwksURI         string
	keysByKid       map[string]jwkEntry
	allKeys         []jwkEntry
	fetchedAt       time.Time
	lastMissRefresh time.Time
}

func NewJWKSProvider(client *http.Client) *JWKSProvider {
	return &JWKSProvider{
		httpClient: client,
		keysByKid:  make(map[string]jwkEntry),
	}
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	Typ string `json:"typ"`
}

// VerifyJWT validates the JWS signature against the provider's JWKS and returns raw decoded claim bytes.
func (p *JWKSProvider) VerifyJWT(ctx context.Context, jwksURI, rawToken string) ([]byte, map[string]json.RawMessage, error) {
	parts := strings.Split(rawToken, ".")
	if len(parts) != 3 {
		return nil, nil, errors.New("malformed JWT structure")
	}

	headerBytes, err := decodeB64URL(parts[0])
	if err != nil {
		return nil, nil, fmt.Errorf("invalid JWT header encoding: %w", err)
	}
	var hdr jwtHeader
	if err := json.Unmarshal(headerBytes, &hdr); err != nil {
		return nil, nil, fmt.Errorf("invalid JWT header JSON: %w", err)
	}
	if hdr.Alg == "" || strings.EqualFold(hdr.Alg, "none") {
		return nil, nil, errors.New("unsupported or insecure JWT alg")
	}

	payloadBytes, err := decodeB64URL(parts[1])
	if err != nil {
		return nil, nil, fmt.Errorf("invalid JWT payload encoding: %w", err)
	}

	sigBytes, err := decodeB64URL(parts[2])
	if err != nil {
		return nil, nil, fmt.Errorf("invalid JWT signature encoding: %w", err)
	}

	candidates, err := p.resolveKeys(ctx, jwksURI, hdr.Kid, hdr.Alg)
	if err != nil {
		return nil, nil, err
	}

	signingInput := []byte(parts[0] + "." + parts[1])
	verified := false
	for _, entry := range candidates {
		if verifyJWSSignature(hdr.Alg, entry.pub, signingInput, sigBytes) {
			verified = true
			break
		}
	}

	if !verified {
		return nil, nil, errors.New("JWT signature verification failed")
	}

	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal(payloadBytes, &rawMap); err != nil {
		return nil, nil, fmt.Errorf("invalid JWT claims JSON: %w", err)
	}

	return payloadBytes, rawMap, nil
}

func (p *JWKSProvider) resolveKeys(ctx context.Context, jwksURI, kid, alg string) ([]jwkEntry, error) {
	p.mu.RLock()
	needsInitialFetch := p.jwksURI != jwksURI || time.Since(p.fetchedAt) > 15*time.Minute || len(p.allKeys) == 0
	var matched []jwkEntry
	if !needsInitialFetch {
		matched = p.matchKeysLocked(kid, alg)
	}
	canMissRefresh := time.Since(p.lastMissRefresh) > 10*time.Second
	p.mu.RUnlock()

	if needsInitialFetch || (len(matched) == 0 && canMissRefresh) {
		if err := p.refreshJWKS(ctx, jwksURI, !needsInitialFetch); err != nil {
			// If we had stale keys and initial TTL expired, still try matching cached keys on transient network error
			p.mu.RLock()
			stale := p.matchKeysLocked(kid, alg)
			p.mu.RUnlock()
			if len(stale) == 0 {
				return nil, err
			}
			return stale, nil
		}
		p.mu.RLock()
		matched = p.matchKeysLocked(kid, alg)
		p.mu.RUnlock()
	}

	if len(matched) == 0 {
		return nil, fmt.Errorf("no matching JWK found for kid=%q alg=%q", kid, alg)
	}
	return matched, nil
}

func (p *JWKSProvider) matchKeysLocked(kid, alg string) []jwkEntry {
	if kid != "" {
		if entry, ok := p.keysByKid[kid]; ok {
			return []jwkEntry{entry}
		}
		return nil
	}

	var out []jwkEntry
	for _, entry := range p.allKeys {
		if entry.use != "" && entry.use != "sig" {
			continue
		}
		if entry.alg != "" && entry.alg != alg {
			continue
		}
		out = append(out, entry)
	}
	return out
}

func (p *JWKSProvider) refreshJWKS(ctx context.Context, jwksURI string, isMiss bool) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURI, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed fetching JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return err
	}

	var parsed struct {
		Keys []jwkRaw `json:"keys"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return fmt.Errorf("failed parsing JWKS JSON: %w", err)
	}

	byKid := make(map[string]jwkEntry, len(parsed.Keys))
	all := make([]jwkEntry, 0, len(parsed.Keys))

	for _, raw := range parsed.Keys {
		if raw.Use != "" && raw.Use != "sig" {
			continue
		}
		pub, err := parseJWKPublicKey(raw)
		if err != nil {
			continue
		}
		entry := jwkEntry{
			kid: raw.Kid,
			alg: raw.Alg,
			use: raw.Use,
			kty: raw.Kty,
			pub: pub,
		}
		all = append(all, entry)
		if raw.Kid != "" {
			byKid[raw.Kid] = entry
		}
	}

	p.mu.Lock()
	p.jwksURI = jwksURI
	p.keysByKid = byKid
	p.allKeys = all
	p.fetchedAt = time.Now()
	if isMiss {
		p.lastMissRefresh = time.Now()
	}
	p.mu.Unlock()

	return nil
}

func parseJWKPublicKey(j jwkRaw) (crypto.PublicKey, error) {
	switch j.Kty {
	case "RSA":
		nBytes, err := decodeB64URL(j.N)
		if err != nil || len(nBytes) == 0 {
			return nil, errors.New("invalid RSA modulus")
		}
		eBytes, err := decodeB64URL(j.E)
		if err != nil || len(eBytes) == 0 {
			return nil, errors.New("invalid RSA exponent")
		}
		e := int(new(big.Int).SetBytes(eBytes).Int64())
		if e <= 1 {
			return nil, errors.New("invalid RSA exponent value")
		}
		return &rsa.PublicKey{
			N: new(big.Int).SetBytes(nBytes),
			E: e,
		}, nil

	case "EC":
		var curve elliptic.Curve
		switch j.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported EC curve %q", j.Crv)
		}
		xBytes, err1 := decodeB64URL(j.X)
		yBytes, err2 := decodeB64URL(j.Y)
		if err1 != nil || err2 != nil {
			return nil, errors.New("invalid EC coordinates")
		}
		x := new(big.Int).SetBytes(xBytes)
		y := new(big.Int).SetBytes(yBytes)
		if !curve.IsOnCurve(x, y) {
			return nil, errors.New("EC point not on curve")
		}
		return &ecdsa.PublicKey{
			Curve: curve,
			X:     x,
			Y:     y,
		}, nil

	case "OKP":
		if j.Crv != "Ed25519" {
			return nil, fmt.Errorf("unsupported OKP curve %q", j.Crv)
		}
		xBytes, err := decodeB64URL(j.X)
		if err != nil || len(xBytes) != ed25519.PublicKeySize {
			return nil, errors.New("invalid Ed25519 public key")
		}
		return ed25519.PublicKey(xBytes), nil

	default:
		return nil, fmt.Errorf("unsupported JWK kty %q", j.Kty)
	}
}

func verifyJWSSignature(alg string, pub crypto.PublicKey, signingInput, sig []byte) bool {
	switch alg {
	case "RS256", "RS384", "RS512":
		rsaPub, ok := pub.(*rsa.PublicKey)
		if !ok {
			return false
		}
		hashType, digest := hashForAlg(alg, signingInput)
		return rsa.VerifyPKCS1v15(rsaPub, hashType, digest, sig) == nil

	case "PS256", "PS384", "PS512":
		rsaPub, ok := pub.(*rsa.PublicKey)
		if !ok {
			return false
		}
		hashType, digest := hashForAlg(alg, signingInput)
		return rsa.VerifyPSS(rsaPub, hashType, digest, sig, &rsa.PSSOptions{
			SaltLength: rsa.PSSSaltLengthAuto,
			Hash:       hashType,
		}) == nil

	case "ES256", "ES384", "ES512":
		ecPub, ok := pub.(*ecdsa.PublicKey)
		if !ok {
			return false
		}
		expectedCurveBits, coordSize, hashType, digest := ecParamsForAlg(alg, signingInput)
		if ecPub.Curve.Params().BitSize != expectedCurveBits || len(sig) != 2*coordSize {
			return false
		}
		_ = hashType
		r := new(big.Int).SetBytes(sig[:coordSize])
		s := new(big.Int).SetBytes(sig[coordSize:])
		return ecdsa.Verify(ecPub, digest, r, s)

	case "EdDSA":
		edPub, ok := pub.(ed25519.PublicKey)
		if !ok {
			return false
		}
		return ed25519.Verify(edPub, signingInput, sig)

	default:
		return false
	}
}

func hashForAlg(alg string, msg []byte) (crypto.Hash, []byte) {
	switch alg {
	case "RS256", "PS256":
		sum := sha256.Sum256(msg)
		return crypto.SHA256, sum[:]
	case "RS384", "PS384":
		sum := sha512.Sum384(msg)
		return crypto.SHA384, sum[:]
	case "RS512", "PS512":
		sum := sha512.Sum512(msg)
		return crypto.SHA512, sum[:]
	default:
		return 0, nil
	}
}

func ecParamsForAlg(alg string, msg []byte) (bits int, coordBytes int, h crypto.Hash, digest []byte) {
	switch alg {
	case "ES256":
		sum := sha256.Sum256(msg)
		return 256, 32, crypto.SHA256, sum[:]
	case "ES384":
		sum := sha512.Sum384(msg)
		return 384, 48, crypto.SHA384, sum[:]
	case "ES512":
		sum := sha512.Sum512(msg)
		return 521, 66, crypto.SHA512, sum[:]
	default:
		return 0, 0, 0, nil
	}
}

func decodeB64URL(s string) ([]byte, error) {
	s = strings.TrimRight(s, "=")
	return base64.RawURLEncoding.DecodeString(s)
}
