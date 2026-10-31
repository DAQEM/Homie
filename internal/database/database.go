package database

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Connect initializes GORM over pgx and configures the underlying connection pool.
func Connect(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres via GORM: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to access underlying sql.DB: %w", err)
	}

	sqlDB.SetMaxIdleConns(4)
	sqlDB.SetMaxOpenConns(16)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	return db, nil
}

// RunMigrations executes embedded SQL files in lexical order before the HTTP listener starts.
func RunMigrations(db *gorm.DB, migrationsFS embed.FS) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	_, err = sqlDB.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("failed to read embedded migrations directory: %w", err)
	}

	var filenames []string
	for _, entry := range entries {
		if !entry.IsDir() {
			filenames = append(filenames, entry.Name())
		}
	}
	sort.Strings(filenames)

	for _, name := range filenames {
		var exists bool
		err := sqlDB.QueryRow(`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, name).Scan(&exists)
		if err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("failed checking migration %s: %w", name, err)
		}
		if exists {
			continue
		}

		slog.Info("Applying database migration", "file", name)
		content, err := fs.ReadFile(migrationsFS, "migrations/"+name)
		if err != nil {
			return fmt.Errorf("failed reading migration %s: %w", name, err)
		}

		tx, err := sqlDB.Begin()
		if err != nil {
			return err
		}

		if _, err := tx.Exec(string(content)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed executing migration %s: %w", name, err)
		}

		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed recording migration %s: %w", name, err)
		}

		if err := tx.Commit(); err != nil {
			return err
		}
	}

	return nil
}
