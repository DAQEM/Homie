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

// Max .ics payload size (8 MB) to guard against runaway feeds.
const maxICSBytes = 8 * 1024 * 1024

// CalendarFeedConfig represents a user-configured .ics / webcal:// feed on a Calendar node.
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

// FeedSyncResult reports the health of a single .ics feed.
type FeedSyncResult struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Count int    `json:"count"`
}

// CalendarSyncStatus is emitted to `calendar:status:<nodeID>` over SSE.
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

// CalendarProvider polls .ics feeds configured on calendar nodes and emits live events to SSE.
type CalendarProvider struct {
	db         *gorm.DB
	engine     *state.Engine
	httpClient *http.Client
	feedCache  sync.Map // map[string]cachedICSFeed
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
	// Background listener for immediate on-demand sync triggers
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

// TriggerSync schedules an immediate non-blocking poll of all calendar nodes.
func (p *CalendarProvider) TriggerSync() {
	select {
	case p.triggerCh <- struct{}{}:
	default:
	}
}

// SyncNodeNow forces an immediate refresh (bypassing HTTP cache) for a single calendar node.
func (p *CalendarProvider) SyncNodeNow(ctx context.Context, nodeID uuid.UUID) (*CalendarSyncStatus, error) {
	var node models.Node
	if err := p.db.WithContext(ctx).First(&node, "id = ? AND node_type = ?", nodeID, "calendar").Error; err != nil {
		return nil, err
	}
	status := p.syncSingleNode(ctx, node, p.engine, true)
	return &status, nil
}

func (p *CalendarProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	var calendarNodes []models.Node
	if err := p.db.WithContext(ctx).Where("node_type = ?", "calendar").Find(&calendarNodes).Error; err != nil {
		return fmt.Errorf("failed querying calendar nodes: %w", err)
	}

	var wg sync.WaitGroup
	for _, node := range calendarNodes {
		wg.Add(1)
		go func(n models.Node) {
			defer wg.Done()
			p.syncSingleNode(ctx, n, emitter, false)
		}(node)
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
		emitter.EmitSignal(ctx, "calendar:events:"+nodeIDStr, []SyncedCalendarEvent{})
		emitter.EmitSignal(ctx, "calendar:status:"+nodeIDStr, emptyStatus)
		return emptyStatus
	}

	tzName := strings.TrimSpace(cfg.Timezone)
	if tzName == "" {
		tzName = "Europe/Amsterdam"
	}
	displayLoc := resolveTimezone(tzName, time.Local)

	now := time.Now().In(displayLoc)
	// Expand 5 years back through 5 years ahead so multi-year navigation (e.g. 2025) is fully populated
	windowStart := time.Date(now.Year()-5, 1, 1, 0, 0, 0, 0, displayLoc)
	windowEnd := time.Date(now.Year()+5, 12, 31, 23, 59, 59, 0, displayLoc)

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

	status := CalendarSyncStatus{
		LastSyncedAt: time.Now().UTC().Format(time.RFC3339),
		TotalEvents:  len(allEvents),
		Feeds:        feedResults,
	}

	emitter.EmitSignal(ctx, "calendar:events:"+nodeIDStr, allEvents)
	emitter.EmitSignal(ctx, "calendar:status:"+nodeIDStr, status)

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
