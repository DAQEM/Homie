package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"homie/internal/models"
	"homie/internal/state"

	"gorm.io/gorm"
)

type WeatherHourlyPoint struct {
	Time        string  `json:"time"` // HH:MM
	Temperature float64 `json:"temperature"`
	Code        int     `json:"code"`
	IsDay       bool    `json:"isDay"`
}

type WeatherDailyPoint struct {
	Date    string  `json:"date"` // YYYY-MM-DD
	Code    int     `json:"code"`
	TempMax float64 `json:"tempMax"`
	TempMin float64 `json:"tempMin"`
}

type WeatherSignal struct {
	Location    string               `json:"location"`
	Unit        string               `json:"unit"` // "C" | "F"
	Temperature float64              `json:"temperature"`
	FeelsLike   float64              `json:"feelsLike"`
	Humidity    int                  `json:"humidity"`
	WindSpeed   float64              `json:"windSpeed"`
	Code        int                  `json:"code"`
	Condition   string               `json:"condition"`
	IsDay       bool                 `json:"isDay"`
	TempHigh    float64              `json:"tempHigh"`
	TempLow     float64              `json:"tempLow"`
	Hourly      []WeatherHourlyPoint `json:"hourly"`
	Daily       []WeatherDailyPoint  `json:"daily"`
	UpdatedAt   string               `json:"updatedAt"`
	Error       string               `json:"error,omitempty"`
}

type weatherNodeSettings struct {
	Location string `json:"location"`
	TempUnit string `json:"tempUnit"`
}

type geoCoords struct {
	Name      string
	Latitude  float64
	Longitude float64
}

// WeatherProvider polls Open-Meteo (zero API key required) for all `weather` widgets.
type WeatherProvider struct {
	db         *gorm.DB
	engine     *state.Engine
	httpClient *http.Client
	geoCache   sync.Map // map[string]geoCoords
	triggerCh  chan struct{}
}

func NewWeatherProvider(db *gorm.DB, engine *state.Engine) *WeatherProvider {
	return &WeatherProvider{
		db:     db,
		engine: engine,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
		triggerCh: make(chan struct{}, 1),
	}
}

func (p *WeatherProvider) Name() string {
	return "weather_openmeteo"
}

