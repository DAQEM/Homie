package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"homie/internal/api"
	"homie/internal/auth"
	"homie/internal/crypto"
	"homie/internal/database"
	"homie/internal/integrations"
	"homie/internal/state"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

//go:embed all:frontend/dist
var frontendEmbedFS embed.FS

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL environment variable is required")
		os.Exit(1)
	}

	bindAddr := os.Getenv("BIND_ADDR")
	if bindAddr == "" {
		bindAddr = "0.0.0.0:8080"
	}

	masterKey := os.Getenv("MASTER_ENCRYPTION_KEY")
	if masterKey == "" {
		masterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	}

	envelopeCipher, err := crypto.NewEnvelopeCipher(masterKey)
	if err != nil {
		slog.Error("Failed to initialize AES-256-GCM envelope cipher", "error", err)
		os.Exit(1)
	}

	// 1. Connect to PostgreSQL via GORM
	db, err := database.Connect(dbURL)
	if err != nil {
		slog.Error("Database connection failed", "error", err)
		os.Exit(1)
	}

	// 2. Run embedded SQL migrations automatically before starting listener
	if err := database.RunMigrations(db, migrationsFS); err != nil {
		slog.Error("Database migration failed", "error", err)
		os.Exit(1)
	}

	// 3. Initialize Per-User State Engine & Auth Session Manager
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	authCfg := auth.LoadConfigFromEnv(masterKey)
	oidcClient := auth.NewOIDCClient(authCfg)
	sessionMgr := auth.NewSessionManager(db, envelopeCipher, authCfg, oidcClient)
	sessionMgr.StartCleanupLoop(ctx)

	if authCfg.Enabled {
		slog.Info("OIDC authentication enabled", "provider", authCfg.ProviderName, "issuer", authCfg.IssuerURL)
		go func() {
			discCtx, discCancel := context.WithTimeout(ctx, 8*time.Second)
			defer discCancel()
			if _, err := oidcClient.GetDiscovery(discCtx); err != nil {
				slog.Warn("Initial OIDC discovery deferred (will retry on first login)", "error", err)
			}
		}()
	} else {
		slog.Info("OIDC_ISSUER_URL not set; running in local single-user mode")
	}

	stateEngine := state.NewEngine(db)
	if !authCfg.Enabled {
		if err := stateEngine.RebuildSnapshot(ctx, auth.LocalDefaultUserID); err != nil {
			slog.Error("Failed to build initial local state snapshot", "error", err)
			os.Exit(1)
		}
	}

	// 4. Spawn supervised background integration workers
	integrations.SpawnSupervised(ctx, integrations.NewHelloWorldProvider(), stateEngine, 5*time.Second)

	calendarProvider := integrations.NewCalendarProvider(db, stateEngine)
	integrations.SpawnSupervised(ctx, calendarProvider, stateEngine, 2*time.Minute)

	vikunjaProvider := integrations.NewVikunjaProvider(db, stateEngine, envelopeCipher)
	integrations.SpawnSupervised(ctx, vikunjaProvider, stateEngine, 20*time.Second)

	healthProvider := integrations.NewHealthCheckProvider(db, stateEngine)
	integrations.SpawnSupervised(ctx, healthProvider, stateEngine, 30*time.Second)

	weatherProvider := integrations.NewWeatherProvider(db, stateEngine)
	integrations.SpawnSupervised(ctx, weatherProvider, stateEngine, 10*time.Minute)

	// 5. Mount embedded frontend SPA assets and HTTP router
	distFS, err := fs.Sub(frontendEmbedFS, "frontend/dist")
	if err != nil {
		slog.Error("Failed to mount embedded frontend/dist directory", "error", err)
		os.Exit(1)
	}

	router := api.NewRouter(
		db,
		stateEngine,
		envelopeCipher,
		sessionMgr,
		oidcClient,
		calendarProvider,
		vikunjaProvider,
		healthProvider,
		weatherProvider,
		distFS,
	)
	srv := &http.Server{
		Addr:              bindAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("Homie (Go + GORM) listening", "addr", bindAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("Shutting down Homie gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}
