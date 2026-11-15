package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	vikunjaAPIBasePath  = "/api/v2"
	vikunjaMaxBodyBytes = 16 * 1024 * 1024
	vikunjaZeroDate     = "0001-01-01T00:00:00Z"
)

var vikunjaFarFuture = time.Date(9999, time.December, 31, 0, 0, 0, 0, time.UTC)

type VikunjaCredentials struct {
	ServerURL   string `json:"server_url"`
	FrontendURL string `json:"frontend_url,omitempty"`
	APIToken    string `json:"api_token"`
	Username    string `json:"username,omitempty"`
	UserID      int64  `json:"user_id,omitempty"`
}

type VikunjaInfo struct {
	Version     string `json:"version"`
	FrontendURL string `json:"frontend_url"`
}

type VikunjaUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name,omitempty"`
	Email    string `json:"email,omitempty"`
}

type VikunjaProject struct {
	ID              int64  `json:"id"`
	Title           string `json:"title"`
	Description     string `json:"description,omitempty"`
	Identifier      string `json:"identifier,omitempty"`
	HexColor        string `json:"hex_color,omitempty"`
	IsArchived      bool   `json:"is_archived,omitempty"`
	IsFavorite      bool   `json:"is_favorite,omitempty"`
	ParentProjectID int64  `json:"parent_project_id,omitempty"`
}

type VikunjaLabel struct {
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	HexColor string `json:"hex_color,omitempty"`
}

