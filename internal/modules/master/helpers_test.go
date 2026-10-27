package master

import (
	"context"
	"database/sql"
	"log/slog"
	"testing"

	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/db"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

// newTestModule builds a master Module on a migrated in-memory SQLite database.
func newTestModule(t *testing.T) (*Module, *sql.DB) {
	t.Helper()
	sqlDB, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.RunMigrations(context.Background(), sqlDB); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	app := application.New(application.Options{})
	return NewModule(app, slog.Default(), global.NewModule(), sqlDB), sqlDB
}
