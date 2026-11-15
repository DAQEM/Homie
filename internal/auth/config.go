package auth

import (
	"crypto/sha256"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// LocalDefaultUserID is used when OIDC is not configured (single-user local mode).
var LocalDefaultUserID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

type Config struct {
	Enabled               bool
	ProviderName          string
	IssuerURL             string
	ClientID              string
	ClientSecret          string
	RedirectURL           string
	PostLogoutRedirectURL string
	Scopes                []string
	AllowedGroups         []string
	InsecureSkipVerify    bool
	SessionSecret         []byte
	SessionTTL            time.Duration
	CookieSecure          string // "auto" | "true" | "false"
}

func LoadConfigFromEnv(masterEncryptionKey string) Config {
	issuer := strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL"))
	clientID := strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID"))

	providerName := strings.TrimSpace(os.Getenv("OIDC_PROVIDER_NAME"))
	if providerName == "" {
		providerName = "Authentik"
	}

	scopesRaw := strings.TrimSpace(os.Getenv("OIDC_SCOPES"))
	if scopesRaw == "" {
		scopesRaw = "openid profile email offline_access"
	}
	scopes := splitTokens(scopesRaw)
	hasOpenID := false
	for _, s := range scopes {
		if s == "openid" {
			hasOpenID = true
			break
		}
	}
	if !hasOpenID {
		scopes = append([]string{"openid"}, scopes...)
	}

	allowedGroups := splitTokens(os.Getenv("OIDC_ALLOWED_GROUPS"))

	insecureTLS := strings.EqualFold(strings.TrimSpace(os.Getenv("OIDC_INSECURE_SKIP_VERIFY")), "true")

	ttlHours := 168 // 7 days default
	if rawTTL := strings.TrimSpace(os.Getenv("SESSION_TTL_HOURS")); rawTTL != "" {
		if parsed, err := strconv.Atoi(rawTTL); err == nil && parsed > 0 {
			ttlHours = parsed
		}
	}

	cookieSecure := strings.ToLower(strings.TrimSpace(os.Getenv("COOKIE_SECURE")))
	if cookieSecure != "true" && cookieSecure != "false" {
		cookieSecure = "auto"
	}

	rawSecret := strings.TrimSpace(os.Getenv("SESSION_SECRET"))
	var sessionKey [32]byte
	if rawSecret != "" {
		sessionKey = sha256.Sum256([]byte("homie-session-v1:" + rawSecret))
	} else {
		sessionKey = sha256.Sum256([]byte("homie-session-v1:" + masterEncryptionKey))
	}

	return Config{
		Enabled:               issuer != "" && clientID != "",
		ProviderName:          providerName,
		IssuerURL:             issuer,
		ClientID:              clientID,
		ClientSecret:          strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")),
		RedirectURL:           strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")),
		PostLogoutRedirectURL: strings.TrimSpace(os.Getenv("OIDC_POST_LOGOUT_REDIRECT_URL")),
		Scopes:                scopes,
		AllowedGroups:         allowedGroups,
		InsecureSkipVerify:    insecureTLS,
		SessionSecret:         sessionKey[:],
		SessionTTL:            time.Duration(ttlHours) * time.Hour,
		CookieSecure:          cookieSecure,
	}
}

func splitTokens(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n'
	})
	var out []string
	seen := make(map[string]bool, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}
