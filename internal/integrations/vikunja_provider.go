package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"homie/internal/crypto"
	"homie/internal/models"
	"homie/internal/state"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type VikunjaStatusSignal struct {
	Connected     bool   `json:"connected"`
	IntegrationID string `json:"integrationId,omitempty"`
	Label         string `json:"label,omitempty"`
	ServerURL     string `json:"serverUrl,omitempty"`
	FrontendURL   string `json:"frontendUrl,omitempty"`
	Username      string `json:"username,omitempty"`
	UserID        int64  `json:"userId,omitempty"`
	Version       string `json:"version,omitempty"`
	LastSyncedAt  string `json:"lastSyncedAt,omitempty"`
	TaskCount     int    `json:"taskCount"`
	Error         string `json:"error,omitempty"`
}

type VikunjaAccountSignal struct {
	Connected     bool             `json:"connected"`
	IntegrationID string           `json:"integrationId,omitempty"`
	Label         string           `json:"label,omitempty"`
	ServerURL     string           `json:"serverUrl,omitempty"`
	FrontendURL   string           `json:"frontendUrl,omitempty"`
	Username      string           `json:"username,omitempty"`
	UserID        int64            `json:"userId,omitempty"`
	Version       string           `json:"version,omitempty"`
	LastSyncedAt  string           `json:"lastSyncedAt,omitempty"`
	TaskCount     int              `json:"taskCount"`
	Error         string           `json:"error,omitempty"`
	Projects      []VikunjaProject `json:"projects"`
	Labels        []VikunjaLabel   `json:"labels"`
	Tasks         []VikunjaTask    `json:"tasks"`
}

type vikunjaAccountState struct {
	ownerID  uuid.UUID
	status   VikunjaStatusSignal
	projects []VikunjaProject
	labels   []VikunjaLabel
	tasks    []VikunjaTask
}

func (a *vikunjaAccountState) toSignal() VikunjaAccountSignal {
	projects := a.projects
	if projects == nil {
		projects = []VikunjaProject{}
	}
	labels := a.labels
	if labels == nil {
		labels = []VikunjaLabel{}
	}
	tasks := a.tasks
	if tasks == nil {
		tasks = []VikunjaTask{}
	}
	return VikunjaAccountSignal{
		Connected:     a.status.Connected,
		IntegrationID: a.status.IntegrationID,
		Label:         a.status.Label,
		ServerURL:     a.status.ServerURL,
		FrontendURL:   a.status.FrontendURL,
		Username:      a.status.Username,
		UserID:        a.status.UserID,
		Version:       a.status.Version,
		LastSyncedAt:  a.status.LastSyncedAt,
		TaskCount:     a.status.TaskCount,
		Error:         a.status.Error,
		Projects:      append([]VikunjaProject(nil), projects...),
		Labels:        append([]VikunjaLabel(nil), labels...),
		Tasks:         append([]VikunjaTask(nil), tasks...),
	}
}

type userVikunjaBucket struct {
	accounts map[string]*vikunjaAccountState
	order    []string
}

type VikunjaProvider struct {
	db        *gorm.DB
	engine    *state.Engine
	cipher    *crypto.EnvelopeCipher
	triggerCh chan struct{}

	mu    sync.RWMutex
	users map[uuid.UUID]*userVikunjaBucket
}