type VikunjaTask struct {
	ID          int64          `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Done        bool           `json:"done"`
	DoneAt      string         `json:"done_at,omitempty"`
	Priority    int64          `json:"priority"`
	ProjectID   int64          `json:"project_id"`
	Index       int64          `json:"index"`
	Identifier  string         `json:"identifier,omitempty"`
	HexColor    string         `json:"hex_color,omitempty"`
	IsFavorite  bool           `json:"is_favorite"`
	DueDate     string         `json:"due_date,omitempty"`
	StartDate   string         `json:"start_date,omitempty"`
	EndDate     string         `json:"end_date,omitempty"`
	PercentDone float64        `json:"percent_done"`
	Labels      []VikunjaLabel `json:"labels,omitempty"`
	Assignees   []VikunjaUser  `json:"assignees,omitempty"`
	Created     string         `json:"created,omitempty"`
	Updated     string         `json:"updated,omitempty"`
	URL         string         `json:"url,omitempty"`
}

type VikunjaTaskCreate struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Priority    int64  `json:"priority,omitempty"`
	DueDate     string `json:"due_date,omitempty"`
	IsFavorite  bool   `json:"is_favorite,omitempty"`
}

// VikunjaTaskPatch uses pointer fields so application/merge-patch+json only touches modified columns.
type VikunjaTaskPatch struct {
	Title       *string  `json:"title,omitempty"`
	Description *string  `json:"description,omitempty"`
	Done        *bool    `json:"done,omitempty"`
	Priority    *int64   `json:"priority,omitempty"`
	DueDate     *string  `json:"due_date,omitempty"`
	IsFavorite  *bool    `json:"is_favorite,omitempty"`
	PercentDone *float64 `json:"percent_done,omitempty"`
	ProjectID   *int64   `json:"project_id,omitempty"`
}

type VikunjaComment struct {
	ID      int64        `json:"id"`
	Comment string       `json:"comment"`
	Author  *VikunjaUser `json:"author,omitempty"`
	Created string       `json:"created,omitempty"`
	Updated string       `json:"updated,omitempty"`
}

type vikunjaPaginated[T any] struct {
	Items      []T   `json:"items"`
	Total      int64 `json:"total"`
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	TotalPages int   `json:"total_pages"`
}

type VikunjaClient struct {
	BaseURL    string
	Token      string
	httpClient *http.Client
}

func NewVikunjaClient(baseURL, token string) *VikunjaClient {
	return &VikunjaClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// DiscoverVikunjaServer normalizes a user-provided URL and probes /api/v2/info.
func DiscoverVikunjaServer(ctx context.Context, rawInput string) (string, *VikunjaInfo, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return "", nil, fmt.Errorf("server URL is required")
	}
	trimmed = strings.TrimRight(trimmed, "/")
	trimmed = strings.TrimSuffix(trimmed, "/api/v1")
	trimmed = strings.TrimSuffix(trimmed, "/api/v2")
	trimmed = strings.TrimRight(trimmed, "/")

	typedScheme := strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://")
	if !typedScheme {
		trimmed = "https://" + trimmed
	}

	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return "", nil, fmt.Errorf("invalid Vikunja server URL")
	}

	schemes := []string{u.Scheme}
	if !typedScheme && isLoopbackHost(u.Hostname()) {
		schemes = []string{"http", "https"}
	}

	hosts := []string{u.Host}
	if u.Port() == "" && isLoopbackHost(u.Hostname()) {
		hosts = append(hosts, net.JoinHostPort(u.Hostname(), "3456"))
	}

	var lastErr error
	for _, scheme := range schemes {
		for _, host := range hosts {
			base := strings.TrimRight(scheme+"://"+host+strings.TrimRight(u.Path, "/"), "/")
			c := NewVikunjaClient(base, "")
			info, err := c.Info(ctx)
			if err == nil && info != nil {
				return base, info, nil
			}
			lastErr = err
		}
	}
	return "", nil, fmt.Errorf("could not reach Vikunja /api/v2/info: %w", lastErr)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (c *VikunjaClient) do(ctx context.Context, method, path string, query url.Values, body, out any, contentType string) error {
	full := c.BaseURL + vikunjaAPIBasePath + path
	if len(query) > 0 {
		full += "?" + query.Encode()
	}

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, full, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Homie-Vikunja/1.0")
	if body != nil {
		if contentType == "" {
			contentType = "application/json"
		}
		req.Header.Set("Content-Type", contentType)
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, vikunjaMaxBodyBytes))
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		var problem struct {
			Detail  string `json:"detail"`
			Title   string `json:"title"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(respBytes, &problem)
		msg := strings.TrimSpace(problem.Detail)
		if msg == "" {
			msg = strings.TrimSpace(problem.Message)
		}
		if msg == "" {
			msg = strings.TrimSpace(problem.Title)
		}
		if msg == "" {
			msg = http.StatusText(resp.StatusCode)
		}
		return fmt.Errorf("vikunja %s %s returned HTTP %d: %s", method, path, resp.StatusCode, msg)
	}

	if out != nil && len(respBytes) > 0 {
		return json.Unmarshal(respBytes, out)
	}
	return nil
}

func (c *VikunjaClient) Info(ctx context.Context) (*VikunjaInfo, error) {
	var out VikunjaInfo
	if err := c.do(ctx, http.MethodGet, "/info", nil, nil, &out, ""); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *VikunjaClient) Login(ctx context.Context, username, password, totp string) (string, error) {
	var resp struct {
		Token string `json:"token"`
	}
	payload := map[string]any{
		"username":      username,
		"password":      password,
		"totp_passcode": totp,
		"long_token":    false,
	}
	if err := c.do(ctx, http.MethodPost, "/login", nil, payload, &resp, "application/json"); err != nil {
		return "", err
	}
	if resp.Token == "" {
		return "", fmt.Errorf("vikunja login returned empty token")
	}
	return resp.Token, nil
}

func (c *VikunjaClient) CurrentUser(ctx context.Context) (*VikunjaUser, error) {
	var out VikunjaUser
	if err := c.do(ctx, http.MethodGet, "/user", nil, nil, &out, ""); err != nil {
		return nil, err
	}
	return &out, nil
}

