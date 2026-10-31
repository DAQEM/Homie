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
	"gorm.io/gorm"
)

// BootstrapPayload is the combined client snapshot served by GET /api/v1/bootstrap.
type BootstrapPayload struct {
	Workspaces []models.Workspace `json:"workspaces"`
	Nodes      []models.Node      `json:"nodes"`
	Signals    map[string]any     `json:"signals"`
}

// PrecomputedSnapshot holds the serialized and Brotli-compressed state in RAM.
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

// Engine manages the lock-free snapshot, in-memory signal bus, and SSE subscribers.
type Engine struct {
	db       *gorm.DB
	snapshot atomic.Pointer[PrecomputedSnapshot]

	signalsMu sync.RWMutex
	signals   map[string]any

	clientsMu sync.RWMutex
	clients   map[chan []byte]struct{}
}

func NewEngine(db *gorm.DB) *Engine {
	e := &Engine{
		db:      db,
		signals: make(map[string]any),
		clients: make(map[chan []byte]struct{}),
	}

	e.snapshot.Store(&PrecomputedSnapshot{
		ETag:        `"init"`,
		RawJSON:     []byte(`{}`),
		BrotliBytes: []byte{},
	})

	return e
}

// LoadSnapshot performs a lock-free atomic pointer load (0 locks, 0 DB queries).
func (e *Engine) LoadSnapshot() *PrecomputedSnapshot {
	return e.snapshot.Load()
}

// RebuildSnapshot queries PostgreSQL via GORM, merges active signals, pre-compresses
// with Brotli Quality 11, computes the ETag, and swaps the pointer atomically.
func (e *Engine) RebuildSnapshot(ctx context.Context) error {
	var workspaces []models.Workspace
	if err := e.db.WithContext(ctx).Order("created_at ASC").Find(&workspaces).Error; err != nil {
		return fmt.Errorf("failed querying workspaces: %w", err)
	}

	var nodes []models.Node
	if err := e.db.WithContext(ctx).Order("sort_order ASC, created_at ASC").Find(&nodes).Error; err != nil {
		return fmt.Errorf("failed querying nodes: %w", err)
	}

	e.signalsMu.RLock()
	signalsCopy := make(map[string]any, len(e.signals))
	for k, v := range e.signals {
		signalsCopy[k] = v
	}
	e.signalsMu.RUnlock()

	payload := BootstrapPayload{
		Workspaces: workspaces,
		Nodes:      nodes,
		Signals:    signalsCopy,
	}

	rawJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed marshaling bootstrap payload: %w", err)
	}

	hash := sha256.Sum256(rawJSON)
	etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:]))

	var brBuf bytes.Buffer
	brWriter := brotli.NewWriterLevel(&brBuf, 11)
	if _, err := brWriter.Write(rawJSON); err != nil {
		return fmt.Errorf("failed writing brotli stream: %w", err)
	}
	if err := brWriter.Close(); err != nil {
		return fmt.Errorf("failed closing brotli writer: %w", err)
	}

	e.snapshot.Store(&PrecomputedSnapshot{
		ETag:        etag,
		RawJSON:     rawJSON,
		BrotliBytes: brBuf.Bytes(),
	})

	return nil
}

// EmitSignal updates a signal in memory, rebuilds the pre-compressed snapshot, and notifies SSE clients.
func (e *Engine) EmitSignal(ctx context.Context, key string, value any) {
	e.signalsMu.Lock()
	e.signals[key] = value
	e.signalsMu.Unlock()

	_ = e.RebuildSnapshot(ctx)

	deltaBytes, err := json.Marshal(SignalDelta{Key: key, Value: value})
	if err != nil {
		return
	}

	e.clientsMu.RLock()
	for ch := range e.clients {
		select {
		case ch <- deltaBytes:
		default:
		}
	}
	e.clientsMu.RUnlock()
}

// SubscribeSSE registers a new real-time SSE listener channel.
func (e *Engine) SubscribeSSE() (chan []byte, func()) {
	ch := make(chan []byte, 32)
	e.clientsMu.Lock()
	e.clients[ch] = struct{}{}
	e.clientsMu.Unlock()

	unsubscribe := func() {
		e.clientsMu.Lock()
		delete(e.clients, ch)
		close(ch)
		e.clientsMu.Unlock()
	}

	return ch, unsubscribe
}
