package state

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"

	"homie/internal/models"

	"github.com/andybalholm/brotli"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BootstrapPayload is the combined client snapshot served by GET /api/v1/bootstrap.
type BootstrapPayload struct {
	Workspaces  []models.Workspace         `json:"workspaces"`
	Nodes       []models.Node              `json:"nodes"`
	Preferences map[string]json.RawMessage `json:"preferences"`
	Signals     map[string]any             `json:"signals"`
}

// PrecomputedSnapshot holds the serialized and Brotli-compressed structural state in RAM.
type PrecomputedSnapshot struct {
	ETag        string
	RawJSON     []byte
	BrotliBytes []byte
}

// SignalDelta represents a real-time signal update broadcast over SSE.
type SignalDelta struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type sseClient struct {
	sessionID uuid.UUID
	ch        chan []byte
	revoked   chan struct{}
	closeOnce sync.Once
}

func (c *sseClient) revoke() {
	c.closeOnce.Do(func() {
		if msg, err := json.Marshal(SignalDelta{Key: "auth:revoked", Value: true}); err == nil {
			select {
			case c.ch <- msg:
			default:
			}
		}
		close(c.revoked)
	})
}

type userState struct {
	snapshot atomic.Pointer[PrecomputedSnapshot]

	signalsMu sync.RWMutex
	signals   map[string]any

	clientsMu sync.RWMutex
	clients   map[*sseClient]struct{}
}

func newUserState() *userState {
	return &userState{
		signals: make(map[string]any),
		clients: make(map[*sseClient]struct{}),
	}
}

// Engine manages per-user lock-free structural snapshots, global + per-user signal buses,
// and session-aware SSE subscribers.
type Engine struct {
	db *gorm.DB

	globalMu      sync.RWMutex
	globalSignals map[string]any

	usersMu sync.RWMutex
	users   map[uuid.UUID]*userState
}

func NewEngine(db *gorm.DB) *Engine {
	return &Engine{
		db:            db,
		globalSignals: make(map[string]any),
		users:         make(map[uuid.UUID]*userState),
	}
}

func (e *Engine) getOrCreateUserState(userID uuid.UUID) *userState {
	e.usersMu.RLock()
	us, ok := e.users[userID]
	e.usersMu.RUnlock()
	if ok {
		return us
	}

	e.usersMu.Lock()
	defer e.usersMu.Unlock()
	if us, ok = e.users[userID]; ok {
		return us
	}
	us = newUserState()
	e.users[userID] = us
	return us
}

// LoadOrBuildSnapshot returns the user's precomputed snapshot (building it lazily on first access).
func (e *Engine) LoadOrBuildSnapshot(ctx context.Context, userID uuid.UUID) (*PrecomputedSnapshot, error) {
	us := e.getOrCreateUserState(userID)
	if snap := us.snapshot.Load(); snap != nil {
		return snap, nil
	}
	if err := e.RebuildSnapshot(ctx, userID); err != nil {
		return nil, err
	}
	return us.snapshot.Load(), nil
}

// RebuildSnapshot queries PostgreSQL for a single user's workspaces, nodes, and preferences,
// pre-compresses with Brotli Quality 11, swaps the atomic pointer, and emits the new ETag
// strictly to that user's SSE tabs.
func (e *Engine) RebuildSnapshot(ctx context.Context, userID uuid.UUID) error {
	us := e.getOrCreateUserState(userID)

	var workspaces []models.Workspace
	if err := e.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Find(&workspaces).Error; err != nil {
		return fmt.Errorf("failed querying workspaces: %w", err)
	}

	var nodes []models.Node
	if len(workspaces) > 0 {
		wsIDs := make([]uuid.UUID, len(workspaces))
		for i, w := range workspaces {
			wsIDs[i] = w.ID
		}
		if err := e.db.WithContext(ctx).
			Where("workspace_id IN ?", wsIDs).
			Order("sort_order ASC, created_at ASC").
			Find(&nodes).Error; err != nil {
			return fmt.Errorf("failed querying nodes: %w", err)
		}
	} else {
		nodes = []models.Node{}
	}

	var prefRows []models.Preference
	if err := e.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("key ASC").
		Find(&prefRows).Error; err != nil {
		return fmt.Errorf("failed querying preferences: %w", err)
	}
	preferences := make(map[string]json.RawMessage, len(prefRows))
	for _, p := range prefRows {
		if len(p.Value) == 0 {
			preferences[p.Key] = json.RawMessage(`{}`)
		} else {
			preferences[p.Key] = p.Value
		}
	}

	activeNodeIDs := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		activeNodeIDs[n.ID.String()] = true
	}

	mergedSignals := make(map[string]any)
	e.globalMu.RLock()
	for k, v := range e.globalSignals {
		mergedSignals[k] = v
	}
	e.globalMu.RUnlock()

	us.signalsMu.Lock()
	for k := range us.signals {
		for _, prefix := range []string{"calendar:events:", "calendar:status:", "node:health:", "weather:"} {
			if len(k) > len(prefix) && k[:len(prefix)] == prefix {
				id := k[len(prefix):]
				if !activeNodeIDs[id] {
					delete(us.signals, k)
				}
			}
		}
	}
	for k, v := range us.signals {
		mergedSignals[k] = v
	}
	us.signalsMu.Unlock()

	structuralBytes, err := json.Marshal(struct {
		Workspaces  []models.Workspace         `json:"workspaces"`
		Nodes       []models.Node              `json:"nodes"`
		Preferences map[string]json.RawMessage `json:"preferences"`
	}{
		Workspaces:  workspaces,
		Nodes:       nodes,
		Preferences: preferences,
	})
	if err != nil {
		return fmt.Errorf("failed marshaling structural state: %w", err)
	}
	hash := sha256.Sum256(structuralBytes)
	etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:16]))

	payload := BootstrapPayload{
		Workspaces:  workspaces,
		Nodes:       nodes,
		Preferences: preferences,
		Signals:     mergedSignals,
	}

	rawJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed marshaling bootstrap payload: %w", err)
	}

	var brBuf bytes.Buffer
	brWriter := brotli.NewWriterLevel(&brBuf, 11)
	if _, err := brWriter.Write(rawJSON); err != nil {
		return fmt.Errorf("failed writing brotli stream: %w", err)
	}
	if err := brWriter.Close(); err != nil {
		return fmt.Errorf("failed closing brotli writer: %w", err)
	}

	prevSnap := us.snapshot.Load()
	us.snapshot.Store(&PrecomputedSnapshot{
		ETag:        etag,
		RawJSON:     rawJSON,
		BrotliBytes: brBuf.Bytes(),
	})

	if prevSnap != nil && prevSnap.ETag != etag {
		e.EmitUserSignal(ctx, userID, "system:snapshot:etag", etag)
	}

	return nil
}

