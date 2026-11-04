package integrations

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // Embed IANA timezone database for Distroless static runtime
)

// SyncedCalendarEvent represents a normalized calendar event ready for the frontend.
type SyncedCalendarEvent struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Time        string `json:"time"`
	Date        string `json:"date"` // YYYY-MM-DD in widget's display timezone
	Color       string `json:"color,omitempty"`
	Location    string `json:"location,omitempty"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url,omitempty"`
	IsAllDay    bool   `json:"isAllDay,omitempty"`
	Source      string `json:"source"` // "ical"
	FeedID      string `json:"feedId,omitempty"`
	FeedName    string `json:"feedName,omitempty"`
	StartISO    string `json:"startIso,omitempty"`
	EndISO      string `json:"endIso,omitempty"`
	sortKey     int64
}

type icalProp struct {
	Name   string
	Params map[string]string
	Value  string
}

type rawVEvent struct {
	UID          string
	Summary      string
	Location     string
	Description  string
	URL          string
	Status       string
	Start        time.Time
	End          time.Time
	IsAllDay     bool
	RRule        string
	ExDates      map[string]bool
	RecurrenceID string
}

// NormalizeFeedURL converts webcal:// and webcals:// URLs (used by Apple iCloud) to https://.
func NormalizeFeedURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	lower := strings.ToLower(trimmed)
	switch {
	case strings.HasPrefix(lower, "webcals://"):
		return "https://" + trimmed[len("webcals://"):]
	case strings.HasPrefix(lower, "webcal://"):
		return "https://" + trimmed[len("webcal://"):]
	default:
		return trimmed
	}
}

// ParseICalendar parses raw RFC 5545 .ics data and expands occurrences within [windowStart, windowEnd].
func ParseICalendar(
	icsData string,
	displayLoc *time.Location,
	windowStart time.Time,
	windowEnd time.Time,
	feedID string,
	feedName string,
	feedColor string,
) ([]SyncedCalendarEvent, error) {
	if displayLoc == nil {
		displayLoc = time.UTC
	}

	lines := unfoldICalLines(icsData)

	var (
		rawEvents    []rawVEvent
		inEvent      bool
		currentProp  []icalProp
		calDefaultTZ *time.Location
	)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		upper := strings.ToUpper(trimmed)
		if upper == "BEGIN:VEVENT" {
			inEvent = true
			currentProp = currentProp[:0]
			continue
		}
		if upper == "END:VEVENT" {
			if inEvent {
				if ev, ok := buildRawVEvent(currentProp, calDefaultTZ, displayLoc); ok {
					rawEvents = append(rawEvents, ev)
				}
			}
			inEvent = false
			continue
		}

		prop, ok := parseICalProperty(line)
		if !ok {
			continue
		}

		if !inEvent && prop.Name == "X-WR-TIMEZONE" && prop.Value != "" {
			if loc := resolveTimezone(prop.Value, nil); loc != time.UTC {
				calDefaultTZ = loc
			}
			continue
		}

		if inEvent {
			currentProp = append(currentProp, prop)
		}
	}

	// Collect RECURRENCE-ID overrides so moved instances replace the original recurring slot
	overrides := make(map[string]bool)
	for _, ev := range rawEvents {
		if ev.RecurrenceID != "" && ev.UID != "" {
			overrides[ev.UID+"|"+ev.RecurrenceID] = true
		}
	}

	var results []SyncedCalendarEvent

	for _, ev := range rawEvents {
		if strings.EqualFold(ev.Status, "CANCELLED") {
			continue
		}

		duration := ev.End.Sub(ev.Start)
		if duration < 0 {
			duration = 0
		}

		if ev.RRule != "" && ev.RecurrenceID == "" {
			occurrences := expandRRule(ev, windowStart, windowEnd)
			for _, occStart := range occurrences {
				occKey := occStart.UTC().Format("20060102T150405Z")
				dateKey := occStart.Format("20060102")
				if ev.ExDates[occKey] || ev.ExDates[dateKey] {
					continue
				}
				if overrides[ev.UID+"|"+occKey] || overrides[ev.UID+"|"+dateKey] {
					continue
				}
				occEnd := occStart.Add(duration)
				results = append(results, buildMaterializedEvents(
					ev, occStart, occEnd, displayLoc, windowStart, windowEnd, feedID, feedName, feedColor,
				)...)
			}
		} else {
			if ev.End.Before(windowStart) || ev.Start.After(windowEnd) {
				continue
			}
			results = append(results, buildMaterializedEvents(
				ev, ev.Start, ev.End, displayLoc, windowStart, windowEnd, feedID, feedName, feedColor,
			)...)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		if results[i].Date != results[j].Date {
			return results[i].Date < results[j].Date
		}
		if results[i].IsAllDay != results[j].IsAllDay {
			return results[i].IsAllDay
		}
		if results[i].sortKey != results[j].sortKey {
			return results[i].sortKey < results[j].sortKey
		}
		return results[i].Title < results[j].Title
	})

	return results, nil
}

