package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"homie/internal/crypto"
	"homie/internal/models"
	"homie/internal/state"

	"gorm.io/gorm"
)

type VikunjaStatusSignal struct {
	Connected     bool   `json:"connected"`
	IntegrationID string `json:"integrationId,omitempty"`
	ServerURL     string `json:"serverUrl,omitempty"`
	FrontendURL   string `json:"frontendUrl,omitempty"`
	Username      string `json:"username,omitempty"`
	UserID        int64  `json:"userId,omitempty"`
	Version       string `json:"version,omitempty"`
	LastSyncedAt  string `json:"lastSyncedAt,omitempty"`
	TaskCount     int    `json:"taskCount"`
	Error         string `json:"error,omitempty"`
}

type VikunjaProvider struct {
	db        *gorm.DB
	engine    *state.Engine
	cipher    *crypto.EnvelopeCipher
	triggerCh chan struct{}

	mu         sync.RWMutex
	tasks      []VikunjaTask
	projects   []VikunjaProject
	labels     []VikunjaLabel
	lastStatus VikunjaStatusSignal
}

func NewVikunjaProvider(db *gorm.DB, engine *state.Engine, cipher *crypto.EnvelopeCipher) *VikunjaProvider {
	return &VikunjaProvider{
		db:        db,
		engine:    engine,
		cipher:    cipher,
		triggerCh: make(chan struct{}, 1),
	}
}

func (p *VikunjaProvider) Name() string { return "vikunja" }

