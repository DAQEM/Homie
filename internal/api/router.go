package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"homie/internal/crypto"
	"homie/internal/integrations"
	"homie/internal/models"
	"homie/internal/state"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Max base64 string length for a 100KB binary image (~137KB + data URI header).
const maxCustomIconLength = 150_000

var (
	ogSiteNameRe = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']`)
	ogSiteRevRe  = regexp.MustCompile(`(?is)<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']`)
	titleTagRe   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

type cachedIcon struct {
	data        []byte
	contentType string
	etag        string
}

type urlMetaResponse struct {
	Title        string `json:"title"`
	Domain       string `json:"domain"`
	IconURL      string `json:"icon_url"`
	CanonicalURL string `json:"canonical_url"`
}

// Zero-dependency singleflight group to coalesce concurrent upstream icon/meta fetches.
type inflightCall struct {
	wg  sync.WaitGroup
	val any
	err error
}

type singleflightGroup struct {
	mu    sync.Mutex
	calls map[string]*inflightCall
}

func (g *singleflightGroup) Do(key string, fn func() (any, error)) (any, error) {
	g.mu.Lock()
	if g.calls == nil {
		g.calls = make(map[string]*inflightCall)
	}
	if c, ok := g.calls[key]; ok {
		g.mu.Unlock()
		c.wg.Wait()
		return c.val, c.err
	}
	c := new(inflightCall)
	c.wg.Add(1)
	g.calls[key] = c
	g.mu.Unlock()

	c.val, c.err = fn()
	c.wg.Done()

	g.mu.Lock()
	delete(g.calls, key)
	g.mu.Unlock()

	return c.val, c.err
}

type Server struct {
	db               *gorm.DB
	engine           *state.Engine
	cipher           *crypto.EnvelopeCipher
	calendarProvider *integrations.CalendarProvider
	frontendFS       fs.FS
	httpClient       *http.Client
	iconCache        sync.Map // map[string]cachedIcon
	metaCache        sync.Map // map[string]urlMetaResponse
	sf               singleflightGroup
}

func NewRouter(
	db *gorm.DB,
	engine *state.Engine,
	cipher *crypto.EnvelopeCipher,
	calendarProvider *integrations.CalendarProvider,
	frontendFS fs.FS,
) http.Handler {
	s := &Server{
		db:               db,
		engine:           engine,
		cipher:           cipher,
		calendarProvider: calendarProvider,
		frontendFS:       frontendFS,
		httpClient: &http.Client{
			Timeout: 3500 * time.Millisecond,
		},
	}

	mux := http.NewServeMux()

	// 1. State Synchronization & High-Speed Asset Endpoints
	mux.HandleFunc("GET /api/v1/bootstrap", s.handleBootstrap)
	mux.HandleFunc("GET /api/v1/live", s.handleLiveSSE)
	mux.HandleFunc("GET /api/v1/icons/{domain}", s.handleGetDomainIcon)
	mux.HandleFunc("GET /api/v1/meta", s.handleGetURLMetadata)

	// 2. Workspace Management Endpoints
	mux.HandleFunc("GET /api/v1/workspaces", s.handleListWorkspaces)
	mux.HandleFunc("POST /api/v1/workspaces", s.handleCreateWorkspace)
	mux.HandleFunc("DELETE /api/v1/workspaces/{id}", s.handleDeleteWorkspace)

	// 3. Node & Layout Management Endpoints (via GORM)
	mux.HandleFunc("GET /api/v1/nodes", s.handleListNodes)
	mux.HandleFunc("POST /api/v1/nodes", s.handleCreateNode)
	mux.HandleFunc("POST /api/v1/nodes/reorder", s.handleReorderNodes)
	mux.HandleFunc("PATCH /api/v1/nodes/{id}", s.handleUpdateNode)
	mux.HandleFunc("DELETE /api/v1/nodes/{id}", s.handleDeleteNode)
	mux.HandleFunc("POST /api/v1/nodes/{id}/calendar-sync", s.handleSyncCalendarNode)

	// 4. Integration Management Endpoints (via GORM + AES-256-GCM)
	mux.HandleFunc("GET /api/v1/integrations", s.handleListIntegrations)
	mux.HandleFunc("POST /api/v1/integrations/{provider}/auth", s.handleCreateIntegration)
	mux.HandleFunc("DELETE /api/v1/integrations/{id}", s.handleDeleteIntegration)

	// 5. Embedded SPA Fallback
	mux.HandleFunc("GET /", s.handleSPA)

	return mux
}

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	snap := s.engine.LoadSnapshot()

	if inm := r.Header.Get("If-None-Match"); inm != "" && inm == snap.ETag {
		w.Header().Set("ETag", snap.ETag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", snap.ETag)
	w.Header().Set("Cache-Control", "no-cache")

	if strings.Contains(r.Header.Get("Accept-Encoding"), "br") && len(snap.BrotliBytes) > 0 {
		w.Header().Set("Content-Encoding", "br")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(snap.BrotliBytes)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(snap.RawJSON)
}

func (s *Server) handleLiveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := s.engine.SubscribeSSE()
	defer unsubscribe()

	_, _ = fmt.Fprintf(w, ": connected\n\n")
	// Immediately hydrate the client with all current volatile signals
	for _, delta := range s.engine.CurrentSignalDeltas() {
		_, _ = fmt.Fprintf(w, "data: %s\n\n", delta)
	}
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}

// handleGetDomainIcon resolves, coalesces, and caches high-res Apple Touch Icons / 128px favicons in RAM.
func (s *Server) handleGetDomainIcon(w http.ResponseWriter, r *http.Request) {
	domain := strings.ToLower(strings.TrimSpace(r.PathValue("domain")))
	if domain == "" || strings.Contains(domain, "/") {
		http.NotFound(w, r)
		return
	}

	if val, ok := s.iconCache.Load(domain); ok {
		serveCachedIcon(w, r, val.(cachedIcon))
		return
	}

	res, err := s.sf.Do("icon:"+domain, func() (any, error) {
		if val, ok := s.iconCache.Load(domain); ok {
			return val.(cachedIcon), nil
		}

		entry, err := s.fetchBestDomainIcon(r.Context(), domain)
		if err != nil {
			return cachedIcon{}, err
		}
		s.iconCache.Store(domain, entry)
		return entry, nil
	})
	if err != nil {
		http.NotFound(w, r)
		return
	}

	serveCachedIcon(w, r, res.(cachedIcon))
}

func serveCachedIcon(w http.ResponseWriter, r *http.Request, entry cachedIcon) {
	if inm := r.Header.Get("If-None-Match"); inm != "" && inm == entry.etag {
		w.Header().Set("ETag", entry.etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", entry.contentType)
	w.Header().Set("ETag", entry.etag)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(entry.data)
}

func (s *Server) fetchBestDomainIcon(ctx context.Context, domain string) (cachedIcon, error) {
	candidates := []string{
		fmt.Sprintf("https://%s/apple-touch-icon.png", domain),
		fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=128", url.QueryEscape(domain)),
	}

	for _, candidateURL := range candidates {
		reqCtx, cancel := context.WithTimeout(ctx, 1800*time.Millisecond)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, candidateURL, nil)
		if err != nil {
			cancel()
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15")

		resp, err := s.httpClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				_ = resp.Body.Close()
			}
			cancel()
			continue
		}

		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
		_ = resp.Body.Close()
		cancel()

		if readErr != nil || len(data) < 64 {
			continue
		}

		contentType := resp.Header.Get("Content-Type")
		if contentType == "" || strings.HasPrefix(contentType, "text/plain") {
			contentType = http.DetectContentType(data)
		}
		if !strings.HasPrefix(contentType, "image/") {
			continue
		}

		sum := sha256.Sum256(data)
		etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(sum[:12]))
		return cachedIcon{
			data:        data,
			contentType: contentType,
			etag:        etag,
		}, nil
	}

	return cachedIcon{}, fmt.Errorf("no valid icon found for %s", domain)
}

// handleGetURLMetadata resolves the clean app title and icon URL with singleflight deduplication.
func (s *Server) handleGetURLMetadata(w http.ResponseWriter, r *http.Request) {
	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		rawURL = "https://" + rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	domain := strings.ToLower(parsed.Hostname())
	cacheKey := parsed.String()

	if cached, ok := s.metaCache.Load(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	res, _ := s.sf.Do("meta:"+cacheKey, func() (any, error) {
		if cached, ok := s.metaCache.Load(cacheKey); ok {
			return cached, nil
		}

		result := urlMetaResponse{
			Title:        humanizeDomainTitle(domain),
			Domain:       domain,
			IconURL:      "/api/v1/icons/" + url.PathEscape(domain),
			CanonicalURL: parsed.String(),
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, parsed.String(), nil)
		if err == nil {
			req.Header.Set("User-Agent", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
			req.Header.Set("Accept", "text/html,application/xhtml+xml")

			if resp, err := s.httpClient.Do(req); err == nil {
				defer resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 400 {
					bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
					if extracted := extractCleanPageTitle(string(bodyBytes)); extracted != "" {
						result.Title = extracted
					}
				}
			}
		}

		s.metaCache.Store(cacheKey, result)
		return result, nil
	})

	writeJSON(w, http.StatusOK, res)
}

func extractCleanPageTitle(htmlHead string) string {
	if m := ogSiteNameRe.FindStringSubmatch(htmlHead); len(m) > 1 {
		if t := cleanExtractedTitle(m[1]); t != "" {
			return t
		}
	}
	if m := ogSiteRevRe.FindStringSubmatch(htmlHead); len(m) > 1 {
		if t := cleanExtractedTitle(m[1]); t != "" {
			return t
		}
	}
	if m := titleTagRe.FindStringSubmatch(htmlHead); len(m) > 1 {
		if t := cleanExtractedTitle(m[1]); t != "" {
			return t
		}
	}
	return ""
}

func cleanExtractedTitle(raw string) string {
	unescaped := strings.TrimSpace(html.UnescapeString(raw))
	unescaped = strings.Join(strings.Fields(unescaped), " ")

	for _, sep := range []string{" · ", " — ", " – ", " | ", " - ", " : "} {
		if idx := strings.Index(unescaped, sep); idx > 1 {
			unescaped = strings.TrimSpace(unescaped[:idx])
			break
		}
	}

	lower := strings.ToLower(unescaped)
	if lower == "just a moment..." || lower == "attention required!" || lower == "access denied" {
		return ""
	}
	if len(unescaped) > 32 {
		unescaped = strings.TrimSpace(unescaped[:32])
	}
	return unescaped
}

func humanizeDomainTitle(domain string) string {
	d := strings.TrimPrefix(domain, "www.")
	known := map[string]string{
		"github.com":           "GitHub",
		"gitlab.com":           "GitLab",
		"youtube.com":          "YouTube",
		"news.ycombinator.com": "Hacker News",
		"reddit.com":           "Reddit",
		"x.com":                "X",
		"twitter.com":          "Twitter",
		"chatgpt.com":          "ChatGPT",
		"claude.ai":            "Claude",
		"mail.google.com":      "Gmail",
		"calendar.google.com":  "Google Calendar",
		"drive.google.com":     "Google Drive",
		"open.spotify.com":     "Spotify",
		"spotify.com":          "Spotify",
		"netflix.com":          "Netflix",
		"twitch.tv":            "Twitch",
		"discord.com":          "Discord",
		"notion.so":            "Notion",
		"figma.com":            "Figma",
		"linear.app":           "Linear",
		"vercel.com":           "Vercel",
		"cloudflare.com":       "Cloudflare",
		"stackoverflow.com":    "Stack Overflow",
		"developer.apple.com":  "Apple Developer",
	}
	if val, ok := known[d]; ok {
		return val
	}
	parts := strings.Split(d, ".")
	base := parts[0]
	if len(parts) >= 3 && (parts[0] == "app" || parts[0] == "my" || parts[0] == "dash") {
		base = parts[1]
	}
	if base == "" {
		return domain
	}
	return strings.ToUpper(base[:1]) + base[1:]
}

func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	var workspaces []models.Workspace
	if err := s.db.WithContext(r.Context()).Order("created_at ASC").Find(&workspaces).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID   *uuid.UUID `json:"id"`
		Name string     `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || strings.TrimSpace(input.Name) == "" {
		http.Error(w, "valid workspace name is required", http.StatusBadRequest)
		return
	}

	ws := models.Workspace{
		Name: strings.TrimSpace(input.Name),
	}
	if input.ID != nil && *input.ID != uuid.Nil {
		ws.ID = *input.ID
	}

	if err := s.db.WithContext(r.Context()).Create(&ws).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
	writeJSON(w, http.StatusCreated, ws)
}

func (s *Server) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid workspace UUID", http.StatusBadRequest)
		return
	}

	err = s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var fallback models.Workspace
		if err := tx.Where("id <> ?", id).Order("created_at ASC").First(&fallback).Error; err == nil {
			var dockIDs []uuid.UUID
			_ = tx.Model(&models.Node{}).
				Where("workspace_id = ? AND parent_id IS NULL AND grid_x = -1 AND grid_y = -1", id).
				Pluck("id", &dockIDs).Error

			if len(dockIDs) > 0 {
				if err := tx.Model(&models.Node{}).
					Where("id IN ? OR parent_id IN ?", dockIDs, dockIDs).
					Update("workspace_id", fallback.ID).Error; err != nil {
					return err
				}
			}
		}

		return tx.Delete(&models.Workspace{}, "id = ?", id).Error
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListNodes(w http.ResponseWriter, r *http.Request) {
	var nodes []models.Node
	if err := s.db.WithContext(r.Context()).Order("sort_order ASC, created_at ASC").Find(&nodes).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleCreateNode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID          *uuid.UUID      `json:"id"`
		WorkspaceID uuid.UUID       `json:"workspace_id"`
		ParentID    *uuid.UUID      `json:"parent_id"`
		SortOrder   int32           `json:"sort_order"`
		GridX       int32           `json:"grid_x"`
		GridY       int32           `json:"grid_y"`
		Title       string          `json:"title"`
		Icon        *string         `json:"icon"`
		NodeType    string          `json:"node_type"`
		URL         *string         `json:"url"`
		Width       int32           `json:"width"`
		Height      int32           `json:"height"`
		Settings    json.RawMessage `json:"settings"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if input.NodeType != "action" {
		input.Icon = nil
		input.URL = nil
	} else if input.Icon != nil && len(*input.Icon) > maxCustomIconLength {
		http.Error(w, "custom icon file is too large (max 100KB)", http.StatusBadRequest)
		return
	}

	if input.ParentID != nil || input.NodeType == "action" {
		input.Width = 1
		input.Height = 1
	}
	if input.ParentID == nil {
		input.GridX, input.GridY, input.Width, input.Height = clampNodeToGrid(
			input.GridX, input.GridY, input.Width, input.Height,
		)
	}

	if len(input.Settings) == 0 {
		input.Settings = json.RawMessage(`{}`)
	}

	node := models.Node{
		WorkspaceID: input.WorkspaceID,
		ParentID:    input.ParentID,
		SortOrder:   input.SortOrder,
		GridX:       input.GridX,
		GridY:       input.GridY,
		Title:       input.Title,
		Icon:        input.Icon,
		NodeType:    input.NodeType,
		URL:         input.URL,
		Width:       input.Width,
		Height:      input.Height,
		Settings:    input.Settings,
	}
	if input.ID != nil && *input.ID != uuid.Nil {
		node.ID = *input.ID
	}

	if err := s.db.WithContext(r.Context()).Create(&node).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())

	if node.NodeType == "calendar" && s.calendarProvider != nil {
		s.calendarProvider.TriggerSync()
	}

	writeJSON(w, http.StatusCreated, node)
}

func (s *Server) handleReorderNodes(w http.ResponseWriter, r *http.Request) {
	var items []struct {
		ID        uuid.UUID  `json:"id"`
		SortOrder int32      `json:"sort_order"`
		GridX     int32      `json:"grid_x"`
		GridY     int32      `json:"grid_y"`
		Width     int32      `json:"width"`
		Height    int32      `json:"height"`
		ParentID  *uuid.UUID `json:"parent_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	err := s.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			updates := map[string]any{
				"sort_order": item.SortOrder,
				"parent_id":  item.ParentID,
			}
			if item.GridX == -1 || item.GridX >= 1 {
				updates["grid_x"] = item.GridX
			}
			if item.GridY == -1 || item.GridY >= 1 {
				updates["grid_y"] = item.GridY
			}
			if item.Width >= 1 {
				updates["width"] = item.Width
			}
			if item.Height >= 1 {
				updates["height"] = item.Height
			}
			if err := tx.Model(&models.Node{}).Where("id = ?", item.ID).Updates(updates).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdateNode(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid node UUID", http.StatusBadRequest)
		return
	}

	var node models.Node
	if err := s.db.WithContext(r.Context()).First(&node, "id = ?", id).Error; err != nil {
		http.Error(w, "node not found", http.StatusNotFound)
		return
	}

	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if node.NodeType != "action" {
		patch["icon"] = nil
		patch["url"] = nil
	} else if iconStr, ok := patch["icon"].(string); ok && len(iconStr) > maxCustomIconLength {
		http.Error(w, "custom icon file is too large (max 100KB)", http.StatusBadRequest)
		return
	}

	if rawSettings, ok := patch["settings"]; ok {
		b, err := json.Marshal(rawSettings)
		if err == nil {
			patch["settings"] = json.RawMessage(b)
		}
	}

	if err := s.db.WithContext(r.Context()).Model(&node).Updates(patch).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())

	if node.NodeType == "calendar" && s.calendarProvider != nil {
		s.calendarProvider.TriggerSync()
	}

	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleSyncCalendarNode(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid node UUID", http.StatusBadRequest)
		return
	}

	if s.calendarProvider == nil {
		http.Error(w, "calendar provider unavailable", http.StatusServiceUnavailable)
		return
	}

	status, err := s.calendarProvider.SyncNodeNow(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid node UUID", http.StatusBadRequest)
		return
	}

	if err := s.db.WithContext(r.Context()).Delete(&models.Node{}, "id = ?", id).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListIntegrations(w http.ResponseWriter, r *http.Request) {
	var list []models.Integration
	if err := s.db.WithContext(r.Context()).Order("created_at ASC").Find(&list).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateIntegration(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")

	var input struct {
		Credentials json.RawMessage `json:"credentials"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	encryptedCreds, err := s.cipher.Encrypt(input.Credentials)
	if err != nil {
		http.Error(w, "failed encrypting credentials", http.StatusInternalServerError)
		return
	}

	if len(input.Settings) == 0 {
		input.Settings = json.RawMessage(`{}`)
	}

	integration := models.Integration{
		Provider:    provider,
		Credentials: encryptedCreds,
		Settings:    input.Settings,
	}

	if err := s.db.WithContext(r.Context()).Create(&integration).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, integration)
}

func (s *Server) handleDeleteIntegration(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid integration UUID", http.StatusBadRequest)
		return
	}

	if err := s.db.WithContext(r.Context()).Delete(&models.Integration{}, "id = ?", id).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if cleanPath == "" {
		cleanPath = "index.html"
	}

	data, err := fs.ReadFile(s.frontendFS, cleanPath)
	if err != nil {
		cleanPath = "index.html"
		data, err = fs.ReadFile(s.frontendFS, cleanPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}

	contentType := mime.TypeByExtension(path.Ext(cleanPath))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func clampNodeToGrid(x, y, w, h int32) (int32, int32, int32, int32) {
	if x == -1 && y == -1 {
		return -1, -1, 1, 1
	}
	const (
		gridCols = int32(16)
		gridRows = int32(8)
	)

	if w < 1 {
		w = 1
	} else if w > gridCols {
		w = gridCols
	}
	if h < 1 {
		h = 1
	} else if h > gridRows {
		h = gridRows
	}

	if x < 1 {
		x = 1
	} else if x+w-1 > gridCols {
		x = gridCols - w + 1
	}
	if y < 1 {
		y = 1
	} else if y+h-1 > gridRows {
		y = gridRows - h + 1
	}

	return x, y, w, h
}