func NewVikunjaProvider(db *gorm.DB, engine *state.Engine, cipher *crypto.EnvelopeCipher) *VikunjaProvider {
	return &VikunjaProvider{
		db:        db,
		engine:    engine,
		cipher:    cipher,
		triggerCh: make(chan struct{}, 1),
		users:     make(map[uuid.UUID]*userVikunjaBucket),
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

func (p *VikunjaProvider) decryptRow(row models.Integration) (VikunjaCredentials, error) {
	plain, err := p.cipher.Decrypt(row.Credentials)
	if err != nil {
		return VikunjaCredentials{}, fmt.Errorf("failed decrypting Vikunja credentials: %w", err)
	}

	var creds VikunjaCredentials
	if err := json.Unmarshal(plain, &creds); err != nil {
		return VikunjaCredentials{}, fmt.Errorf("invalid Vikunja credential payload: %w", err)
	}

	if creds.Label == "" && len(row.Settings) > 0 {
		var meta struct {
			Label string `json:"label"`
		}
		if err := json.Unmarshal(row.Settings, &meta); err == nil {
			creds.Label = meta.Label
		}
	}
	return creds, nil
}

func (p *VikunjaProvider) loadClientByID(ctx context.Context, userID uuid.UUID, integrationID string, taskIDHint int64) (*VikunjaClient, VikunjaCredentials, string, error) {
	id := strings.TrimSpace(integrationID)
	if id == "" && taskIDHint > 0 {
		p.mu.RLock()
		if bucket, ok := p.users[userID]; ok {
			for _, acctID := range bucket.order {
				if acct, exists := bucket.accounts[acctID]; exists {
					for _, t := range acct.tasks {
						if t.ID == taskIDHint {
							id = acctID
							break
						}
					}
				}
				if id != "" {
					break
				}
			}
		}
		p.mu.RUnlock()
	}

	var row models.Integration
	var err error
	if id != "" {
		err = p.db.WithContext(ctx).
			Where("id = ? AND user_id = ? AND provider = ?", id, userID, "vikunja").
			First(&row).Error
	} else {
		err = p.db.WithContext(ctx).
			Where("user_id = ? AND provider = ?", userID, "vikunja").
			Order("created_at ASC").
			First(&row).Error
	}
	if err != nil {
		return nil, VikunjaCredentials{}, "", err
	}

	creds, err := p.decryptRow(row)
	if err != nil {
		return nil, VikunjaCredentials{}, "", err
	}

	return NewVikunjaClient(creds.ServerURL, creds.APIToken), creds, row.ID.String(), nil
}

func (p *VikunjaProvider) SyncNow(ctx context.Context, userID uuid.UUID, integrationID string) VikunjaAccountSignal {
	p.pollUserRows(ctx, userID, p.engine)

	p.mu.RLock()
	defer p.mu.RUnlock()

	bucket, ok := p.users[userID]
	if ok {
		if integrationID != "" {
			if acct, exists := bucket.accounts[integrationID]; exists {
				return acct.toSignal()
			}
		}
		if len(bucket.order) > 0 {
			if acct, exists := bucket.accounts[bucket.order[0]]; exists {
				return acct.toSignal()
			}
		}
	}

	return VikunjaAccountSignal{
		Connected: false,
		Projects:  []VikunjaProject{},
		Labels:    []VikunjaLabel{},
		Tasks:     []VikunjaTask{},
	}
}

func (p *VikunjaProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	var rows []models.Integration
	if err := p.db.WithContext(ctx).
		Where("provider = ?", "vikunja").
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return err
	}

	byUser := make(map[uuid.UUID][]models.Integration)
	for _, r := range rows {
		byUser[r.UserID] = append(byUser[r.UserID], r)
	}

	p.mu.RLock()
	staleUsers := make([]uuid.UUID, 0)
	for uid := range p.users {
		if _, active := byUser[uid]; !active {
			staleUsers = append(staleUsers, uid)
		}
	}
	p.mu.RUnlock()

	for _, uid := range staleUsers {
		p.mu.Lock()
		delete(p.users, uid)
		p.mu.Unlock()
		p.emitForUser(ctx, emitter, uid, nil)
	}

	var wg sync.WaitGroup
	for uid, userRows := range byUser {
		wg.Add(1)
		go func(u uuid.UUID, list []models.Integration) {
			defer wg.Done()
			p.pollUserIntegrationList(ctx, u, list, emitter)
		}(uid, userRows)
	}
	wg.Wait()
	return nil
}

func (p *VikunjaProvider) pollUserRows(ctx context.Context, userID uuid.UUID, emitter SignalEmitter) {
	var rows []models.Integration
	if err := p.db.WithContext(ctx).
		Where("user_id = ? AND provider = ?", userID, "vikunja").
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		return
	}
	p.pollUserIntegrationList(ctx, userID, rows, emitter)
}