func buildMaterializedEvents(
	ev rawVEvent,
	start time.Time,
	end time.Time,
	displayLoc *time.Location,
	windowStart time.Time,
	windowEnd time.Time,
	feedID string,
	feedName string,
	feedColor string,
) []SyncedCalendarEvent {
	var out []SyncedCalendarEvent

	if ev.IsAllDay {
		// RFC 5545 all-day DTEND is non-inclusive. Ensure at least 1 day span.
		cur := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, displayLoc)
		endDate := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, displayLoc)
		if !endDate.After(cur) {
			endDate = cur.AddDate(0, 0, 1)
		}

		for d := cur; d.Before(endDate); d = d.AddDate(0, 0, 1) {
			if d.Before(windowStart.Add(-24*time.Hour)) || d.After(windowEnd) {
				continue
			}
			dateStr := d.Format("2006-01-02")
			out = append(out, SyncedCalendarEvent{
				ID:          fmt.Sprintf("%s:%s:%s", feedID, ev.UID, dateStr),
				Title:       ev.Summary,
				Time:        "All day",
				Date:        dateStr,
				Color:       feedColor,
				Location:    ev.Location,
				Description: ev.Description,
				URL:         ev.URL,
				IsAllDay:    true,
				Source:      "ical",
				FeedID:      feedID,
				FeedName:    feedName,
				StartISO:    dateStr,
				EndISO:      endDate.Format("2006-01-02"),
				sortKey:     0,
			})
		}
		return out
	}

	localStart := start.In(displayLoc)
	localEnd := end.In(displayLoc)
	dateStr := localStart.Format("2006-01-02")

	timeLabel := localStart.Format("15:04")
	if localEnd.After(localStart) {
		timeLabel = fmt.Sprintf("%s - %s", localStart.Format("15:04"), localEnd.Format("15:04"))
	}

	out = append(out, SyncedCalendarEvent{
		ID:          fmt.Sprintf("%s:%s:%d", feedID, ev.UID, localStart.Unix()),
		Title:       ev.Summary,
		Time:        timeLabel,
		Date:        dateStr,
		Color:       feedColor,
		Location:    ev.Location,
		Description: ev.Description,
		URL:         ev.URL,
		IsAllDay:    false,
		Source:      "ical",
		FeedID:      feedID,
		FeedName:    feedName,
		StartISO:    localStart.Format(time.RFC3339),
		EndISO:      localEnd.Format(time.RFC3339),
		sortKey:     localStart.Unix(),
	})

	return out
}

// unfoldICalLines unfolds multi-line RFC 5545 properties where continuation lines start with SPACE or TAB.
func unfoldICalLines(raw string) []string {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	rawLines := strings.Split(normalized, "\n")

	out := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		if len(line) > 0 && (line[0] == ' ' || line[0] == '\t') {
			if len(out) > 0 {
				out[len(out)-1] += line[1:]
			}
		} else {
			out = append(out, line)
		}
	}
	return out
}