// EmitGlobalSignal updates a system-wide signal (e.g., uptime) and broadcasts it to all active users.
func (e *Engine) EmitGlobalSignal(_ context.Context, key string, value any) {
	e.globalMu.Lock()
	e.globalSignals[key] = value
	e.globalMu.Unlock()

	deltaBytes, err := json.Marshal(SignalDelta{Key: key, Value: value})
	if err != nil {
		return
	}

	e.usersMu.RLock()
	users := make([]*userState, 0, len(e.users))
	for _, us := range e.users {
		users = append(users, us)
	}
	e.usersMu.RUnlock()

	for _, us := range users {
		us.clientsMu.RLock()
		for client := range us.clients {
			select {
			case client.ch <- deltaBytes:
			default:
			}
		}
		us.clientsMu.RUnlock()
	}
}

// EmitUserSignal updates a user-private signal and broadcasts it only to that user's SSE tabs.
func (e *Engine) EmitUserSignal(_ context.Context, userID uuid.UUID, key string, value any) {
	us := e.getOrCreateUserState(userID)

	us.signalsMu.Lock()
	us.signals[key] = value
	us.signalsMu.Unlock()

	deltaBytes, err := json.Marshal(SignalDelta{Key: key, Value: value})
	if err != nil {
		return
	}

	us.clientsMu.RLock()
	for client := range us.clients {
		select {
		case client.ch <- deltaBytes:
		default:
		}
	}
	us.clientsMu.RUnlock()
}

// CurrentSignalDeltas returns serialized SSE payloads for global + user-specific active signals.
func (e *Engine) CurrentSignalDeltas(userID uuid.UUID) [][]byte {
	us := e.getOrCreateUserState(userID)

	e.globalMu.RLock()
	out := make([][]byte, 0, len(e.globalSignals)+8)
	for k, v := range e.globalSignals {
		if b, err := json.Marshal(SignalDelta{Key: k, Value: v}); err == nil {
			out = append(out, b)
		}
	}
	e.globalMu.RUnlock()

	us.signalsMu.RLock()
	for k, v := range us.signals {
		if b, err := json.Marshal(SignalDelta{Key: k, Value: v}); err == nil {
			out = append(out, b)
		}
	}
	us.signalsMu.RUnlock()

	return out
}

// SubscribeSSE registers a new real-time SSE listener channel bound to userID + sessionID.
func (e *Engine) SubscribeSSE(userID, sessionID uuid.UUID) (ch <-chan []byte, revoked <-chan struct{}, unsubscribe func()) {
	us := e.getOrCreateUserState(userID)
	client := &sseClient{
		sessionID: sessionID,
		ch:        make(chan []byte, 48),
		revoked:   make(chan struct{}),
	}

	us.clientsMu.Lock()
	us.clients[client] = struct{}{}
	us.clientsMu.Unlock()

	unsubscribe = func() {
		us.clientsMu.Lock()
		delete(us.clients, client)
		close(client.ch)
		us.clientsMu.Unlock()
	}

	return client.ch, client.revoked, unsubscribe
}

// DisconnectSessions immediately notifies and closes SSE streams belonging to revoked sessions.
func (e *Engine) DisconnectSessions(_ context.Context, sessionIDs []uuid.UUID) {
	if len(sessionIDs) == 0 {
		return
	}
	target := make(map[uuid.UUID]bool, len(sessionIDs))
	for _, id := range sessionIDs {
		if id != uuid.Nil {
			target[id] = true
		}
	}
	if len(target) == 0 {
		return
	}

	e.usersMu.RLock()
	users := make([]*userState, 0, len(e.users))
	for _, us := range e.users {
		users = append(users, us)
	}
	e.usersMu.RUnlock()

	for _, us := range users {
		us.clientsMu.RLock()
		for client := range us.clients {
			if target[client.sessionID] {
				client.revoke()
			}
		}
		us.clientsMu.RUnlock()
	}
}