func (p *VikunjaProvider) Initialize(ctx context.Context) error {
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

func (p *VikunjaProvider) TriggerSync() {
	select {
	case p.triggerCh <- struct{}{}:
	default:
	}
}

func (p *VikunjaProvider) Teardown(_ context.Context) error { return nil }

func (p *VikunjaProvider) ClearState(ctx context.Context) {
	p.mu.Lock()
	p.tasks = []VikunjaTask{}
	p.projects = []VikunjaProject{}
	p.labels = []VikunjaLabel{}
	p.lastStatus = VikunjaStatusSignal{Connected: false}
	p.mu.Unlock()

	p.engine.EmitSignal(ctx, "vikunja:status", p.lastStatus)
	p.engine.EmitSignal(ctx, "vikunja:projects", []VikunjaProject{})
	p.engine.EmitSignal(ctx, "vikunja:labels", []VikunjaLabel{})
	p.engine.EmitSignal(ctx, "vikunja:tasks", []VikunjaTask{})
}

func (p *VikunjaProvider) loadActiveClient(ctx context.Context) (*VikunjaClient, VikunjaCredentials, string, error) {
	var row models.Integration
	err := p.db.WithContext(ctx).Where("provider = ?", "vikunja").Order("created_at DESC").First(&row).Error
	if err != nil {
		return nil, VikunjaCredentials{}, "", err
	}

	plain, err := p.cipher.Decrypt(row.Credentials)
	if err != nil {
		return nil, VikunjaCredentials{}, "", fmt.Errorf("failed decrypting Vikunja credentials: %w", err)
	}

	var creds VikunjaCredentials
	if err := json.Unmarshal(plain, &creds); err != nil {
		return nil, VikunjaCredentials{}, "", fmt.Errorf("invalid Vikunja credential payload: %w", err)
	}

	return NewVikunjaClient(creds.ServerURL, creds.APIToken), creds, row.ID.String(), nil
}

func (p *VikunjaProvider) SyncNow(ctx context.Context) VikunjaStatusSignal {
	_ = p.Poll(ctx, p.engine)
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastStatus
}

func (p *VikunjaProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	client, creds, integrationID, err := p.loadActiveClient(ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status := VikunjaStatusSignal{Connected: false}
			p.mu.Lock()
			p.lastStatus = status
			p.tasks = []VikunjaTask{}
			p.projects = []VikunjaProject{}
			p.labels = []VikunjaLabel{}
			p.mu.Unlock()

			emitter.EmitSignal(ctx, "vikunja:status", status)
			emitter.EmitSignal(ctx, "vikunja:projects", []VikunjaProject{})
			emitter.EmitSignal(ctx, "vikunja:labels", []VikunjaLabel{})
			emitter.EmitSignal(ctx, "vikunja:tasks", []VikunjaTask{})
			return nil
		}
		return err
	}

	frontendBase := creds.FrontendURL
	if frontendBase == "" {
		frontendBase = creds.ServerURL
	}

	var (
		wg       sync.WaitGroup
		projects []VikunjaProject
		labels   []VikunjaLabel
		openList []VikunjaTask
		doneList []VikunjaTask
		info     *VikunjaInfo

		projErr, lblErr, openErr error
	)

	wg.Add(5)
	go func() {
		defer wg.Done()
		info, _ = client.Info(ctx)
	}()
	go func() {
		defer wg.Done()
		projects, projErr = client.ListProjects(ctx)
	}()
	go func() {
		defer wg.Done()
		labels, lblErr = client.ListLabels(ctx)
	}()
	go func() {
		defer wg.Done()
		// Fetch up to 250 open tasks across all projects
		openList, openErr = client.ListTasks(ctx, "done = false", 5)
	}()
	go func() {
		defer wg.Done()
		// Fetch latest 50 completed tasks so "Show Completed" toggles instantaneously
		doneList, _ = client.ListTasks(ctx, "done = true", 1)
	}()
	wg.Wait()

	if info != nil && info.FrontendURL != "" {
		frontendBase = strings.TrimRight(info.FrontendURL, "/")
	}

	if openErr != nil || projErr != nil {
		errMsg := ""
		if openErr != nil {
			errMsg = openErr.Error()
		} else if projErr != nil {
			errMsg = projErr.Error()
		}
		slog.Warn("Vikunja poll error", "error", errMsg)
		status := VikunjaStatusSignal{
			Connected:     true,
			IntegrationID: integrationID,
			ServerURL:     creds.ServerURL,
			FrontendURL:   frontendBase,
			Username:      creds.Username,
			UserID:        creds.UserID,
			Error:         errMsg,
		}
		p.mu.Lock()
		p.lastStatus = status
		p.mu.Unlock()
		emitter.EmitSignal(ctx, "vikunja:status", status)
		return fmt.Errorf("%s", errMsg)
	}

	merged := make([]VikunjaTask, 0, len(openList)+len(doneList))
	seen := make(map[int64]bool, len(openList)+len(doneList))
	for _, t := range openList {
		t = normalizeVikunjaTask(t, frontendBase)
		seen[t.ID] = true
		merged = append(merged, t)
	}
	for _, t := range doneList {
		if seen[t.ID] {
			continue
		}
		t = normalizeVikunjaTask(t, frontendBase)
		merged = append(merged, t)
	}

	if projects == nil {
		projects = []VikunjaProject{}
	}
	if labels == nil && lblErr == nil {
		labels = []VikunjaLabel{}
	}

	version := ""
	if info != nil {
		version = info.Version
	}

	status := VikunjaStatusSignal{
		Connected:     true,
		IntegrationID: integrationID,
		ServerURL:     creds.ServerURL,
		FrontendURL:   frontendBase,
		Username:      creds.Username,
		UserID:        creds.UserID,
		Version:       version,
		LastSyncedAt:  time.Now().UTC().Format(time.RFC3339),
		TaskCount:     len(openList),
	}

	p.mu.Lock()
	p.tasks = merged
	p.projects = projects
	if labels != nil {
		p.labels = labels
	}
	p.lastStatus = status
	p.mu.Unlock()

	emitter.EmitSignal(ctx, "vikunja:projects", projects)
	if labels != nil {
		emitter.EmitSignal(ctx, "vikunja:labels", labels)
	}
	emitter.EmitSignal(ctx, "vikunja:tasks", merged)
	emitter.EmitSignal(ctx, "vikunja:status", status)
	return nil
}

// =========================================================================
// Fast Write-Through Mutations (Execute on Vikunja + Immediately Emit SSE)
// =========================================================================