// MintScopedAPIToken creates a long-lived scoped token via /routes + /tokens.
func (c *VikunjaClient) MintScopedAPIToken(ctx context.Context, title string) (string, error) {
	routes := map[string]map[string]any{}
	if err := c.do(ctx, http.MethodGet, "/routes", nil, nil, &routes, ""); err != nil {
		return "", err
	}

	wanted := map[string][]string{
		"tasks":           {"read_one", "read_all", "create", "update", "delete"},
		"projects":        {"read_one", "read_all"},
		"labels":          {"read_one", "read_all", "create", "update", "delete"},
		"tasks_labels":    {"create", "delete", "read_all"},
		"tasks_comments":  {"read_one", "read_all", "create", "update", "delete"},
		"tasks_assignees": {"read_all", "create", "delete"},
	}

	perms := map[string][]string{}
	for group, actions := range wanted {
		avail, ok := routes[group]
		if !ok {
			continue
		}
		var picked []string
		for _, a := range actions {
			if _, has := avail[a]; has {
				picked = append(picked, a)
			}
		}
		if len(picked) > 0 {
			perms[group] = picked
		}
	}

	var out struct {
		Token string `json:"token"`
	}
	req := map[string]any{
		"title":       title,
		"permissions": perms,
		"expires_at":  vikunjaFarFuture.Format(time.RFC3339),
	}
	if err := c.do(ctx, http.MethodPost, "/tokens", nil, req, &out, "application/json"); err != nil {
		return "", err
	}
	if out.Token == "" {
		return "", fmt.Errorf("vikunja did not return minted API token")
	}
	return out.Token, nil
}

func (c *VikunjaClient) ListProjects(ctx context.Context) ([]VikunjaProject, error) {
	var all []VikunjaProject
	for page := 1; ; page++ {
		q := url.Values{}
		q.Set("page", strconv.Itoa(page))
		q.Set("per_page", "50")
		q.Set("is_archived", "false")

		var env vikunjaPaginated[VikunjaProject]
		if err := c.do(ctx, http.MethodGet, "/projects", q, nil, &env, ""); err != nil {
			return nil, err
		}
		for _, p := range env.Items {
			p.HexColor = normalizeVikunjaHex(p.HexColor)
			all = append(all, p)
		}
		if page >= env.TotalPages || env.TotalPages == 0 {
			break
		}
	}
	return all, nil
}

func (c *VikunjaClient) ListLabels(ctx context.Context) ([]VikunjaLabel, error) {
	var all []VikunjaLabel
	for page := 1; ; page++ {
		q := url.Values{}
		q.Set("page", strconv.Itoa(page))
		q.Set("per_page", "50")

		var env vikunjaPaginated[VikunjaLabel]
		if err := c.do(ctx, http.MethodGet, "/labels", q, nil, &env, ""); err != nil {
			return nil, err
		}
		for _, l := range env.Items {
			l.HexColor = normalizeVikunjaHex(l.HexColor)
			all = append(all, l)
		}
		if page >= env.TotalPages || env.TotalPages == 0 {
			break
		}
	}
	return all, nil
}

func (c *VikunjaClient) ListTasks(ctx context.Context, filter string, maxPages int) ([]VikunjaTask, error) {
	var all []VikunjaTask
	for page := 1; page <= maxPages; page++ {
		q := url.Values{}
		q.Set("page", strconv.Itoa(page))
		q.Set("per_page", "50")
		q.Add("sort_by", "done")
		q.Add("order_by", "asc")
		q.Add("sort_by", "priority")
		q.Add("order_by", "desc")
		q.Add("sort_by", "due_date")
		q.Add("order_by", "asc")
		q.Add("sort_by", "id")
		q.Add("order_by", "desc")
		if filter != "" {
			q.Set("filter", filter)
			q.Set("filter_include_nulls", "true")
		}

		var env vikunjaPaginated[VikunjaTask]
		if err := c.do(ctx, http.MethodGet, "/tasks", q, nil, &env, ""); err != nil {
			return nil, err
		}
		for _, t := range env.Items {
			all = append(all, normalizeVikunjaTask(t, c.BaseURL))
		}
		if page >= env.TotalPages || env.TotalPages == 0 {
			break
		}
	}
	return all, nil
}