// parseICalProperty splits "NAME;PARAM1=VAL1;PARAM2="VAL2":VALUE" into structured parts.
func parseICalProperty(line string) (icalProp, bool) {
	inQuotes := false
	colonIdx := -1
	for i := 0; i < len(line); i++ {
		if line[i] == '"' {
			inQuotes = !inQuotes
		} else if line[i] == ':' && !inQuotes {
			colonIdx = i
			break
		}
	}
	if colonIdx <= 0 {
		return icalProp{}, false
	}

	left := line[:colonIdx]
	value := line[colonIdx+1:]

	parts := splitRespectingQuotes(left, ';')
	name := strings.ToUpper(strings.TrimSpace(parts[0]))
	params := make(map[string]string)

	for _, paramStr := range parts[1:] {
		eqIdx := strings.IndexByte(paramStr, '=')
		if eqIdx <= 0 {
			continue
		}
		k := strings.ToUpper(strings.TrimSpace(paramStr[:eqIdx]))
		v := strings.Trim(strings.TrimSpace(paramStr[eqIdx+1:]), `"`)
		params[k] = v
	}

	return icalProp{
		Name:   name,
		Params: params,
		Value:  value,
	}, true
}

func splitRespectingQuotes(s string, sep byte) []string {
	var out []string
	inQuotes := false
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '"' {
			inQuotes = !inQuotes
		} else if s[i] == sep && !inQuotes {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}

func unescapeICalMultilineText(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
			switch s[i] {
			case 'n', 'N':
				b.WriteByte('\n')
			case ',', ';', '\\':
				b.WriteByte(s[i])
			default:
				b.WriteByte(s[i])
			}
		} else {
			b.WriteByte(s[i])
		}
	}
	res := strings.TrimSpace(b.String())
	if len(res) > 600 {
		res = strings.TrimSpace(res[:600]) + "…"
	}
	return res
}

func unescapeICalText(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(unescapeICalMultilineText(s), "\n", " "))
}

func buildRawVEvent(props []icalProp, calDefaultTZ, displayLoc *time.Location) (rawVEvent, bool) {
	ev := rawVEvent{
		Summary: "Busy",
		ExDates: make(map[string]bool),
	}

	var (
		hasStart    bool
		hasEnd      bool
		durationStr string
	)

	fallbackLoc := calDefaultTZ
	if fallbackLoc == nil {
		fallbackLoc = displayLoc
	}

	for _, p := range props {
		switch p.Name {
		case "UID":
			ev.UID = strings.TrimSpace(p.Value)
		case "SUMMARY":
			if t := unescapeICalText(p.Value); t != "" {
				ev.Summary = t
			}
		case "LOCATION":
			ev.Location = unescapeICalText(p.Value)
		case "DESCRIPTION":
			ev.Description = unescapeICalMultilineText(p.Value)
		case "URL":
			ev.URL = strings.TrimSpace(p.Value)
		case "STATUS":
			ev.Status = strings.TrimSpace(p.Value)
		case "DTSTART":
			t, allDay, err := parseICalDateTime(p.Value, p.Params, fallbackLoc)
			if err == nil {
				ev.Start = t
				ev.IsAllDay = allDay
				hasStart = true
			}
		case "DTEND":
			t, _, err := parseICalDateTime(p.Value, p.Params, fallbackLoc)
			if err == nil {
				ev.End = t
				hasEnd = true
			}
		case "DURATION":
			durationStr = strings.TrimSpace(p.Value)
		case "RRULE":
			ev.RRule = strings.TrimSpace(p.Value)
		case "RECURRENCE-ID":
			t, allDay, err := parseICalDateTime(p.Value, p.Params, fallbackLoc)
			if err == nil {
				if allDay {
					ev.RecurrenceID = t.Format("20060102")
				} else {
					ev.RecurrenceID = t.UTC().Format("20060102T150405Z")
				}
			}
		case "EXDATE":
			for _, part := range strings.Split(p.Value, ",") {
				t, allDay, err := parseICalDateTime(strings.TrimSpace(part), p.Params, fallbackLoc)
				if err == nil {
					if allDay {
						ev.ExDates[t.Format("20060102")] = true
					} else {
						ev.ExDates[t.UTC().Format("20060102T150405Z")] = true
					}
				}
			}
		}
	}

	if !hasStart {
		return rawVEvent{}, false
	}

	if !hasEnd {
		if durationStr != "" {
			ev.End = ev.Start.Add(parseICalDuration(durationStr))
		} else if ev.IsAllDay {
			ev.End = ev.Start.AddDate(0, 0, 1)
		} else {
			ev.End = ev.Start.Add(time.Hour)
		}
	}

	if ev.UID == "" {
		ev.UID = fmt.Sprintf("anon-%d-%s", ev.Start.Unix(), ev.Summary)
	}

	return ev, true
}