func (p *VikunjaProvider) CreateTask(ctx context.Context, projectID int64, body VikunjaTaskCreate, labelIDs []int64) (*VikunjaTask, error) {
	client, creds, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}

	created, err := client.CreateTask(ctx, projectID, body)
	if err != nil {
		return nil, err
	}

	for _, lid := range labelIDs {
		_ = client.AddTaskLabel(ctx, created.ID, lid)
	}
	if len(labelIDs) > 0 {
		if refreshed, err := client.GetTask(ctx, created.ID); err == nil {
			created = refreshed
		}
	}

	frontend := creds.FrontendURL
	if frontend == "" {
		frontend = creds.ServerURL
	}
	norm := normalizeVikunjaTask(*created, frontend)

	p.mu.Lock()
	p.tasks = append([]VikunjaTask{norm}, p.tasks...)
	p.lastStatus.TaskCount++
	tasksSnap := append([]VikunjaTask(nil), p.tasks...)
	statusSnap := p.lastStatus
	p.mu.Unlock()

	p.engine.EmitSignal(ctx, "vikunja:tasks", tasksSnap)
	p.engine.EmitSignal(ctx, "vikunja:status", statusSnap)
	return &norm, nil
}

func (p *VikunjaProvider) PatchTask(ctx context.Context, taskID int64, patch VikunjaTaskPatch) (*VikunjaTask, error) {
	client, creds, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}

	updated, err := client.PatchTask(ctx, taskID, patch)
	if err != nil {
		return nil, err
	}

	// Re-fetch full task so labels/assignees/project stay complete
	if full, err := client.GetTask(ctx, taskID); err == nil {
		updated = full
	}

	frontend := creds.FrontendURL
	if frontend == "" {
		frontend = creds.ServerURL
	}
	norm := normalizeVikunjaTask(*updated, frontend)

	p.upsertCachedTask(ctx, norm)
	return &norm, nil
}

func (p *VikunjaProvider) DeleteTask(ctx context.Context, taskID int64) error {
	client, _, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return fmt.Errorf("vikunja integration not connected")
	}
	if err := client.DeleteTask(ctx, taskID); err != nil {
		return err
	}

	p.mu.Lock()
	filtered := make([]VikunjaTask, 0, len(p.tasks))
	openCount := 0
	for _, t := range p.tasks {
		if t.ID == taskID {
			continue
		}
		if !t.Done {
			openCount++
		}
		filtered = append(filtered, t)
	}
	p.tasks = filtered
	p.lastStatus.TaskCount = openCount
	tasksSnap := append([]VikunjaTask(nil), p.tasks...)
	statusSnap := p.lastStatus
	p.mu.Unlock()

	p.engine.EmitSignal(ctx, "vikunja:tasks", tasksSnap)
	p.engine.EmitSignal(ctx, "vikunja:status", statusSnap)
	return nil
}

func (p *VikunjaProvider) SetTaskLabel(ctx context.Context, taskID, labelID int64, attach bool) (*VikunjaTask, error) {
	client, creds, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}
	if attach {
		if err := client.AddTaskLabel(ctx, taskID, labelID); err != nil {
			return nil, err
		}
	} else {
		if err := client.RemoveTaskLabel(ctx, taskID, labelID); err != nil {
			return nil, err
		}
	}

	full, err := client.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	frontend := creds.FrontendURL
	if frontend == "" {
		frontend = creds.ServerURL
	}
	norm := normalizeVikunjaTask(*full, frontend)
	p.upsertCachedTask(ctx, norm)
	return &norm, nil
}

func (p *VikunjaProvider) ListTaskComments(ctx context.Context, taskID int64) ([]VikunjaComment, error) {
	client, _, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}
	return client.ListTaskComments(ctx, taskID)
}

func (p *VikunjaProvider) AddTaskComment(ctx context.Context, taskID int64, comment string) (*VikunjaComment, error) {
	client, _, _, err := p.loadActiveClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}
	return client.AddTaskComment(ctx, taskID, comment)
}

func (p *VikunjaProvider) upsertCachedTask(ctx context.Context, norm VikunjaTask) {
	p.mu.Lock()
	replaced := false
	openCount := 0
	for i := range p.tasks {
		if p.tasks[i].ID == norm.ID {
			p.tasks[i] = norm
			replaced = true
		}
		if !p.tasks[i].Done {
			openCount++
		}
	}
	if !replaced {
		p.tasks = append([]VikunjaTask{norm}, p.tasks...)
		if !norm.Done {
			openCount++
		}
	}
	p.lastStatus.TaskCount = openCount
	tasksSnap := append([]VikunjaTask(nil), p.tasks...)
	statusSnap := p.lastStatus
	p.mu.Unlock()

	p.engine.EmitSignal(ctx, "vikunja:tasks", tasksSnap)
	p.engine.EmitSignal(ctx, "vikunja:status", statusSnap)
}
