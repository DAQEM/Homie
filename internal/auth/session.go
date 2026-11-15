package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"homie/internal/crypto"
	"homie/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	SessionCookieName = "homie_session"
	TXCookieName      = "homie_oidc_tx"
)

type ctxKey string

const authUserCtxKey ctxKey = "homie_auth_user"

type AuthUser struct {
	ID            uuid.UUID `json:"id"`
	SessionID     uuid.UUID `json:"-"`
	Username      string    `json:"username"`
	DisplayName   string    `json:"displayName"`
	Email         string    `json:"email"`
	AvatarURL     string    `json:"avatarUrl"`
	Groups        []string  `json:"groups,omitempty"`
	Authenticated bool      `json:"-"`
}

func WithUser(ctx context.Context, u AuthUser) context.Context {
	return context.WithValue(ctx, authUserCtxKey, u)
}

func UserFromContext(ctx context.Context) (AuthUser, bool) {
	u, ok := ctx.Value(authUserCtxKey).(AuthUser)
	return u, ok
}

type OIDCTxState struct {
	State        string `json:"s"`
	Nonce        string `json:"n"`
	CodeVerifier string `json:"v"`
	RedirectURI  string `json:"r"`
	ReturnTo     string `json:"t"`
	IssuedAt     int64  `json:"i"`
}

type SessionManager struct {
	db     *gorm.DB
	cipher *crypto.EnvelopeCipher
	cfg    Config
	oidc   *OIDCClient

	refreshMu       sync.Mutex
	refreshInflight map[uuid.UUID]*refreshCall
}

type refreshCall struct {
	wg  sync.WaitGroup
	err error
}

func NewSessionManager(db *gorm.DB, cipher *crypto.EnvelopeCipher, cfg Config, oidc *OIDCClient) *SessionManager {
	return &SessionManager{
		db:              db,
		cipher:          cipher,
		cfg:             cfg,
		oidc:            oidc,
		refreshInflight: make(map[uuid.UUID]*refreshCall),
	}
}

func (m *SessionManager) Config() Config {
	return m.cfg
}

func (m *SessionManager) StartCleanupLoop(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				now := time.Now()
				_ = m.db.WithContext(ctx).Where("expires_at < ?", now).Delete(&models.Session{}).Error
				_ = m.db.WithContext(ctx).Where("expires_at < ?", now).Delete(&models.OIDCRevokedJTI{}).Error
			}
		}
	}()
}

// =========================================================================
// Cookie Signing & Encrypted Transaction Helpers
// =========================================================================

func (m *SessionManager) signSessionCookie(sessionID uuid.UUID) string {
	idStr := sessionID.String()
	mac := hmac.New(sha256.New, m.cfg.SessionSecret)
	mac.Write([]byte(idStr))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return idStr + "." + sig
}

func (m *SessionManager) parseSessionCookie(raw string) (uuid.UUID, bool) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return uuid.Nil, false
	}

	mac := hmac.New(sha256.New, m.cfg.SessionSecret)
	mac.Write([]byte(id.String()))
	expected := mac.Sum(nil)

	if subtle.ConstantTimeCompare(sig, expected) != 1 {
		return uuid.Nil, false
	}
	return id, true
}

func (m *SessionManager) IsSecureRequest(r *http.Request) bool {
	if m.cfg.CookieSecure == "true" {
		return true
	}
	if m.cfg.CookieSecure == "false" {
		return false
	}
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (m *SessionManager) SetTXCookie(w http.ResponseWriter, r *http.Request, tx OIDCTxState) error {
	raw, err := json.Marshal(tx)
	if err != nil {
		return err
	}
	enc, err := m.cipher.Encrypt(raw)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     TXCookieName,
		Value:    base64.RawURLEncoding.EncodeToString(enc),
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   m.IsSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
	return nil
}

func (m *SessionManager) PopTXCookie(w http.ResponseWriter, r *http.Request) (*OIDCTxState, error) {
	cookie, err := r.Cookie(TXCookieName)
	http.SetCookie(w, &http.Cookie{
		Name:     TXCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   m.IsSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	if err != nil {
		return nil, errors.New("missing OIDC transaction cookie")
	}

	enc, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil {
		return nil, errors.New("invalid OIDC transaction cookie encoding")
	}
	plain, err := m.cipher.Decrypt(enc)
	if err != nil {
		return nil, errors.New("invalid OIDC transaction cookie signature")
	}

	var tx OIDCTxState
	if err := json.Unmarshal(plain, &tx); err != nil {
		return nil, errors.New("corrupt OIDC transaction payload")
	}
	if time.Now().Unix()-tx.IssuedAt > 600 {
		return nil, errors.New("OIDC login transaction expired")
	}
	return &tx, nil
}

func (m *SessionManager) SetSessionCookie(w http.ResponseWriter, r *http.Request, sessionID uuid.UUID) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    m.signSessionCookie(sessionID),
		Path:     "/",
		HttpOnly: true,
		Secure:   m.IsSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(m.cfg.SessionTTL.Seconds()),
	})
}

