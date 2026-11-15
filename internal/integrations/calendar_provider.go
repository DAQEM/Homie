package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"homie/internal/models"
	"homie/internal/state"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const maxICSBytes = 8 * 1024 * 1024

type CalendarFeedConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Color   string `json:"color"`
	Enabled *bool  `json:"enabled,omitempty"`
}

type calendarNodeSettings struct {
	Timezone      string               `json:"timezone"`
	ICalURL       string               `json:"icalUrl"`
	CalendarFeeds []CalendarFeedConfig `json:"calendarFeeds"`
}

type FeedSyncResult struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Count int    `json:"count"`
}

type CalendarSyncStatus struct {
	LastSyncedAt string           `json:"lastSyncedAt"`
	TotalEvents  int              `json:"totalEvents"`
	Feeds        []FeedSyncResult `json:"feeds"`
}

type cachedICSFeed struct {
	etag         string
	lastModified string
	rawBody      string
	fetchedAt    time.Time
}

type ownedCalendarNode struct {
	models.Node
	UserID uuid.UUID `gorm:"column:user_id"`
}

type CalendarProvider struct {
	db         *gorm.DB
	engine     *state.Engine
	httpClient *http.Client
	feedCache  sync.Map
	triggerCh  chan struct{}
}

func NewCalendarProvider(db *gorm.DB, engine *state.Engine) *CalendarProvider {
	return &CalendarProvider{
		db:     db,
		engine: engine,
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
		triggerCh: make(chan struct{}, 1),
	}
}

func (p *CalendarProvider) Name() string {
	return "calendar_ics"
}

func (p *CalendarProvider) Initialize(ctx context.Context) error {
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

func (p *CalendarProvider) TriggerSync() {
	select {
	case p.triggerCh <- struct{}{}:
	default:
	}
}

func (p *CalendarProvider) SyncNodeNow(ctx context.Context, userID, nodeID uuid.UUID) (*CalendarSyncStatus, error) {
	var row ownedCalendarNode
	if err := p.db.WithContext(ctx).
		Table("nodes").
		Select("nodes.*, workspaces.user_id").
		Joins("JOIN workspaces ON workspaces.id = nodes.workspace_id").
		Where("nodes.id = ? AND nodes.node_type = ? AND workspaces.user_id = ?", nodeID, "calendar", userID).
		First(&row).Error; err != nil {
		return nil, err
	}
	status := p.syncSingleNode(ctx, row.Node, row.UserID, p.engine, true)
	return &status, nil
}

func (p *CalendarProvider) QueryNodeEvents(ctx context.Context, userID, nodeID uuid.UUID, start, end time.Time) ([]SyncedCalendarEvent, error) {
	var row ownedCalendarNode
	if err := p.db.WithContext(ctx).
		Table("nodes").
		Select("nodes.*, workspaces.user_id").
		Joins("JOIN workspaces ON workspaces.id = nodes.workspace_id").
		Where("nodes.id = ? AND nodes.node_type = ? AND workspaces.user_id = ?", nodeID, "calendar", userID).
		First(&row).Error; err != nil {
		return nil, err
	}

	var cfg calendarNodeSettings
	if len(row.Settings) > 0 {
		_ = json.Unmarshal(row.Settings, &cfg)
	}

	feeds := extractConfiguredFeeds(cfg)
	if len(feeds) == 0 {
		return []SyncedCalendarEvent{}, nil
	}

	tzName := strings.TrimSpace(cfg.Timezone)
	if tzName == "" {
		tzName = "Europe/Amsterdam"
	}
	displayLoc := resolveTimezone(tzName, time.Local)

	defaultColors := []string{"#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#FF453A", "#64D2FF"}
	var allEvents []SyncedCalendarEvent

	for idx, feed := range feeds {
		if feed.Enabled != nil && !*feed.Enabled {
			continue
		}
		normalizedURL := NormalizeFeedURL(feed.URL)
		if normalizedURL == "" {
			continue
		}

		color := strings.TrimSpace(feed.Color)
		if color == "" {
			color = defaultColors[idx%len(defaultColors)]
		}
		name := strings.TrimSpace(feed.Name)
		if name == "" {
			name = fmt.Sprintf("Calendar %d", idx+1)
		}

		var rawICS string
		if val, ok := p.feedCache.Load(normalizedURL); ok {
			cached := val.(cachedICSFeed)
			if time.Since(cached.fetchedAt) < 5*time.Minute && cached.rawBody != "" {
				rawICS = cached.rawBody
			}
		}
		if rawICS == "" {
			fetched, err := p.fetchICSFeed(ctx, normalizedURL, false)
			if err != nil {
				continue
			}
			rawICS = fetched
		}

		parsed, err := ParseICalendar(rawICS, displayLoc, start, end, feed.ID, name, color)
		if err != nil {
			continue
		}
		allEvents = append(allEvents, parsed...)
	}

	if allEvents == nil {
		allEvents = []SyncedCalendarEvent{}
	}
	return allEvents, nil
}

func (p *CalendarProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	var rows []ownedCalendarNode
	if err := p.db.WithContext(ctx).
		Table("nodes").
		Select("nodes.*, workspaces.user_id").
		Joins("JOIN workspaces ON workspaces.id = nodes.workspace_id").
		Where("nodes.node_type = ?", "calendar").
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("failed querying calendar nodes: %w", err)
	}

	var wg sync.WaitGroup
	for _, row := range rows {
		wg.Add(1)
		go func(r ownedCalendarNode) {
			defer wg.Done()
			p.syncSingleNode(ctx, r.Node, r.UserID, emitter, false)
		}(row)
	}
	wg.Wait()

	return nil
}