func parseICalDateTime(val string, params map[string]string, fallbackLoc *time.Location) (time.Time, bool, error) {
	val = strings.TrimSpace(val)
	if fallbackLoc == nil {
		fallbackLoc = time.UTC
	}

	loc := fallbackLoc
	if tzid, ok := params["TZID"]; ok && tzid != "" {
		loc = resolveTimezone(tzid, fallbackLoc)
	}

	// All-day date: YYYYMMDD
	if len(val) == 8 || strings.EqualFold(params["VALUE"], "DATE") {
		datePart := val
		if len(datePart) > 8 {
			datePart = datePart[:8]
		}
		t, err := time.ParseInLocation("20060102", datePart, loc)
		return t, true, err
	}

	// UTC Date-Time: YYYYMMDDTHHMMSSZ
	if strings.HasSuffix(val, "Z") {
		t, err := time.Parse("20060102T150405Z", val)
		if err != nil {
			t, err = time.Parse("20060102T1504Z", val)
		}
		return t, false, err
	}

	// Local / TZID Date-Time: YYYYMMDDTHHMMSS
	t, err := time.ParseInLocation("20060102T150405", val, loc)
	if err != nil {
		t, err = time.ParseInLocation("20060102T1504", val, loc)
	}
	return t, false, err
}

func parseICalDuration(dur string) time.Duration {
	dur = strings.TrimSpace(strings.ToUpper(dur))
	if dur == "" {
		return time.Hour
	}
	neg := false
	if strings.HasPrefix(dur, "-") {
		neg = true
		dur = dur[1:]
	} else if strings.HasPrefix(dur, "+") {
		dur = dur[1:]
	}
	dur = strings.TrimPrefix(dur, "P")

	var total time.Duration
	numBuf := ""
	for i := 0; i < len(dur); i++ {
		c := dur[i]
		if c >= '0' && c <= '9' {
			numBuf += string(c)
			continue
		}
		if c == 'T' {
			numBuf = ""
			continue
		}
		n, _ := strconv.Atoi(numBuf)
		numBuf = ""
		switch c {
		case 'W':
			total += time.Duration(n) * 7 * 24 * time.Hour
		case 'D':
			total += time.Duration(n) * 24 * time.Hour
		case 'H':
			total += time.Duration(n) * time.Hour
		case 'M':
			total += time.Duration(n) * time.Minute
		case 'S':
			total += time.Duration(n) * time.Second
		}
	}
	if neg {
		return -total
	}
	return total
}