func (m *SessionManager) ClearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   m.IsSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// =========================================================================
// User Provisioning, Starter Board & Session Lifecycle
// =========================================================================

func (m *SessionManager) CreateLoginSession(
	ctx context.Context,
	claims *IDTokenClaims,
	userInfo *UserInfoClaims,
	tok *TokenResponse,
) (models.User, models.Session, error) {
	username := firstNonEmpty(claims.PreferredUsername, userInfoPreferredUsername(userInfo), claims.Email, claims.Subject)
	displayName := firstNonEmpty(claims.Name, userInfoName(userInfo), username)
	email := firstNonEmpty(claims.Email, userInfoEmail(userInfo))
	avatarURL := firstNonEmpty(claims.Picture, userInfoPicture(userInfo))
	groups := mergeGroups(claims.Groups, userInfoGroups(userInfo))

	if !m.oidc.IsGroupAllowed(groups) {
		return models.User{}, models.Session{}, errors.New("access restricted by group policy")
	}

	groupsJSON, _ := json.Marshal(groups)
	now := time.Now().UTC()

	var idTokenEnc, refreshTokenEnc []byte
	var err error
	if tok.IDToken != "" {
		if idTokenEnc, err = m.cipher.Encrypt([]byte(tok.IDToken)); err != nil {
			return models.User{}, models.Session{}, err
		}
	}
	if tok.RefreshToken != "" {
		if refreshTokenEnc, err = m.cipher.Encrypt([]byte(tok.RefreshToken)); err != nil {
			return models.User{}, models.Session{}, err
		}
	}

	var accessExpiresAt *time.Time
	if tok.ExpiresIn > 0 {
		t := now.Add(time.Duration(tok.ExpiresIn) * time.Second)
		accessExpiresAt = &t
	}

	var (
		user    models.User
		session models.Session
	)

	err = m.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		sub := claims.Subject
		findErr := tx.Where("oidc_sub = ?", sub).First(&user).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			user = models.User{
				OIDCSub:     &sub,
				Username:    username,
				DisplayName: displayName,
				Email:       email,
				AvatarURL:   avatarURL,
				Groups:      groupsJSON,
				LastLoginAt: &now,
				BoardSeeded: false,
			}
			if err := tx.Create(&user).Error; err != nil {
				return err
			}
		} else if findErr != nil {
			return findErr
		} else {
			updates := map[string]any{
				"username":      username,
				"display_name":  displayName,
				"email":         email,
				"avatar_url":    avatarURL,
				"groups":        groupsJSON,
				"last_login_at": &now,
			}
			if err := tx.Model(&user).Updates(updates).Error; err != nil {
				return err
			}
			user.Username = username
			user.DisplayName = displayName
			user.Email = email
			user.AvatarURL = avatarURL
			user.Groups = groupsJSON
		}

		// Provision personal starter board on the user's very first login
		if !user.BoardSeeded {
			var wsCount int64
			if err := tx.Model(&models.Workspace{}).Where("user_id = ?", user.ID).Count(&wsCount).Error; err != nil {
				return err
			}
			if wsCount == 0 {
				if err := seedStarterBoardTx(tx, user.ID); err != nil {
					return err
				}
			}
			if err := tx.Model(&user).Update("board_seeded", true).Error; err != nil {
				return err
			}
			user.BoardSeeded = true
		}

		session = models.Session{
			UserID:               user.ID,
			OIDCSid:              claims.SessionID,
			IDTokenEnc:           idTokenEnc,
			RefreshTokenEnc:      refreshTokenEnc,
			AccessTokenExpiresAt: accessExpiresAt,
			ExpiresAt:            now.Add(m.cfg.SessionTTL),
		}
		return tx.Create(&session).Error
	})

	return user, session, err
}

