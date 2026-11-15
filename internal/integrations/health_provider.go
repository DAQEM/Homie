package integrations

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"homie/internal/models"
	"homie/internal/state"

	"gorm.io/gorm"
)

// NodeHealthSignal is emitted to `node:health:<nodeID>` over SSE for monitored action shortcuts.
type NodeHealthSignal struct {
	Status    string `json:"status"` // "up" | "degraded" | "down"
	Code      int    `json:"code,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error,omitempty"`
}

type actionHealthSettings struct {
	HealthCheck     bool `json:"healthCheck"`
	HealthIgnoreTLS bool `json:"healthIgnoreTLS"`
}

// HealthCheckProvider periodically probes monitored action URLs and emits live status + latency.
type HealthCheckProvider struct {
	db             *gorm.DB
	engine         *state.Engine
	strictClient   *http.Client
	insecureClient *http.Client
	triggerCh      chan struct{}
}

func NewHealthCheckProvider(db *gorm.DB, engine *state.Engine) *HealthCheckProvider {
	return &HealthCheckProvider{
		db:     db,
		engine: engine,
		strictClient: &http.Client{
			Timeout: 4 * time.Second,
		},
		insecureClient: &http.Client{
			Timeout: 4 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
		triggerCh: make(chan struct{}, 1),
	}
}

func (p *HealthCheckProvider) Name() string {
	return "service_health"
}

func (p *HealthCheckProvider) Initialize(ctx context.Context) error {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-p.triggerCh:
				_ = p.Poll(ctx, p.engine)
			}
		}
	}()
	return nil
}

func (p *HealthCheckProvider) TriggerSync() {
	select {
	case p.triggerCh <- struct{}{}:
	default:
	}
}

func (p *HealthCheckProvider) Teardown(_ context.Context) error {
	return nil
}

func (p *HealthCheckProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	var actionNodes []models.Node
	if err := p.db.WithContext(ctx).
		Where("node_type = ? AND url IS NOT NULL AND url <> ''", "action").
		Find(&actionNodes).Error; err != nil {
		return err
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup

	for _, node := range actionNodes {
		var cfg actionHealthSettings
		if len(node.Settings) > 0 {
			_ = json.Unmarshal(node.Settings, &cfg)
		}
		if !cfg.HealthCheck || node.URL == nil {
			continue
		}

		targetURL := strings.TrimSpace(*node.URL)
		if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
			continue
		}

		wg.Add(1)
		go func(n models.Node, u string, ignoreTLS bool) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			sig := p.probeURL(ctx, u, ignoreTLS)
			emitter.EmitSignal(ctx, "node:health:"+n.ID.String(), sig)
		}(node, targetURL, cfg.HealthIgnoreTLS)
	}

	wg.Wait()
	return nil
}

func (p *HealthCheckProvider) probeURL(ctx context.Context, targetURL string, ignoreTLS bool) NodeHealthSignal {
	client := p.strictClient
	if ignoreTLS {
		client = p.insecureClient
	}

	start := time.Now()
	code, err := p.doProbeRequest(ctx, client, http.MethodHead, targetURL)
	if err == nil && (code == http.StatusMethodNotAllowed || code == http.StatusNotImplemented) {
		code, err = p.doProbeRequest(ctx, client, http.MethodGet, targetURL)
	}
	latency := time.Since(start).Milliseconds()

	nowStr := time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		return NodeHealthSignal{
			Status:    "down",
			LatencyMs: latency,
			CheckedAt: nowStr,
			Error:     "Unreachable",
		}
	}

	status := "down"
	switch {
	case (code >= 200 && code < 400) || code == http.StatusUnauthorized:
		// 401 typically indicates a healthy homelab login gate (Authelia/Grafana/Proxmox)
		status = "up"
	case code >= 400 && code < 500:
		status = "degraded"
	default:
		status = "down"
	}

	return NodeHealthSignal{
		Status:    status,
		Code:      code,
		LatencyMs: latency,
		CheckedAt: nowStr,
	}
}

func (p *HealthCheckProvider) doProbeRequest(ctx context.Context, client *http.Client, method, targetURL string) (int, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, method, targetURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "Homie-HealthProbe/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}
