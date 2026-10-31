package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"homie/internal/crypto"
	"homie/internal/models"
	"homie/internal/state"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Max base64 string length for a 100KB binary image (~137KB + data URI header).
const maxCustomIconLength = 150_000

type Server struct {
	db         *gorm.DB
	engine     *state.Engine
	cipher     *crypto.EnvelopeCipher
	frontendFS fs.FS
}

func NewRouter(db *gorm.DB, engine *state.Engine, cipher *crypto.EnvelopeCipher, frontendFS fs.FS) http.Handler {
	s := &Server{
		db:         db,
		engine:     engine,
		cipher:     cipher,
		frontendFS: frontendFS,
	}

	mux := http.NewServeMux()

	// 1. State Synchronization Endpoints
	mux.HandleFunc("GET /api/v1/bootstrap", s.handleBootstrap)
	mux.HandleFunc("GET /api/v1/live", s.handleLiveSSE)

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
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || strings.TrimSpace(input.Name) == "" {
		http.Error(w, "valid workspace name is required", http.StatusBadRequest)
		return
	}

	ws := models.Workspace{
		Name: strings.TrimSpace(input.Name),
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

	if err := s.db.WithContext(r.Context()).Delete(&models.Workspace{}, "id = ?", id).Error; err != nil {
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
		WorkspaceID uuid.UUID  `json:"workspace_id"`
		ParentID    *uuid.UUID `json:"parent_id"`
		SortOrder   int32      `json:"sort_order"`
		GridX       int32      `json:"grid_x"`
		GridY       int32      `json:"grid_y"`
		Title       string     `json:"title"`
		Icon        *string    `json:"icon"`
		NodeType    string     `json:"node_type"`
		URL         *string    `json:"url"`
		Width       int32      `json:"width"`
		Height      int32      `json:"height"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if input.NodeType == "container" {
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
		input.GridX, input.GridY, input.Width, input.Height = clampNodeToBlock(
			input.GridX, input.GridY, input.Width, input.Height,
		)
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
	}

	if err := s.db.WithContext(r.Context()).Create(&node).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
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

	if node.NodeType == "container" {
		patch["icon"] = nil
		patch["url"] = nil
	} else if iconStr, ok := patch["icon"].(string); ok && len(iconStr) > maxCustomIconLength {
		http.Error(w, "custom icon file is too large (max 100KB)", http.StatusBadRequest)
		return
	}

	if err := s.db.WithContext(r.Context()).Model(&node).Updates(patch).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = s.engine.RebuildSnapshot(r.Context())
	writeJSON(w, http.StatusOK, node)
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

func clampNodeToBlock(x, y, w, h int32) (int32, int32, int32, int32) {
	if x == -1 && y == -1 {
		return -1, -1, 1, 1
	}
	const (
		blockCols = int32(3)
		blockRows = int32(4)
		gridCols  = int32(12) // 4 blocks wide
		gridRows  = int32(8)  // 2 blocks high (8 blocks total)
	)

	if w < 1 {
		w = 1
	} else if w > blockCols {
		w = blockCols
	}
	if h < 1 {
		h = 1
	} else if h > blockRows {
		h = blockRows
	}

	if x < 1 {
		x = 1
	} else if x > gridCols {
		x = gridCols
	}
	if y < 1 {
		y = 1
	} else if y > gridRows {
		y = gridRows
	}

	bx := (x - 1) / blockCols
	by := (y - 1) / blockRows

	blockMinX := bx*blockCols + 1
	blockMaxX := (bx + 1) * blockCols
	blockMinY := by*blockRows + 1
	blockMaxY := (by + 1) * blockRows

	if x < blockMinX {
		x = blockMinX
	}
	if x+w-1 > blockMaxX {
		x = blockMaxX - w + 1
	}
	if y < blockMinY {
		y = blockMinY
	}
	if y+h-1 > blockMaxY {
		y = blockMaxY - h + 1
	}
	return x, y, w, h
}
