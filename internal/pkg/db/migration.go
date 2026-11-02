package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
)

//go:embed all:schemas/*.sql
var schemasFS embed.FS

const (
	// backupTimeLayout is the suffix of <db>.bak-<suffix> (UTC, so DST changes keep the order): fixed width, so names
	// sort by time. Stage 1 wrote local time; the two only differ by the offset, so old names still sort first.
	backupTimeLayout = "20060102-150405.000"

	// backupsToKeep is how many <db>.bak-* files stay after a new backup.
	backupsToKeep = 3
)

var (
	// backupSuffixPattern matches the suffix of the backups of this app (the second-only layout of
	// sprint 11 stage 1 too).
	backupSuffixPattern = regexp.MustCompile(`^\d{8}-\d{6}(\.\d{3})?$`)

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

	// Milliseconds keep two backups made in the same second from clashing (VACUUM INTO fails on an existing file).
	backupPath := dbPath + ".bak-" + time.Now().UTC().Format(backupTimeLayout)
	if _, err := sqlDB.ExecContext(ctx, "VACUUM INTO ?", backupPath); err != nil {
		return "", fmt.Errorf("backup db before migrate: %w", err)
	}
	slog.Info("database backed up before migrate", "backup", backupPath)
	pruneBackups(dbPath, backupsToKeep)
	return backupPath, nil
}

// pruneBackups deletes the oldest <dbPath>.bak-<timestamp> files, keeping the newest keep. "Oldest" is by file
// modification time, not by name, because older versions named backups in local time and newer ones in UTC. Only
// names this app writes are matched, so other files (e.g. an old <dbPath>.bak) are never touched. A failure is only
// logged: leftover backups are harmless.
func pruneBackups(dbPath string, keep int) {
	dir, prefix := filepath.Dir(dbPath), filepath.Base(dbPath)+".bak-"
	entries, err := os.ReadDir(dir)
	if err != nil {
		slog.Warn("list old backups failed", "error", err)
		return
	}

	type backup struct {
		name    string
		modTime time.Time
	}
	var backups []backup
	for _, e := range entries {
		suffix, ok := strings.CutPrefix(e.Name(), prefix)
		if !ok || !backupSuffixPattern.MatchString(suffix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			slog.Warn("stat old backup failed", "backup", e.Name(), "error", err)
			continue
		}
		backups = append(backups, backup{e.Name(), info.ModTime()})
	}
	if len(backups) <= keep {
		return
	}

	sort.Slice(backups, func(i, j int) bool {
		if !backups[i].modTime.Equal(backups[j].modTime) {
			return backups[i].modTime.Before(backups[j].modTime)
		}
		return backups[i].name < backups[j].name
	})
	for _, b := range backups[:len(backups)-keep] {
		if err := os.Remove(filepath.Join(dir, b.name)); err != nil {
			slog.Warn("remove old backup failed", "backup", b.name, "error", err)
		}
	}
}