func (c *VikunjaClient) CreateTask(ctx context.Context, projectID int64, body VikunjaTaskCreate) (*VikunjaTask, error) {
	var out VikunjaTask
	path := fmt.Sprintf("/projects/%d/tasks", projectID)
	if err := c.do(ctx, http.MethodPost, path, nil, body, &out, "application/json"); err != nil {
		return nil, err
	}
	norm := normalizeVikunjaTask(out, c.BaseURL)
	return &norm, nil
}

func (c *VikunjaClient) GetTask(ctx context.Context, taskID int64) (*VikunjaTask, error) {
	var out VikunjaTask
	path := fmt.Sprintf("/tasks/%d", taskID)
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out, ""); err != nil {
		return nil, err
	}
	norm := normalizeVikunjaTask(out, c.BaseURL)
	return &norm, nil
}

func (c *VikunjaClient) PatchTask(ctx context.Context, taskID int64, patch VikunjaTaskPatch) (*VikunjaTask, error) {
	var out VikunjaTask
	path := fmt.Sprintf("/tasks/%d", taskID)
	if err := c.do(ctx, http.MethodPatch, path, nil, patch, &out, "application/merge-patch+json"); err != nil {
		return nil, err
	}
	norm := normalizeVikunjaTask(out, c.BaseURL)
	return &norm, nil
}

func (c *VikunjaClient) DeleteTask(ctx context.Context, taskID int64) error {
	path := fmt.Sprintf("/tasks/%d", taskID)
	return c.do(ctx, http.MethodDelete, path, nil, nil, nil, "")
}

func (c *VikunjaClient) AddTaskLabel(ctx context.Context, taskID, labelID int64) error {
	path := fmt.Sprintf("/tasks/%d/labels", taskID)
	return c.do(ctx, http.MethodPost, path, nil, map[string]int64{"label_id": labelID}, nil, "application/json")
}

func (c *VikunjaClient) RemoveTaskLabel(ctx context.Context, taskID, labelID int64) error {
	path := fmt.Sprintf("/tasks/%d/labels/%d", taskID, labelID)
	return c.do(ctx, http.MethodDelete, path, nil, nil, nil, "")
}

func (c *VikunjaClient) ListTaskComments(ctx context.Context, taskID int64) ([]VikunjaComment, error) {
	path := fmt.Sprintf("/tasks/%d/comments", taskID)
	var env vikunjaPaginated[VikunjaComment]
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &env, ""); err != nil {
		return nil, err
	}
	if env.Items == nil {
		return []VikunjaComment{}, nil
	}
	return env.Items, nil
}

func (c *VikunjaClient) AddTaskComment(ctx context.Context, taskID int64, htmlComment string) (*VikunjaComment, error) {
	path := fmt.Sprintf("/tasks/%d/comments", taskID)
	var out VikunjaComment
	if err := c.do(ctx, http.MethodPost, path, nil, map[string]string{"comment": htmlComment}, &out, "application/json"); err != nil {
		return nil, err
	}
	return &out, nil
}

func normalizeVikunjaHex(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.HasPrefix(s, "#") {
		return "#" + s
	}
	return s
}

func sanitizeVikunjaDate(raw string) string {
	if raw == "" || strings.HasPrefix(raw, "0001-01-01") {
		return ""
	}
	return raw
}

func normalizeVikunjaTask(t VikunjaTask, frontendBase string) VikunjaTask {
	t.HexColor = normalizeVikunjaHex(t.HexColor)
	t.DueDate = sanitizeVikunjaDate(t.DueDate)
	t.StartDate = sanitizeVikunjaDate(t.StartDate)
	t.EndDate = sanitizeVikunjaDate(t.EndDate)
	t.DoneAt = sanitizeVikunjaDate(t.DoneAt)
	for i := range t.Labels {
		t.Labels[i].HexColor = normalizeVikunjaHex(t.Labels[i].HexColor)
	}
	if frontendBase != "" && t.ID > 0 {
		t.URL = fmt.Sprintf("%s/tasks/%d", strings.TrimRight(frontendBase, "/"), t.ID)
	}
	return t
}