func (p *CalendarProvider) Teardown(_ context.Context) error {
	return nil
}

func (p *CalendarProvider) syncSingleNode(
	ctx context.Context,
	node models.Node,
	userID uuid.UUID,
	emitter SignalEmitter,
	forceBypassCache bool,
) CalendarSyncStatus {
	var cfg calendarNodeSettings
	if len(node.Settings) > 0 {
		_ = json.Unmarshal(node.Settings, &cfg)
	}

	feeds := extractConfiguredFeeds(cfg)
	nodeIDStr := node.ID.String()

	if len(feeds) == 0 {
		emptyStatus := CalendarSyncStatus{
			LastSyncedAt: time.Now().UTC().Format(time.RFC3339),
			TotalEvents:  0,
			Feeds:        []FeedSyncResult{},
		}
		emitter.EmitUserSignal(ctx, userID, "calendar:events:"+nodeIDStr, []SyncedCalendarEvent{})
		emitter.EmitUserSignal(ctx, userID, "calendar:status:"+nodeIDStr, emptyStatus)
		return emptyStatus
	}

	tzName := strings.TrimSpace(cfg.Timezone)
	if tzName == "" {
		tzName = "Europe/Amsterdam"
	}
	displayLoc := resolveTimezone(tzName, time.Local)

	now := time.Now().In(displayLoc)
	windowStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, displayLoc).AddDate(0, 0, -30)
	windowEnd := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, displayLoc).AddDate(0, 0, 120)

	var (
		allEvents   []SyncedCalendarEvent
		feedResults []FeedSyncResult
	)

	defaultColors := []string{"#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#FF453A", "#64D2FF"}

	for idx, feed := range feeds {
		if feed.Enabled != nil && !*feed.Enabled {
			continue
		}

		normalizedURL := NormalizeFeedURL(feed.URL)
		if normalizedURL == "" {
			continue
		}

		color := strings.TrimSpace(feed.Color)
		if color == "" {
			color = defaultColors[idx%len(defaultColors)]
		}

		name := strings.TrimSpace(feed.Name)
		if name == "" {
			name = fmt.Sprintf("Calendar %d", idx+1)
		}

		rawICS, err := p.fetchICSFeed(ctx, normalizedURL, forceBypassCache)
		if err != nil {
			slog.Warn("Failed fetching .ics feed", "node_id", nodeIDStr, "feed", name, "error", err)
			feedResults = append(feedResults, FeedSyncResult{
				ID:    feed.ID,
				Name:  name,
				OK:    false,
				Error: err.Error(),
				Count: 0,
			})
			continue
		}

		parsedEvents, err := ParseICalendar(rawICS, displayLoc, windowStart, windowEnd, feed.ID, name, color)
		if err != nil {
			feedResults = append(feedResults, FeedSyncResult{
				ID:    feed.ID,
				Name:  name,
				OK:    false,
				Error: err.Error(),
				Count: 0,
			})
			continue
		}

		allEvents = append(allEvents, parsedEvents...)
		feedResults = append(feedResults, FeedSyncResult{
			ID:    feed.ID,
			Name:  name,
			OK:    true,
			Count: len(parsedEvents),
		})
	}

	if allEvents == nil {
		allEvents = []SyncedCalendarEvent{}
	}

	status := CalendarSyncStatus{
		LastSyncedAt: time.Now().UTC().Format(time.RFC3339),
		TotalEvents:  len(allEvents),
		Feeds:        feedResults,
	}

	emitter.EmitUserSignal(ctx, userID, "calendar:events:"+nodeIDStr, allEvents)
	emitter.EmitUserSignal(ctx, userID, "calendar:status:"+nodeIDStr, status)

	return status
}