func (p *VikunjaProvider) pollUserIntegrationList(ctx context.Context, userID uuid.UUID, rows []models.Integration, emitter SignalEmitter) {
	if len(rows) == 0 {
		p.mu.Lock()
		delete(p.users, userID)
		p.mu.Unlock()
		p.emitForUser(ctx, emitter, userID, nil)
		return
	}

	p.mu.RLock()
	var prevMap map[string]*vikunjaAccountState
	if bucket, ok := p.users[userID]; ok {
		prevMap = make(map[string]*vikunjaAccountState, len(bucket.accounts))
		for k, v := range bucket.accounts {
			prevMap[k] = v
		}
	}
	p.mu.RUnlock()

	results := make([]*vikunjaAccountState, len(rows))
	var pollWG sync.WaitGroup

	for idx, row := range rows {
		pollWG.Add(1)
		go func(i int, r models.Integration) {
			defer pollWG.Done()
			var prev *vikunjaAccountState
			if prevMap != nil {
				prev = prevMap[r.ID.String()]
			}
			results[i] = p.pollSingleIntegration(ctx, r, prev)
		}(idx, row)
	}
	pollWG.Wait()

	newBucket := &userVikunjaBucket{
		accounts: make(map[string]*vikunjaAccountState, len(rows)),
		order:    make([]string, 0, len(rows)),
	}
	signals := make([]VikunjaAccountSignal, 0, len(rows))

	for _, st := range results {
		if st == nil {
			continue
		}
		id := st.status.IntegrationID
		newBucket.accounts[id] = st
		newBucket.order = append(newBucket.order, id)
		signals = append(signals, st.toSignal())
	}

	p.mu.Lock()
	p.users[userID] = newBucket
	p.mu.Unlock()

	p.emitForUser(ctx, emitter, userID, signals)
}

func (p *VikunjaProvider) pollSingleIntegration(
	ctx context.Context,
	row models.Integration,
	prev *vikunjaAccountState,
) *vikunjaAccountState {
	idStr := row.ID.String()
	creds, err := p.decryptRow(row)
	if err != nil {
		slog.Warn("Failed decrypting Vikunja integration", "integration_id", idStr, "error", err)
		return &vikunjaAccountState{
			ownerID: row.UserID,
			status: VikunjaStatusSignal{
				Connected:     true,
				IntegrationID: idStr,
				Error:         err.Error(),
			},
			projects: []VikunjaProject{},
			labels:   []VikunjaLabel{},
			tasks:    []VikunjaTask{},
		}
	}

	client := NewVikunjaClient(creds.ServerURL, creds.APIToken)
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
		openList, openErr = client.ListTasks(ctx, "done = false", 5)
	}()
	go func() {
		defer wg.Done()
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
		slog.Warn("Vikunja poll error", "integration_id", idStr, "error", errMsg)

		out := &vikunjaAccountState{
			ownerID: row.UserID,
			status: VikunjaStatusSignal{
				Connected:     true,
				IntegrationID: idStr,
				Label:         creds.Label,
				ServerURL:     creds.ServerURL,
				FrontendURL:   frontendBase,
				Username:      creds.Username,
				UserID:        creds.UserID,
				Error:         errMsg,
			},
			projects: []VikunjaProject{},
			labels:   []VikunjaLabel{},
			tasks:    []VikunjaTask{},
		}
		if prev != nil {
			out.projects = prev.projects
			out.labels = prev.labels
			out.tasks = prev.tasks
			out.status.TaskCount = prev.status.TaskCount
			out.status.LastSyncedAt = prev.status.LastSyncedAt
		}
		return out
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
	if labels == nil {
		if lblErr != nil && prev != nil {
			labels = prev.labels
		} else {
			labels = []VikunjaLabel{}
		}
	}

	version := ""
	if info != nil {
		version = info.Version
	}

	return &vikunjaAccountState{
		ownerID: row.UserID,
		status: VikunjaStatusSignal{
			Connected:     true,
			IntegrationID: idStr,
			Label:         creds.Label,
			ServerURL:     creds.ServerURL,
			FrontendURL:   frontendBase,
			Username:      creds.Username,
			UserID:        creds.UserID,
			Version:       version,
			LastSyncedAt:  time.Now().UTC().Format(time.RFC3339),
			TaskCount:     len(openList),
		},
		projects: projects,
		labels:   labels,
		tasks:    merged,
	}
}