// expandRRule expands RFC 5545 recurrence rules (DAILY, WEEKLY, MONTHLY, YEARLY) within [windowStart, windowEnd].
func expandRRule(ev rawVEvent, windowStart, windowEnd time.Time) []time.Time {
	rules := make(map[string]string)
	for _, token := range strings.Split(ev.RRule, ";") {
		kv := strings.SplitN(token, "=", 2)
		if len(kv) == 2 {
			rules[strings.ToUpper(strings.TrimSpace(kv[0]))] = strings.ToUpper(strings.TrimSpace(kv[1]))
		}
	}

	freq := rules["FREQ"]
	if freq == "" {
		return []time.Time{ev.Start}
	}

	interval := 1
	if iv, err := strconv.Atoi(rules["INTERVAL"]); err == nil && iv > 0 {
		interval = iv
	}

	maxCount := 0
	if c, err := strconv.Atoi(rules["COUNT"]); err == nil && c > 0 {
		maxCount = c
	}

	var until time.Time
	hasUntil := false
	if uStr, ok := rules["UNTIL"]; ok && uStr != "" {
		if t, _, err := parseICalDateTime(uStr, nil, ev.Start.Location()); err == nil {
			if len(uStr) == 8 {
				until = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
			} else {
				until = t
			}
			hasUntil = true
		}
	}

	byDays := parseByDayTokens(rules["BYDAY"])
	var byMonthDays []int
	if bmd, ok := rules["BYMONTHDAY"]; ok && bmd != "" {
		for _, tok := range strings.Split(bmd, ",") {
			if d, err := strconv.Atoi(strings.TrimSpace(tok)); err == nil {
				byMonthDays = append(byMonthDays, d)
			}
		}
	}

	var occurrences []time.Time
	generatedCount := 0
	const maxIterations = 12000

	switch freq {
	case "DAILY":
		cur := ev.Start
		for i := 0; i < maxIterations; i++ {
			if hasUntil && cur.After(until) {
				break
			}
			if cur.After(windowEnd) {
				break
			}
			if len(byDays) == 0 || matchesWeekday(cur.Weekday(), byDays) {
				generatedCount++
				if !cur.Before(windowStart.Add(-24 * time.Hour)) {
					occurrences = append(occurrences, cur)
				}
				if maxCount > 0 && generatedCount >= maxCount {
					break
				}
			}
			cur = cur.AddDate(0, 0, interval)
		}

	case "WEEKLY":
		if len(byDays) == 0 {
			byDays = []byDaySpec{{Weekday: ev.Start.Weekday()}}
		}
		startMidnight := time.Date(ev.Start.Year(), ev.Start.Month(), ev.Start.Day(), 0, 0, 0, 0, ev.Start.Location())
		offsetToMonday := (int(startMidnight.Weekday()) + 6) % 7
		anchorMonday := startMidnight.AddDate(0, 0, -offsetToMonday)

		cur := ev.Start
		for i := 0; i < maxIterations; i++ {
			if hasUntil && cur.After(until) {
				break
			}
			if cur.After(windowEnd) {
				break
			}

			curMidnight := time.Date(cur.Year(), cur.Month(), cur.Day(), 0, 0, 0, 0, cur.Location())
			daysSinceAnchor := int(curMidnight.Sub(anchorMonday).Hours() / 24)
			weeksSinceAnchor := daysSinceAnchor / 7

			if weeksSinceAnchor >= 0 && weeksSinceAnchor%interval == 0 && matchesWeekday(cur.Weekday(), byDays) {
				generatedCount++
				if !cur.Before(windowStart.Add(-24 * time.Hour)) {
					occurrences = append(occurrences, cur)
				}
				if maxCount > 0 && generatedCount >= maxCount {
					break
				}
			}
			cur = cur.AddDate(0, 0, 1)
		}

	case "MONTHLY":
		baseYear, baseMonth, baseDay := ev.Start.Date()
		hr, min, sec := ev.Start.Clock()
		loc := ev.Start.Location()

		for step := 0; step < 1500; step++ {
			targetMonthTime := time.Date(baseYear, baseMonth+time.Month(step*interval), 1, hr, min, sec, 0, loc)
			if targetMonthTime.After(windowEnd.AddDate(0, 1, 0)) {
				break
			}

			var monthCandidates []time.Time
			if len(byMonthDays) > 0 {
				for _, dom := range byMonthDays {
					if c, ok := dateInMonth(targetMonthTime.Year(), targetMonthTime.Month(), dom, hr, min, sec, loc); ok {
						monthCandidates = append(monthCandidates, c)
					}
				}
			} else if len(byDays) > 0 {
				monthCandidates = expandMonthlyByDay(targetMonthTime.Year(), targetMonthTime.Month(), byDays, hr, min, sec, loc)
			} else {
				if c, ok := dateInMonth(targetMonthTime.Year(), targetMonthTime.Month(), baseDay, hr, min, sec, loc); ok {
					monthCandidates = append(monthCandidates, c)
				}
			}

			for _, cand := range monthCandidates {
				if cand.Before(ev.Start) {
					continue
				}
				if hasUntil && cand.After(until) {
					return occurrences
				}
				if cand.After(windowEnd) {
					return occurrences
				}
				generatedCount++
				if !cand.Before(windowStart.Add(-24 * time.Hour)) {
					occurrences = append(occurrences, cand)
				}
				if maxCount > 0 && generatedCount >= maxCount {
					return occurrences
				}
			}
		}

	case "YEARLY":
		for step := 0; step < 250; step++ {
			cand := ev.Start.AddDate(step*interval, 0, 0)
			if hasUntil && cand.After(until) {
				break
			}
			if cand.After(windowEnd) {
				break
			}
			generatedCount++
			if !cand.Before(windowStart.Add(-24 * time.Hour)) {
				occurrences = append(occurrences, cand)
			}
			if maxCount > 0 && generatedCount >= maxCount {
				break
			}
		}

	default:
		occurrences = append(occurrences, ev.Start)
	}

	return occurrences
}

