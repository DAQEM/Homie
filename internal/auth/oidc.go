package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const backchannelLogoutEventURI = "http://schemas.openid.net/event/backchannel-logout"

var ErrRefreshInvalidGrant = errors.New("refresh token invalid or revoked")

type DiscoveryDocument struct {
	Issuer                     string `json:"issuer"`
	AuthorizationEndpoint      string `json:"authorization_endpoint"`
	TokenEndpoint              string `json:"token_endpoint"`
	UserInfoEndpoint           string `json:"userinfo_endpoint"`
	JWKSURI                    string `json:"jwks_uri"`
	EndSessionEndpoint         string `json:"end_session_endpoint"`
	RevocationEndpoint         string `json:"revocation_endpoint"`
	BackchannelLogoutSupported bool   `json:"backchannel_logout_supported"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
}

type StringOrSlice []string

func (s *StringOrSlice) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*s = []string{single}
		return nil
	}
	var multi []string
	if err := json.Unmarshal(data, &multi); err == nil {
		*s = multi
		return nil
	}
	return errors.New("expected string or array of strings")
}

type IDTokenClaims struct {
	Issuer            string        `json:"iss"`
	Subject           string        `json:"sub"`
	Audience          StringOrSlice `json:"aud"`
	AuthorizedParty   string        `json:"azp"`
	Expiry            int64         `json:"exp"`
	NotBefore         int64         `json:"nbf"`
	IssuedAt          int64         `json:"iat"`
	Nonce             string        `json:"nonce"`
	SessionID         string        `json:"sid"`
	PreferredUsername string        `json:"preferred_username"`
	Name              string        `json:"name"`
	Email             string        `json:"email"`
	Picture           string        `json:"picture"`
	Groups            []string      `json:"groups"`
}

type UserInfoClaims struct {
	Subject           string   `json:"sub"`
	PreferredUsername string   `json:"preferred_username"`
	Name              string   `json:"name"`
	GivenName         string   `json:"given_name"`
	Email             string   `json:"email"`
	Picture           string   `json:"picture"`
	Groups            []string `json:"groups"`
}

type LogoutTokenClaims struct {
	Issuer   string                     `json:"iss"`
	Subject  string                     `json:"sub"`
	Audience StringOrSlice              `json:"aud"`
	IssuedAt int64                      `json:"iat"`
	Expiry   int64                      `json:"exp"`
	JTI      string                     `json:"jti"`
	SID      string                     `json:"sid"`
	Events   map[string]json.RawMessage `json:"events"`
}

type OIDCClient struct {
	cfg        Config
	httpClient *http.Client
	jwks       *JWKSProvider

	discMu       sync.RWMutex
	discovery    *DiscoveryDocument
	discoveredAt time.Time
}

func NewOIDCClient(cfg Config) *OIDCClient {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	}
	if cfg.InsecureSkipVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}

	httpClient := &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
	}

	return &OIDCClient{
		cfg:        cfg,
		httpClient: httpClient,
		jwks:       NewJWKSProvider(httpClient),
	}
}

func (c *OIDCClient) GetDiscovery(ctx context.Context) (*DiscoveryDocument, error) {
	if !c.cfg.Enabled {
		return nil, errors.New("OIDC is not enabled")
	}

	c.discMu.RLock()
	cached := c.discovery
	fresh := cached != nil && time.Since(c.discoveredAt) < 15*time.Minute
	c.discMu.RUnlock()

	if fresh {
		return cached, nil
	}

	discURL := strings.TrimRight(c.cfg.IssuerURL, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("OIDC discovery failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("OIDC discovery returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}

	var doc DiscoveryDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("invalid OIDC discovery JSON: %w", err)
	}

	if strings.TrimRight(doc.Issuer, "/") != strings.TrimRight(c.cfg.IssuerURL, "/") {
		return nil, fmt.Errorf("OIDC discovery issuer mismatch: got %q, expected %q", doc.Issuer, c.cfg.IssuerURL)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" || doc.JWKSURI == "" {
		return nil, errors.New("OIDC discovery missing required endpoints")
	}

	c.discMu.Lock()
	c.discovery = &doc
	c.discoveredAt = time.Now()
	c.discMu.Unlock()

	return &doc, nil
}

func (c *OIDCClient) BuildAuthorizationURL(ctx context.Context, redirectURI, state, nonce, codeVerifier string) (string, error) {
	disc, err := c.GetDiscovery(ctx)
	if err != nil {
		return "", err
	}

	sum := sha256.Sum256([]byte(codeVerifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	u, err := url.Parse(disc.AuthorizationEndpoint)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", c.cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", strings.Join(c.cfg.Scopes, " "))
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()

	return u.String(), nil
}

func (c *OIDCClient) ExchangeCode(ctx context.Context, code, redirectURI, codeVerifier string) (*TokenResponse, error) {
	disc, err := c.GetDiscovery(ctx)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", c.cfg.ClientID)
	form.Set("code_verifier", codeVerifier)
	if c.cfg.ClientSecret != "" {
		form.Set("client_secret", c.cfg.ClientSecret)
	}

	return c.postTokenEndpoint(ctx, disc.TokenEndpoint, form)
}

func (c *OIDCClient) RefreshTokens(ctx context.Context, refreshToken string) (*TokenResponse, error) {
	disc, err := c.GetDiscovery(ctx)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", c.cfg.ClientID)
	if c.cfg.ClientSecret != "" {
		form.Set("client_secret", c.cfg.ClientSecret)
	}

	return c.postTokenEndpoint(ctx, disc.TokenEndpoint, form)
}

func (c *OIDCClient) postTokenEndpoint(ctx context.Context, tokenEndpoint string, form url.Values) (*TokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		var oauthErr struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &oauthErr)
		if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized {
			if oauthErr.Error == "invalid_grant" || oauthErr.Error == "invalid_token" {
				return nil, fmt.Errorf("%w: %s", ErrRefreshInvalidGrant, oauthErr.Description)
			}
		}
		msg := oauthErr.Description
		if msg == "" {
			msg = oauthErr.Error
		}
		if msg == "" {
			msg = http.StatusText(resp.StatusCode)
		}
		return nil, fmt.Errorf("token endpoint HTTP %d: %s", resp.StatusCode, msg)
	}

	var tok TokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, fmt.Errorf("invalid token JSON response: %w", err)
	}
	return &tok, nil
}

func (c *OIDCClient) VerifyIDToken(ctx context.Context, rawIDToken, expectedNonce string, checkNonce bool) (*IDTokenClaims, error) {
	disc, err := c.GetDiscovery(ctx)
	if err != nil {
		return nil, err
	}

	payloadBytes, _, err := c.jwks.VerifyJWT(ctx, disc.JWKSURI, rawIDToken)
	if err != nil {
		return nil, err
	}

	var claims IDTokenClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("failed unmarshaling ID token claims: %w", err)
	}

	if strings.TrimRight(claims.Issuer, "/") != strings.TrimRight(disc.Issuer, "/") {
		return nil, errors.New("ID token issuer mismatch")
	}
	if claims.Subject == "" {
		return nil, errors.New("ID token missing sub")
	}
	if !audienceContains(claims.Audience, c.cfg.ClientID) {
		return nil, errors.New("ID token audience mismatch")
	}
	if len(claims.Audience) > 1 && claims.AuthorizedParty != "" && claims.AuthorizedParty != c.cfg.ClientID {
		return nil, errors.New("ID token azp mismatch")
	}

	nowUnix := time.Now().Unix()
	const skew = 30
	if claims.Expiry == 0 || nowUnix > claims.Expiry+skew {
		return nil, errors.New("ID token expired")
	}
	if claims.NotBefore > 0 && nowUnix+skew < claims.NotBefore {
		return nil, errors.New("ID token not yet valid")
	}

	if checkNonce {
		if expectedNonce == "" || subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(expectedNonce)) != 1 {
			return nil, errors.New("ID token nonce mismatch")
		}
	}

	return &claims, nil
}

func (c *OIDCClient) FetchUserInfo(ctx context.Context, accessToken string) (*UserInfoClaims, error) {
	if accessToken == "" {
		return nil, errors.New("empty access token")
	}
	disc, err := c.GetDiscovery(ctx)
	if err != nil || disc.UserInfoEndpoint == "" {
		return nil, errors.New("userinfo endpoint unavailable")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, disc.UserInfoEndpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, err
	}

	var ui UserInfoClaims
	if err := json.Unmarshal(body, &ui); err != nil {
		return nil, err
	}
	return &ui, nil
}

// VerifyLogoutToken strictly validates a Back-Channel Logout Token per RFC 8957 / OIDC Back-Channel Logout 1.0.
func (c *OIDCClient) VerifyLogoutToken(ctx context.Context, rawLogoutToken string) (*LogoutTokenClaims, error) {
	disc, err := c.GetDiscovery(ctx)
	if err != nil {
		return nil, err
	}

	payloadBytes, rawMap, err := c.jwks.VerifyJWT(ctx, disc.JWKSURI, rawLogoutToken)
	if err != nil {
		return nil, err
	}

	// RFC 8957 Section 2.4: Logout Token MUST NOT contain a nonce Claim
	if _, hasNonce := rawMap["nonce"]; hasNonce {
		return nil, errors.New("logout token must not contain nonce claim")
	}

	var claims LogoutTokenClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("failed parsing logout token claims: %w", err)
	}

	if strings.TrimRight(claims.Issuer, "/") != strings.TrimRight(disc.Issuer, "/") {
		return nil, errors.New("logout token issuer mismatch")
	}
	if !audienceContains(claims.Audience, c.cfg.ClientID) {
		return nil, errors.New("logout token audience mismatch")
	}
	if claims.JTI == "" {
		return nil, errors.New("logout token missing jti")
	}
	if claims.Subject == "" && claims.SID == "" {
		return nil, errors.New("logout token must contain sub or sid")
	}

	nowUnix := time.Now().Unix()
	const skew = 60
	if claims.IssuedAt == 0 || claims.IssuedAt > nowUnix+300 {
		return nil, errors.New("logout token invalid iat")
	}
	if claims.Expiry > 0 && nowUnix > claims.Expiry+skew {
		return nil, errors.New("logout token expired")
	}

	evRaw, hasEvent := claims.Events[backchannelLogoutEventURI]
	if !hasEvent {
		return nil, errors.New("logout token missing backchannel-logout event")
	}
	trimmedEv := strings.TrimSpace(string(evRaw))
	if !strings.HasPrefix(trimmedEv, "{") {
		return nil, errors.New("logout token event value must be a JSON object")
	}

	return &claims, nil
}

func (c *OIDCClient) RevokeToken(ctx context.Context, token, tokenTypeHint string) {
	if token == "" || !c.cfg.Enabled {
		return
	}
	disc, err := c.GetDiscovery(ctx)
	if err != nil || disc.RevocationEndpoint == "" {
		return
	}

	form := url.Values{}
	form.Set("token", token)
	if tokenTypeHint != "" {
		form.Set("token_type_hint", tokenTypeHint)
	}
	form.Set("client_id", c.cfg.ClientID)
	if c.cfg.ClientSecret != "" {
		form.Set("client_secret", c.cfg.ClientSecret)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, disc.RevocationEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

func (c *OIDCClient) BuildEndSessionURL(ctx context.Context, idTokenHint, postLogoutRedirectURI string) string {
	if !c.cfg.Enabled {
		return ""
	}
	disc, err := c.GetDiscovery(ctx)
	if err != nil || disc.EndSessionEndpoint == "" {
		return ""
	}

	u, err := url.Parse(disc.EndSessionEndpoint)
	if err != nil {
		return ""
	}
	q := u.Query()
	if idTokenHint != "" {
		q.Set("id_token_hint", idTokenHint)
	}
	q.Set("client_id", c.cfg.ClientID)
	if postLogoutRedirectURI != "" {
		q.Set("post_logout_redirect_uri", postLogoutRedirectURI)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func (c *OIDCClient) IsGroupAllowed(groups []string) bool {
	if len(c.cfg.AllowedGroups) == 0 {
		return true
	}
	allowed := make(map[string]bool, len(c.cfg.AllowedGroups))
	for _, g := range c.cfg.AllowedGroups {
		allowed[strings.ToLower(g)] = true
	}
	for _, g := range groups {
		if allowed[strings.ToLower(strings.TrimSpace(g))] {
			return true
		}
	}
	return false
}

func audienceContains(aud []string, clientID string) bool {
	for _, a := range aud {
		if a == clientID {
			return true
		}
	}
	return false
}

func GenerateRandomToken(numBytes int) (string, error) {
	b := make([]byte, numBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