func (p *VikunjaProvider) snapshotSignalsForUserLocked(userID uuid.UUID) []VikunjaAccountSignal {
	bucket, ok := p.users[userID]
	if !ok {
		return []VikunjaAccountSignal{}
	}
	out := make([]VikunjaAccountSignal, 0, len(bucket.order))
	for _, id := range bucket.order {
		if acct, exists := bucket.accounts[id]; exists {
			out = append(out, acct.toSignal())
		}
	}
	return out
}

func (p *VikunjaProvider) emitForUser(ctx context.Context, emitter SignalEmitter, userID uuid.UUID, signals []VikunjaAccountSignal) {
	if signals == nil {
		signals = []VikunjaAccountSignal{}
	}
	emitter.EmitUserSignal(ctx, userID, "vikunja:accounts", signals)

	if len(signals) == 0 {
		emitter.EmitUserSignal(ctx, userID, "vikunja:status", VikunjaStatusSignal{Connected: false})
		emitter.EmitUserSignal(ctx, userID, "vikunja:projects", []VikunjaProject{})
		emitter.EmitUserSignal(ctx, userID, "vikunja:labels", []VikunjaLabel{})
		emitter.EmitUserSignal(ctx, userID, "vikunja:tasks", []VikunjaTask{})
		return
	}

	primary := signals[0]
	emitter.EmitUserSignal(ctx, userID, "vikunja:projects", primary.Projects)
	emitter.EmitUserSignal(ctx, userID, "vikunja:labels", primary.Labels)
	emitter.EmitUserSignal(ctx, userID, "vikunja:tasks", primary.Tasks)
	emitter.EmitUserSignal(ctx, userID, "vikunja:status", VikunjaStatusSignal{
		Connected:     primary.Connected,
		IntegrationID: primary.IntegrationID,
		Label:         primary.Label,
		ServerURL:     primary.ServerURL,
		FrontendURL:   primary.FrontendURL,
		Username:      primary.Username,
		UserID:        primary.UserID,
		Version:       primary.Version,
		LastSyncedAt:  primary.LastSyncedAt,
		TaskCount:     primary.TaskCount,
		Error:         primary.Error,
	})
}

func (p *VikunjaProvider) CreateTask(
	ctx context.Context,
	userID uuid.UUID,
	integrationID string,
	projectID int64,
	body VikunjaTaskCreate,
	labelIDs []int64,
) (*VikunjaTask, error) {
	client, creds, resolvedID, err := p.loadClientByID(ctx, userID, integrationID, 0)
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

	p.upsertCachedTask(ctx, userID, resolvedID, creds, norm)
	return &norm, nil
}

func (p *VikunjaProvider) PatchTask(ctx context.Context, userID uuid.UUID, integrationID string, taskID int64, patch VikunjaTaskPatch) (*VikunjaTask, error) {
	client, creds, resolvedID, err := p.loadClientByID(ctx, userID, integrationID, taskID)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}

	updated, err := client.PatchTask(ctx, taskID, patch)
	if err != nil {
		return nil, err
	}

	if full, err := client.GetTask(ctx, taskID); err == nil {
		updated = full
	}

	frontend := creds.FrontendURL
	if frontend == "" {
		frontend = creds.ServerURL
	}
	norm := normalizeVikunjaTask(*updated, frontend)

	p.upsertCachedTask(ctx, userID, resolvedID, creds, norm)
	return &norm, nil
}

