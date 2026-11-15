package integrations

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"homie/internal/state"

	"github.com/google/uuid"
)

// SignalEmitter decouples integration providers from the underlying state engine.
type SignalEmitter interface {
	EmitGlobalSignal(ctx context.Context, key string, value any)
	EmitUserSignal(ctx context.Context, userID uuid.UUID, key string, value any)
}

// IntegrationProvider defines the lifecycle contract for all external data producers.
type IntegrationProvider interface {
	Name() string
	Initialize(ctx context.Context) error
	Poll(ctx context.Context, emitter SignalEmitter) error
	Teardown(ctx context.Context) error
}

// SpawnSupervised runs an IntegrationProvider in an isolated background goroutine
// with panic recovery.
func SpawnSupervised(ctx context.Context, provider IntegrationProvider, engine *state.Engine, interval time.Duration) {
	go func() {
		slog.Info("Starting supervised integration worker", "provider", provider.Name())

		if err := provider.Initialize(ctx); err != nil {
			slog.Error("Integration initialization failed", "provider", provider.Name(), "error", err)
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		runPoll := func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("Recovered from panic in integration worker", "provider", provider.Name(), "panic", r)
				}
			}()
			if err := provider.Poll(ctx, engine); err != nil {
				slog.Warn("Integration poll error", "provider", provider.Name(), "error", err)
			}
		}

		runPoll()

		for {
			select {
			case <-ctx.Done():
				_ = provider.Teardown(context.Background())
				return
			case <-ticker.C:
				runPoll()
			}
		}
	}()
}

// HelloWorldProvider is a built-in demonstration provider emitting global system signals.
type HelloWorldProvider struct {
	startedAt time.Time
}

func NewHelloWorldProvider() *HelloWorldProvider {
	return &HelloWorldProvider{startedAt: time.Now()}
}

func (p *HelloWorldProvider) Name() string {
	return "system_hello"
}

func (p *HelloWorldProvider) Initialize(_ context.Context) error {
	return nil
}

func (p *HelloWorldProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	now := time.Now().UTC().Format("15:04:05 UTC")
	uptime := time.Since(p.startedAt).Round(time.Second).String()

	emitter.EmitGlobalSignal(ctx, "system:hello:greeting", fmt.Sprintf("Go Signal Bus Online • %s", now))
	emitter.EmitGlobalSignal(ctx, "system:hello:uptime", fmt.Sprintf("Up %s", uptime))
	return nil
}

func (p *HelloWorldProvider) Teardown(_ context.Context) error {
	return nil
}
