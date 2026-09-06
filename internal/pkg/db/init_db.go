package db

import (
	"context"
	"database/sql"
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
		db.Close()
		log.Fatalf("ping db: %s", err)
	}

	return db
}

func backupIfExists(path string) error {
	src, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open db for backup: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(path + ".bak")
	if err != nil {
		return fmt.Errorf("create backup: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copy backup: %w", err)
	}
	return dst.Sync()
}