func extractConfiguredFeeds(cfg calendarNodeSettings) []CalendarFeedConfig {
	var out []CalendarFeedConfig
	seenURLs := make(map[string]bool)

	for _, f := range cfg.CalendarFeeds {
		u := NormalizeFeedURL(f.URL)
		if u == "" || seenURLs[u] {
			continue
		}
		seenURLs[u] = true
		if f.ID == "" {
			f.ID = u
		}
		out = append(out, f)
	}

	if singleURL := NormalizeFeedURL(cfg.ICalURL); singleURL != "" && !seenURLs[singleURL] {
		out = append(out, CalendarFeedConfig{
			ID:    "default-ical",
			Name:  "Subscribed Calendar",
			URL:   singleURL,
			Color: "#0A84FF",
		})
	}

	return out
}

func (p *CalendarProvider) fetchICSFeed(ctx context.Context, feedURL string, bypassCache bool) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, feedURL, nil)
	if err != nil {
		return "", fmt.Errorf("invalid feed URL")
	}

	req.Header.Set("User-Agent", "Homie-Calendar-Sync/1.0 (+https://github.com/homie)")
	req.Header.Set("Accept", "text/calendar, text/plain, */*")

	var cached cachedICSFeed
	hasCached := false
	if val, ok := p.feedCache.Load(feedURL); ok {
		cached = val.(cachedICSFeed)
		hasCached = true
		if !bypassCache {
			if cached.etag != "" {
				req.Header.Set("If-None-Match", cached.etag)
			}
			if cached.lastModified != "" {
				req.Header.Set("If-Modified-Since", cached.lastModified)
			}
		}
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		if hasCached && cached.rawBody != "" {
			return cached.rawBody, nil
		}
		return "", fmt.Errorf("network error reaching calendar host")
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified && hasCached {
		return cached.rawBody, nil
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxICSBytes))
	if err != nil {
		return "", fmt.Errorf("failed reading calendar response")
	}

	rawBody := string(bodyBytes)
	if !strings.Contains(strings.ToUpper(rawBody), "BEGIN:VCALENDAR") {
		return "", fmt.Errorf("URL did not return a valid iCalendar (.ics) file")
	}

	p.feedCache.Store(feedURL, cachedICSFeed{
		etag:         resp.Header.Get("ETag"),
		lastModified: resp.Header.Get("Last-Modified"),
		rawBody:      rawBody,
		fetchedAt:    time.Now(),
	})

	return rawBody, nil
}