func (m *SessionManager) ResolveRequest(w http.ResponseWriter, r *http.Request) (AuthUser, bool) {
	if !m.cfg.Enabled {
		return AuthUser{
			ID:            LocalDefaultUserID,
			Username:      "local",
			DisplayName:   "Local User",
			Authenticated: true,
		}, true
	}

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return AuthUser{}, false
	}
	sessionID, ok := m.parseSessionCookie(cookie.Value)
	if !ok {
		return AuthUser{}, false
	}

	var sess models.Session
	if err := m.db.WithContext(r.Context()).
		Where("id = ? AND expires_at > ?", sessionID, time.Now().UTC()).
		First(&sess).Error; err != nil {
		return AuthUser{}, false
	}

	var user models.User
	if err := m.db.WithContext(r.Context()).First(&user, "id = ?", sess.UserID).Error; err != nil {
		return AuthUser{}, false
	}

	// If access token expired and we hold an encrypted refresh token, refresh in singleflight
	// to synchronize revocation and group membership updates with Authentik.
	if sess.AccessTokenExpiresAt != nil && time.Now().UTC().After(*sess.AccessTokenExpiresAt) && len(sess.RefreshTokenEnc) > 0 {
		if err := m.refreshSessionTokens(r.Context(), &sess, &user); err != nil {
			if errors.Is(err, ErrRefreshInvalidGrant) || strings.Contains(err.Error(), "group policy") {
				_ = m.db.WithContext(r.Context()).Delete(&models.Session{}, "id = ?", sess.ID).Error
				if w != nil {
					m.ClearSessionCookie(w, r)
				}
				return AuthUser{}, false
			}
		}
	}

	// Sliding window renewal when session crosses half its TTL
	now := time.Now().UTC()
	if sess.ExpiresAt.Sub(now) < m.cfg.SessionTTL/2 {
		newExp := now.Add(m.cfg.SessionTTL)
		_ = m.db.WithContext(r.Context()).Model(&sess).Update("expires_at", newExp).Error
		if w != nil {
			m.SetSessionCookie(w, r, sess.ID)
		}
	}

	var groups []string
	if len(user.Groups) > 0 {
		_ = json.Unmarshal(user.Groups, &groups)
	}

	return AuthUser{
		ID:            user.ID,
		SessionID:     sess.ID,
		Username:      user.Username,
		DisplayName:   user.DisplayName,
		Email:         user.Email,
		AvatarURL:     user.AvatarURL,
		Groups:        groups,
		Authenticated: true,
	}, true
}

func (m *SessionManager) refreshSessionTokens(ctx context.Context, sess *models.Session, user *models.User) error {
	m.refreshMu.Lock()
	if call, exists := m.refreshInflight[sess.ID]; exists {
		m.refreshMu.Unlock()
		call.wg.Wait()
		return call.err
	}
	call := &refreshCall{}
	call.wg.Add(1)
	m.refreshInflight[sess.ID] = call
	m.refreshMu.Unlock()

	defer func() {
		call.wg.Done()
		m.refreshMu.Lock()
		delete(m.refreshInflight, sess.ID)
		m.refreshMu.Unlock()
	}()

	plainRefresh, err := m.cipher.Decrypt(sess.RefreshTokenEnc)
	if err != nil {
		call.err = err
		return err
	}

	tok, err := m.oidc.RefreshTokens(ctx, string(plainRefresh))
	if err != nil {
		call.err = err
		return err
	}

	now := time.Now().UTC()
	updates := map[string]any{}
	if tok.ExpiresIn > 0 {
		exp := now.Add(time.Duration(tok.ExpiresIn) * time.Second)
		updates["access_token_expires_at"] = &exp
	} else {
		exp := now.Add(5 * time.Minute)
		updates["access_token_expires_at"] = &exp
	}

	if tok.RefreshToken != "" {
		if enc, err := m.cipher.Encrypt([]byte(tok.RefreshToken)); err == nil {
			updates["refresh_token_enc"] = enc
		}
	}

	if tok.IDToken != "" {
		if claims, err := m.oidc.VerifyIDToken(ctx, tok.IDToken, "", false); err == nil {
			if enc, err := m.cipher.Encrypt([]byte(tok.IDToken)); err == nil {
				updates["id_token_enc"] = enc
			}
			groups := claims.Groups
			if ui, err := m.oidc.FetchUserInfo(ctx, tok.AccessToken); err == nil && ui != nil {
				groups = mergeGroups(groups, ui.Groups)
			}
			if !m.oidc.IsGroupAllowed(groups) {
				call.err = errors.New("access restricted by group policy")
				return call.err
			}
			groupsJSON, _ := json.Marshal(groups)
			_ = m.db.WithContext(ctx).Model(user).Updates(map[string]any{
				"groups":       groupsJSON,
				"display_name": firstNonEmpty(claims.Name, user.DisplayName),
				"email":        firstNonEmpty(claims.Email, user.Email),
			}).Error
			user.Groups = groupsJSON
		}
	}

	if len(updates) > 0 {
		_ = m.db.WithContext(ctx).Model(sess).Updates(updates).Error
	}
	return nil
}

