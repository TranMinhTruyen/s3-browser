package profile

import (
	"context"
	"database/sql"
	"encoding/base64"
	"log/slog"
	"testing"

	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/utils"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/zalando/go-keyring"
	_ "modernc.org/sqlite"
)

// newTestModule builds a profile Module on a migrated in-memory SQLite database and a mock keyring.
func newTestModule(t *testing.T) (*Module, *sql.DB) {
	t.Helper()
	keyring.MockInit()
	km, err := utils.NewKeyManager()
	if err != nil {
		t.Fatalf("NewKeyManager: %v", err)
	}
	return newTestModuleWithKM(t, km)
}

// newBrokenKeyManager returns a KeyManager whose key has an invalid AES length, so Encrypt/Decrypt fail.
func newBrokenKeyManager(t *testing.T) *utils.KeyManager {
	t.Helper()
	keyring.MockInit()
	bad := base64.StdEncoding.EncodeToString([]byte("short"))
	if err := keyring.Set("S3Browser", "db-encryption-key", bad); err != nil {
		t.Fatalf("keyring set: %v", err)
	}
	km, err := utils.NewKeyManager()
	if err != nil {
		t.Fatalf("NewKeyManager: %v", err)
	}
	return km
}

func newTestModuleWithKM(t *testing.T, km *utils.KeyManager) (*Module, *sql.DB) {
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
	return NewModule(app, slog.Default(), global.NewModule(), sqlDB, km), sqlDB
}

func mustExec(t *testing.T, sqlDB *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := sqlDB.Exec(query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}
