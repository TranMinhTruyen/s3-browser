package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/pressly/goose/v3"
)

//go:embed all:schemas/*.sql
var schemasFS embed.FS

var (
	// ErrBackupFailed means the backup before migrating failed: the database was not touched.
	ErrBackupFailed = errors.New("backup before migration failed")

	// ErrMigrateFailed means a migration failed and was rolled back; the error text names the backup file.
	ErrMigrateFailed = errors.New("run migrations failed")
)

// gooseSlogLogger routes goose output to slog.
type gooseSlogLogger struct{}

func (gooseSlogLogger) Printf(format string, v ...interface{}) {
	slog.Info("goose: " + fmt.Sprintf(format, v...))
}

func (gooseSlogLogger) Fatalf(format string, v ...interface{}) {
	slog.Error("goose: " + fmt.Sprintf(format, v...))
}

// RunMigrations applies the embedded schemas/*.sql migrations and logs when the version changes.
func RunMigrations(ctx context.Context, sqlDB *sql.DB) error {
	goose.SetBaseFS(schemasFS)
	goose.SetLogger(gooseSlogLogger{})

	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}

	before, err := goose.GetDBVersion(sqlDB)
	if err != nil {
		return fmt.Errorf("get db version: %w", err)
	}

	backupPath, err := backupBeforeMigrate(ctx, sqlDB, before)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrBackupFailed, err)
	}

	if err := goose.UpContext(ctx, sqlDB, "schemas"); err != nil {
		// goose already rolled the failed migration back; the backup is the user's way out.
		slog.Error("migration failed, database rolled back", "backup", backupPath, "error", err)
		return fmt.Errorf("%w (backup: %q): %w", ErrMigrateFailed, backupPath, err)
	}

	after, err := goose.GetDBVersion(sqlDB)
	if err != nil {
		return fmt.Errorf("get db version after migrate: %w", err)
	}

	if after != before {
		slog.Info("database migrated", "from", before, "to", after)
	}
	return nil
}

// backupBeforeMigrate writes <db>.bak-<yyyyMMdd-HHmmss> when migrations newer than version are pending
// and the database already holds data (version > 0). It returns "" when no backup was needed.
// VACUUM INTO gives a consistent copy even while the WAL holds unflushed pages.
func backupBeforeMigrate(ctx context.Context, sqlDB *sql.DB, version int64) (string, error) {
	if version == 0 {
		return "", nil
	}
	pending, err := goose.CollectMigrations("schemas", version, math.MaxInt64)
	// goose reports "no migration files" when none is newer than version, i.e. nothing is pending.
	if errors.Is(err, goose.ErrNoMigrationFiles) || (err == nil && len(pending) == 0) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("collect pending migrations: %w", err)
	}

	var dbPath string
	row := sqlDB.QueryRowContext(ctx, "SELECT file FROM pragma_database_list WHERE name = 'main'")
	if err := row.Scan(&dbPath); err != nil || dbPath == "" {
		return "", fmt.Errorf("locate db file for backup: %w", err)
	}

	backupPath := dbPath + ".bak-" + time.Now().Format("20060102-150405")
	if _, err := sqlDB.ExecContext(ctx, "VACUUM INTO ?", backupPath); err != nil {
		return "", fmt.Errorf("backup db before migrate: %w", err)
	}
	slog.Info("database backed up before migrate", "backup", backupPath)
	return backupPath, nil
}