// RevokeCurrentSession deletes the active session and returns decrypted tokens for upstream RP logout/revocation.
func (m *SessionManager) RevokeCurrentSession(ctx context.Context, r *http.Request) (sessionID uuid.UUID, idToken, refreshToken string) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return uuid.Nil, "", ""
	}
	sid, ok := m.parseSessionCookie(cookie.Value)
	if !ok {
		return uuid.Nil, "", ""
	}

	var sess models.Session
	if err := m.db.WithContext(ctx).First(&sess, "id = ?", sid).Error; err == nil {
		if len(sess.IDTokenEnc) > 0 {
			if plain, err := m.cipher.Decrypt(sess.IDTokenEnc); err == nil {
				idToken = string(plain)
			}
		}
		if len(sess.RefreshTokenEnc) > 0 {
			if plain, err := m.cipher.Decrypt(sess.RefreshTokenEnc); err == nil {
				refreshToken = string(plain)
			}
		}
		_ = m.db.WithContext(ctx).Delete(&models.Session{}, "id = ?", sid).Error
		return sid, idToken, refreshToken
	}
	return uuid.Nil, "", ""
}

// CheckAndRecordLogoutJTI enforces single-use replay protection for Back-Channel Logout tokens.
func (m *SessionManager) CheckAndRecordLogoutJTI(ctx context.Context, jti string, expUnix int64) error {
	exp := time.Now().UTC().Add(24 * time.Hour)
	if expUnix > 0 {
		exp = time.Unix(expUnix, 0).UTC().Add(5 * time.Minute)
	}
	res := m.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&models.OIDCRevokedJTI{
			JTI:       jti,
			ExpiresAt: exp,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("logout_token jti replay detected")
	}
	return nil
}

// RevokeByBackChannel removes sessions matching `sid` and/or `sub` and returns all deleted session IDs.
func (m *SessionManager) RevokeByBackChannel(ctx context.Context, sub, sid string) ([]uuid.UUID, error) {
	if sub == "" && sid == "" {
		return nil, errors.New("missing both sub and sid")
	}

	q := m.db.WithContext(ctx).Model(&models.Session{})
	switch {
	case sid != "" && sub != "":
		q = q.Where("oidc_sid = ? AND user_id IN (SELECT id FROM users WHERE oidc_sub = ?)", sid, sub)
	case sid != "":
		q = q.Where("oidc_sid = ?", sid)
	default:
		q = q.Where("user_id IN (SELECT id FROM users WHERE oidc_sub = ?)", sub)
	}

	var sessionIDs []uuid.UUID
	if err := q.Pluck("id", &sessionIDs).Error; err != nil {
		return nil, err
	}
	if len(sessionIDs) == 0 {
		return nil, nil
	}

	if err := m.db.WithContext(ctx).Where("id IN ?", sessionIDs).Delete(&models.Session{}).Error; err != nil {
		return nil, err
	}
	return sessionIDs, nil
}

