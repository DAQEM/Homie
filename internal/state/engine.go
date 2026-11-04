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

// Engine manages the lock-free structural snapshot, in-memory signal bus, and SSE subscribers.
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

// RebuildSnapshot queries PostgreSQL via GORM, pre-compresses the structural state
// with Brotli Quality 11, computes the SHA-256 ETag, and swaps the pointer atomically.
// Invoked only on startup and structural CRUD mutations.
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

	// Compute structural ETag strictly from Workspaces + Nodes so ephemeral 5s signal ticks
	// never invalidate the client's 304 Not Modified structural cache.
	structuralBytes, err := json.Marshal(struct {
		Workspaces []models.Workspace `json:"workspaces"`
		Nodes      []models.Node      `json:"nodes"`
	}{
		Workspaces: workspaces,
		Nodes:      nodes,
	})
	if err != nil {
		return fmt.Errorf("failed marshaling structural state: %w", err)
	}
	hash := sha256.Sum256(structuralBytes)
	etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:16]))

	payload := BootstrapPayload{
		Workspaces: workspaces,
		Nodes:      nodes,
		Signals:    signalsCopy,
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

	e.snapshot.Store(&PrecomputedSnapshot{
		ETag:        etag,
		RawJSON:     rawJSON,
		BrotliBytes: brBuf.Bytes(),
	})

	return nil
}

// EmitSignal updates a volatile signal in memory and broadcasts it to SSE subscribers
// in microseconds with zero database queries and zero Brotli re-compression.
func (e *Engine) EmitSignal(_ context.Context, key string, value any) {
	e.signalsMu.Lock()
	e.signals[key] = value
	e.signalsMu.Unlock()

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

// CurrentSignalDeltas returns serialized SSE payloads for all active signals so
// newly connected clients hydrate live signals immediately.
func (e *Engine) CurrentSignalDeltas() [][]byte {
	e.signalsMu.RLock()
	defer e.signalsMu.RUnlock()

	out := make([][]byte, 0, len(e.signals))
	for k, v := range e.signals {
		if b, err := json.Marshal(SignalDelta{Key: k, Value: v}); err == nil {
			out = append(out, b)
		}
	}
	return out
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
