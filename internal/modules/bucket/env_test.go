package bucket

import (
	"context"
	"database/sql"
	"testing"

	"S3Browser/internal/pkg/db"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

// newTestApp builds a headless Wails app (no window is opened until Run is called).
func newTestApp(t *testing.T) *application.App {
	t.Helper()
	return application.New(application.Options{})
}

// newTestDB returns a migrated in-memory SQLite database.
func newTestDB(t *testing.T) *sql.DB {
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
	return sqlDB
}

// TestEnv verifies the test helpers: a second Wails app, the event bus, the mock keyring and a migrated DB.
func TestEnv(t *testing.T) {
	app := newTestApp(t)
	if app.Context() == nil || newTestApp(t).Context() == nil {
		t.Fatal("app.Context() is nil")
	}
	app.Event.Emit("env:event", "payload")

	if mustKeyManager(t) == nil {
		t.Fatal("nil KeyManager")
	}

	var n int
	if err := newTestDB(t).QueryRow("SELECT COUNT(*) FROM sqlite_master").Scan(&n); err != nil || n == 0 {
		t.Fatalf("schema missing: n=%d err=%v", n, err)
	}
}
