package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func InitDB(ctx context.Context, appName string) *sql.DB {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("failed to get user config dir: %v", err)
	}

	appDir := filepath.Join(configDir, appName)
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		log.Fatalf("failed to create app dir %s: %v", appDir, err)
	}

	dbPath := filepath.Join(appDir, "data.db")

	if err := backupIfExists(dbPath); err != nil {
		log.Fatalf("%s", err.Error())
	}

	dsn := dbPath +
		"?_pragma=foreign_keys(1)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("failed to open db at %s: %v", dbPath, err)
	}

	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close() // already failing; the ping error is the one worth reporting
		log.Fatalf("ping db: %s", err)
	}

	return db
}

func backupIfExists(path string) (err error) {
	src, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open db for backup: %w", err)
	}
	defer func() { _ = src.Close() }() // read-only file: close error is harmless

	dst, err := os.Create(path + ".bak")
	if err != nil {
		return fmt.Errorf("create backup: %w", err)
	}
	defer func() {
		// a failed Close on a written file may mean lost data, so surface it
		if closeErr := dst.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close backup: %w", closeErr))
		}
	}()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copy backup: %w", err)
	}
	return dst.Sync()
}