func (p *WeatherProvider) Initialize(ctx context.Context) error {
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

func (p *WeatherProvider) TriggerSync() {
	select {
	case p.triggerCh <- struct{}{}:
	default:
	}
}

func (p *WeatherProvider) Teardown(_ context.Context) error {
	return nil
}

func (p *WeatherProvider) Poll(ctx context.Context, emitter SignalEmitter) error {
	var weatherNodes []models.Node
	if err := p.db.WithContext(ctx).Where("node_type = ?", "weather").Find(&weatherNodes).Error; err != nil {
		return err
	}

	var wg sync.WaitGroup
	for _, node := range weatherNodes {
		wg.Add(1)
		go func(n models.Node) {
			defer wg.Done()
			p.syncSingleNode(ctx, n, emitter)
		}(node)
	}
	wg.Wait()
	return nil
}

func (p *WeatherProvider) syncSingleNode(ctx context.Context, node models.Node, emitter SignalEmitter) {
	var cfg weatherNodeSettings
	if len(node.Settings) > 0 {
		_ = json.Unmarshal(node.Settings, &cfg)
	}

	location := strings.TrimSpace(cfg.Location)
	if location == "" {
		location = strings.TrimSpace(node.Title)
	}
	if location == "" || strings.EqualFold(location, "Weather") {
		location = "Amsterdam"
	}

	unit := strings.ToUpper(strings.TrimSpace(cfg.TempUnit))
	if unit != "F" {
		unit = "C"
	}

	coords, err := p.geocodeCity(ctx, location)
	if err != nil {
		slog.Warn("Weather geocoding failed", "location", location, "error", err)
		emitter.EmitSignal(ctx, "weather:"+node.ID.String(), WeatherSignal{
			Location:  location,
			Unit:      unit,
			Condition: "Unavailable",
			Error:     err.Error(),
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	forecast, err := p.fetchForecast(ctx, coords, unit)
	if err != nil {
		slog.Warn("Weather forecast failed", "location", location, "error", err)
		emitter.EmitSignal(ctx, "weather:"+node.ID.String(), WeatherSignal{
			Location:  coords.Name,
			Unit:      unit,
			Condition: "Unavailable",
			Error:     err.Error(),
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	emitter.EmitSignal(ctx, "weather:"+node.ID.String(), forecast)
}

func (p *WeatherProvider) geocodeCity(ctx context.Context, query string) (geoCoords, error) {
	cacheKey := strings.ToLower(strings.TrimSpace(query))
	if val, ok := p.geoCache.Load(cacheKey); ok {
		return val.(geoCoords), nil
	}

	u := fmt.Sprintf("https://geocoding-api.open-meteo.com/v1/search?name=%s&count=1&language=en&format=json", url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return geoCoords{}, err
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return geoCoords{}, fmt.Errorf("geocoding network error")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return geoCoords{}, err
	}

	var parsed struct {
		Results []struct {
			Name      string  `json:"name"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Results) == 0 {
		return geoCoords{}, fmt.Errorf("city %q not found", query)
	}

	coords := geoCoords{
		Name:      parsed.Results[0].Name,
		Latitude:  parsed.Results[0].Latitude,
		Longitude: parsed.Results[0].Longitude,
	}
	p.geoCache.Store(cacheKey, coords)
	return coords, nil
}

func (p *WeatherProvider) fetchForecast(ctx context.Context, coords geoCoords, unit string) (WeatherSignal, error) {
	u := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5",
		coords.Latitude,
		coords.Longitude,
	)
	if unit == "F" {
		u += "&temperature_unit=fahrenheit&wind_speed_unit=mph"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return WeatherSignal{}, err
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return WeatherSignal{}, fmt.Errorf("weather forecast network error")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return WeatherSignal{}, fmt.Errorf("weather upstream HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return WeatherSignal{}, err
	}

	var data struct {
		Current struct {
			Time        string  `json:"time"`
			Temperature float64 `json:"temperature_2m"`
			Humidity    int     `json:"relative_humidity_2m"`
			FeelsLike   float64 `json:"apparent_temperature"`
			IsDay       int     `json:"is_day"`
			Code        int     `json:"weather_code"`
			WindSpeed   float64 `json:"wind_speed_10m"`
		} `json:"current"`
		Hourly struct {
			Time        []string  `json:"time"`
			Temperature []float64 `json:"temperature_2m"`
			Code        []int     `json:"weather_code"`
			IsDay       []int     `json:"is_day"`
		} `json:"hourly"`
		Daily struct {
			Time    []string  `json:"time"`
			Code    []int     `json:"weather_code"`
			TempMax []float64 `json:"temperature_2m_max"`
			TempMin []float64 `json:"temperature_2m_min"`
		} `json:"daily"`
	}

	if err := json.Unmarshal(body, &data); err != nil {
		return WeatherSignal{}, err
	}

	hourlyPoints := make([]WeatherHourlyPoint, 0, 6)
	currentHourPrefix := data.Current.Time
	if len(currentHourPrefix) >= 13 {
		currentHourPrefix = currentHourPrefix[:13]
	}
	for i := 0; i < len(data.Hourly.Time) && len(hourlyPoints) < 6; i++ {
		tStr := data.Hourly.Time[i]
		if len(tStr) < 16 {
			continue
		}
		if tStr[:13] < currentHourPrefix {
			continue
		}
		var temp float64
		if i < len(data.Hourly.Temperature) {
			temp = data.Hourly.Temperature[i]
		}
		var wCode int
		if i < len(data.Hourly.Code) {
			wCode = data.Hourly.Code[i]
		}
		isDay := true
		if i < len(data.Hourly.IsDay) {
			isDay = data.Hourly.IsDay[i] == 1
		}
		hourlyPoints = append(hourlyPoints, WeatherHourlyPoint{
			Time:        tStr[11:16],
			Temperature: temp,
			Code:        wCode,
			IsDay:       isDay,
		})
	}

	dailyPoints := make([]WeatherDailyPoint, 0, len(data.Daily.Time))
	for i := 0; i < len(data.Daily.Time); i++ {
		var wCode int
		if i < len(data.Daily.Code) {
			wCode = data.Daily.Code[i]
		}
		var tmax, tmin float64
		if i < len(data.Daily.TempMax) {
			tmax = data.Daily.TempMax[i]
		}
		if i < len(data.Daily.TempMin) {
			tmin = data.Daily.TempMin[i]
		}
		dailyPoints = append(dailyPoints, WeatherDailyPoint{
			Date:    data.Daily.Time[i],
			Code:    wCode,
			TempMax: tmax,
			TempMin: tmin,
		})
	}

	var high, low float64
	if len(dailyPoints) > 0 {
		high = dailyPoints[0].TempMax
		low = dailyPoints[0].TempMin
	}

	return WeatherSignal{
		Location:    coords.Name,
		Unit:        unit,
		Temperature: data.Current.Temperature,
		FeelsLike:   data.Current.FeelsLike,
		Humidity:    data.Current.Humidity,
		WindSpeed:   data.Current.WindSpeed,
		Code:        data.Current.Code,
		Condition:   wmoConditionLabel(data.Current.Code),
		IsDay:       data.Current.IsDay == 1,
		TempHigh:    high,
		TempLow:     low,
		Hourly:      hourlyPoints,
		Daily:       dailyPoints,
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func wmoConditionLabel(code int) string {
	switch {
	case code == 0:
		return "Clear"
	case code == 1:
		return "Mostly Clear"
	case code == 2:
		return "Partly Cloudy"
	case code == 3:
		return "Cloudy"
	case code == 45 || code == 48:
		return "Foggy"
	case code >= 51 && code <= 57:
		return "Drizzle"
	case code >= 61 && code <= 67:
		return "Rain"
	case code >= 71 && code <= 77:
		return "Snow"
	case code >= 80 && code <= 82:
		return "Showers"
	case code >= 85 && code <= 86:
		return "Snow Showers"
	case code >= 95:
		return "Thunderstorm"
	default:
		return "Fair"
	}
}