func (p *VikunjaProvider) DeleteTask(ctx context.Context, userID uuid.UUID, integrationID string, taskID int64) error {
	client, _, resolvedID, err := p.loadClientByID(ctx, userID, integrationID, taskID)
	if err != nil {
		return fmt.Errorf("vikunja integration not connected")
	}
	if err := client.DeleteTask(ctx, taskID); err != nil {
		return err
	}

	p.mu.Lock()
	if bucket, ok := p.users[userID]; ok {
		if acct, exists := bucket.accounts[resolvedID]; exists {
			filtered := make([]VikunjaTask, 0, len(acct.tasks))
			openCount := 0
			for _, t := range acct.tasks {
				if t.ID == taskID {
					continue
				}
				if !t.Done {
					openCount++
				}
				filtered = append(filtered, t)
			}
			acct.tasks = filtered
			acct.status.TaskCount = openCount
		}
	}
	signals := p.snapshotSignalsForUserLocked(userID)
	p.mu.Unlock()

	p.emitForUser(ctx, p.engine, userID, signals)
	return nil
}

func (p *VikunjaProvider) SetTaskLabel(ctx context.Context, userID uuid.UUID, integrationID string, taskID, labelID int64, attach bool) (*VikunjaTask, error) {
	client, creds, resolvedID, err := p.loadClientByID(ctx, userID, integrationID, taskID)
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
	p.upsertCachedTask(ctx, userID, resolvedID, creds, norm)
	return &norm, nil
}

func (p *VikunjaProvider) ListTaskComments(ctx context.Context, userID uuid.UUID, integrationID string, taskID int64) ([]VikunjaComment, error) {
	client, _, _, err := p.loadClientByID(ctx, userID, integrationID, taskID)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}
	return client.ListTaskComments(ctx, taskID)
}

func (p *VikunjaProvider) AddTaskComment(ctx context.Context, userID uuid.UUID, integrationID string, taskID int64, comment string) (*VikunjaComment, error) {
	client, _, _, err := p.loadClientByID(ctx, userID, integrationID, taskID)
	if err != nil {
		return nil, fmt.Errorf("vikunja integration not connected")
	}
	return client.AddTaskComment(ctx, taskID, comment)
}

func (p *VikunjaProvider) upsertCachedTask(ctx context.Context, userID uuid.UUID, integrationID string, creds VikunjaCredentials, norm VikunjaTask) {
	p.mu.Lock()
	bucket, ok := p.users[userID]
	if !ok {
		bucket = &userVikunjaBucket{
			accounts: make(map[string]*vikunjaAccountState),
		}
		p.users[userID] = bucket
	}
	acct, exists := bucket.accounts[integrationID]
	if !exists {
		acct = &vikunjaAccountState{
			ownerID: userID,
			status: VikunjaStatusSignal{
				Connected:     true,
				IntegrationID: integrationID,
				Label:         creds.Label,
				ServerURL:     creds.ServerURL,
				FrontendURL:   creds.FrontendURL,
				Username:      creds.Username,
				UserID:        creds.UserID,
			},
			projects: []VikunjaProject{},
			labels:   []VikunjaLabel{},
			tasks:    []VikunjaTask{},
		}
		bucket.accounts[integrationID] = acct
		bucket.order = append(bucket.order, integrationID)
	}

	replaced := false
	openCount := 0
	for i := range acct.tasks {
		if acct.tasks[i].ID == norm.ID {
			acct.tasks[i] = norm
			replaced = true
		}
		if !acct.tasks[i].Done {
			openCount++
		}
	}
	if !replaced {
		acct.tasks = append([]VikunjaTask{norm}, acct.tasks...)
		if !norm.Done {
			openCount++
		}
	}
	acct.status.TaskCount = openCount
	signals := p.snapshotSignalsForUserLocked(userID)
	p.mu.Unlock()

	p.emitForUser(ctx, p.engine, userID, signals)
}