type byDaySpec struct {
	Ordinal int // e.g., 1 for 1MO, -1 for -1FR, 0 for every matching weekday
	Weekday time.Weekday
}

func parseByDayTokens(raw string) []byDaySpec {
	if raw == "" {
		return nil
	}
	var out []byDaySpec
	for _, tok := range strings.Split(raw, ",") {
		tok = strings.TrimSpace(tok)
		if len(tok) < 2 {
			continue
		}
		dayCode := tok[len(tok)-2:]
		ordPart := tok[:len(tok)-2]
		ord := 0
		if ordPart != "" {
			ord, _ = strconv.Atoi(ordPart)
		}
		wd, ok := parseICalWeekday(dayCode)
		if ok {
			out = append(out, byDaySpec{Ordinal: ord, Weekday: wd})
		}
	}
	return out
}

func parseICalWeekday(code string) (time.Weekday, bool) {
	switch strings.ToUpper(code) {
	case "SU":
		return time.Sunday, true
	case "MO":
		return time.Monday, true
	case "TU":
		return time.Tuesday, true
	case "WE":
		return time.Wednesday, true
	case "TH":
		return time.Thursday, true
	case "FR":
		return time.Friday, true
	case "SA":
		return time.Saturday, true
	default:
		return time.Sunday, false
	}
}

func matchesWeekday(wd time.Weekday, specs []byDaySpec) bool {
	for _, s := range specs {
		if s.Weekday == wd {
			return true
		}
	}
	return false
}

func dateInMonth(year int, month time.Month, day, hr, min, sec int, loc *time.Location) (time.Time, bool) {
	daysInM := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
	actualDay := day
	if day < 0 {
		actualDay = daysInM + 1 + day
	}
	if actualDay < 1 || actualDay > daysInM {
		return time.Time{}, false
	}
	return time.Date(year, month, actualDay, hr, min, sec, 0, loc), true
}