// RevokeByFrontChannel removes sessions matching `sid` (or the current request's session cookie).
func (m *SessionManager) RevokeByFrontChannel(ctx context.Context, sid string, currentSessionID uuid.UUID) []uuid.UUID {
	var ids []uuid.UUID
	if sid != "" {
		_ = m.db.WithContext(ctx).Model(&models.Session{}).Where("oidc_sid = ?", sid).Pluck("id", &ids).Error
		if len(ids) > 0 {
			_ = m.db.WithContext(ctx).Where("id IN ?", ids).Delete(&models.Session{}).Error
		}
	}
	if currentSessionID != uuid.Nil {
		_ = m.db.WithContext(ctx).Delete(&models.Session{}, "id = ?", currentSessionID).Error
		ids = append(ids, currentSessionID)
	}
	return ids
}

func seedStarterBoardTx(tx *gorm.DB, userID uuid.UUID) error {
	ws := models.Workspace{
		UserID: userID,
		Name:   "Home",
	}
	if err := tx.Create(&ws).Error; err != nil {
		return fmt.Errorf("failed creating starter workspace: %w", err)
	}

	githubURL := "https://github.com"
	hnURL := "https://news.ycombinator.com"

	starterNodes := []models.Node{
		{
			WorkspaceID: ws.ID,
			SortOrder:   101,
			GridX:       1,
			GridY:       1,
			Title:       "Amsterdam",
			NodeType:    "clock",
			Width:       2,
			Height:      2,
			Settings:    json.RawMessage(`{"timezone":"Europe/Amsterdam","flag":"🇳🇱","sweepSeconds":true}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   301,
			GridX:       1,
			GridY:       3,
			Title:       "Amsterdam",
			NodeType:    "weather",
			Width:       2,
			Height:      2,
			Settings:    json.RawMessage(`{"location":"Amsterdam","tempUnit":"C"}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   103,
			GridX:       3,
			GridY:       1,
			Title:       "Search",
			NodeType:    "search",
			Width:       6,
			Height:      1,
			Settings:    json.RawMessage(`{"placeholder":"Search Web or Spotlight (⌘K)...","engineUrl":"https://www.google.com/search?q="}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   203,
			GridX:       3,
			GridY:       2,
			Title:       "Schedule",
			NodeType:    "calendar",
			Width:       4,
			Height:      2,
			Settings:    json.RawMessage(`{"timezone":"Europe/Amsterdam","calendarFeeds":[]}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   207,
			GridX:       7,
			GridY:       2,
			Title:       "Tasks",
			NodeType:    "todo",
			Width:       4,
			Height:      2,
			Settings:    json.RawMessage(`{"vikunjaFilter":"all","vikunjaShowCompleted":false}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   1,
			GridX:       -1,
			GridY:       -1,
			Title:       "GitHub",
			NodeType:    "action",
			URL:         &githubURL,
			Width:       1,
			Height:      1,
			Settings:    json.RawMessage(`{"healthCheck":false}`),
		},
		{
			WorkspaceID: ws.ID,
			SortOrder:   2,
			GridX:       -1,
			GridY:       -1,
			Title:       "Hacker News",
			NodeType:    "action",
			URL:         &hnURL,
			Width:       1,
			Height:      1,
			Settings:    json.RawMessage(`{"healthCheck":false}`),
		},
	}

	if err := tx.Create(&starterNodes).Error; err != nil {
		return fmt.Errorf("failed creating starter nodes: %w", err)
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func userInfoPreferredUsername(u *UserInfoClaims) string {
	if u == nil {
		return ""
	}
	return u.PreferredUsername
}

func userInfoName(u *UserInfoClaims) string {
	if u == nil {
		return ""
	}
	if u.Name != "" {
		return u.Name
	}
	return u.GivenName
}

func userInfoEmail(u *UserInfoClaims) string {
	if u == nil {
		return ""
	}
	return u.Email
}

func userInfoPicture(u *UserInfoClaims) string {
	if u == nil {
		return ""
	}
	return u.Picture
}

func userInfoGroups(u *UserInfoClaims) []string {
	if u == nil {
		return nil
	}
	return u.Groups
}

func mergeGroups(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	var out []string
	for _, g := range append(append([]string(nil), a...), b...) {
		g = strings.TrimSpace(g)
		if g != "" && !seen[g] {
			seen[g] = true
			out = append(out, g)
		}
	}
	return out
}