func expandMonthlyByDay(year int, month time.Month, specs []byDaySpec, hr, min, sec int, loc *time.Location) []time.Time {
	daysInM := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
	var results []time.Time

	for _, spec := range specs {
		var matches []time.Time
		for d := 1; d <= daysInM; d++ {
			t := time.Date(year, month, d, hr, min, sec, 0, loc)
			if t.Weekday() == spec.Weekday {
				matches = append(matches, t)
			}
		}
		if len(matches) == 0 {
			continue
		}
		if spec.Ordinal == 0 {
			results = append(results, matches...)
		} else if spec.Ordinal > 0 && spec.Ordinal <= len(matches) {
			results = append(results, matches[spec.Ordinal-1])
		} else if spec.Ordinal < 0 && len(matches)+spec.Ordinal >= 0 {
			results = append(results, matches[len(matches)+spec.Ordinal])
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Before(results[j])
	})
	return results
}

// windowsToIANA translates Microsoft Outlook/Exchange Windows timezone identifiers to IANA names.
var windowsToIANA = map[string]string{
	"W. EUROPE STANDARD TIME":        "Europe/Amsterdam",
	"CENTRAL EUROPE STANDARD TIME":   "Europe/Budapest",
	"CENTRAL EUROPEAN STANDARD TIME": "Europe/Warsaw",
	"ROMANCE STANDARD TIME":          "Europe/Paris",
	"GMT STANDARD TIME":              "Europe/London",
	"UTC":                            "UTC",
	"GREENWICH STANDARD TIME":        "Atlantic/Reykjavik",
	"E. EUROPE STANDARD TIME":        "Europe/Chisinau",
	"FLE STANDARD TIME":              "Europe/Kiev",
	"GTB STANDARD TIME":              "Europe/Bucharest",
	"RUSSIAN STANDARD TIME":          "Europe/Moscow",
	"ISRAEL STANDARD TIME":           "Asia/Jerusalem",
	"ARABIAN STANDARD TIME":          "Asia/Dubai",
	"INDIA STANDARD TIME":            "Asia/Kolkata",
	"CHINA STANDARD TIME":            "Asia/Shanghai",
	"SINGAPORE STANDARD TIME":        "Asia/Singapore",
	"TAIPEI STANDARD TIME":           "Asia/Taipei",
	"TOKYO STANDARD TIME":            "Asia/Tokyo",
	"KOREA STANDARD TIME":            "Asia/Seoul",
	"AUS EASTERN STANDARD TIME":      "Australia/Sydney",
	"E. AUSTRALIA STANDARD TIME":     "Australia/Brisbane",
	"NEW ZEALAND STANDARD TIME":      "Pacific/Auckland",
	"EASTERN STANDARD TIME":          "America/New_York",
	"US EASTERN STANDARD TIME":       "America/Indianapolis",
	"CENTRAL STANDARD TIME":          "America/Chicago",
	"MOUNTAIN STANDARD TIME":         "America/Denver",
	"US MOUNTAIN STANDARD TIME":      "America/Phoenix",
	"PACIFIC STANDARD TIME":          "America/Los_Angeles",
	"ALASKAN STANDARD TIME":          "America/Anchorage",
	"HAWAIIAN STANDARD TIME":         "Pacific/Honolulu",
	"ATLANTIC STANDARD TIME":         "America/Halifax",
	"E. SOUTH AMERICA STANDARD TIME": "America/Sao_Paulo",
	"SA PACIFIC STANDARD TIME":       "America/Bogota",
}

func resolveTimezone(tzName string, fallback *time.Location) *time.Location {
	cleaned := strings.Trim(strings.TrimSpace(tzName), `"`)
	if cleaned == "" {
		if fallback != nil {
			return fallback
		}
		return time.UTC
	}

	if loc, err := time.LoadLocation(cleaned); err == nil {
		return loc
	}

	if mapped, ok := windowsToIANA[strings.ToUpper(cleaned)]; ok {
		if loc, err := time.LoadLocation(mapped); err == nil {
			return loc
		}
	}

	if fallback != nil {
		return fallback
	}
	return time.UTC
}
