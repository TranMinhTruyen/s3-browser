// Package db opens the SQLite database and runs the goose migrations.
package db

import (
	"S3Browser/internal/pkg/portable"
	"context"
	"database/sql"
	"log"
	"path/filepath"

	// Registers the pure-Go "sqlite" database/sql driver (modernc).
	_ "modernc.org/sqlite"
)

// InitDB opens <data dir>/data.db (WAL, foreign keys on) and pings it.
// It exits the process on failure: nothing in the app works without the database.
// The backup before a migration is made by RunMigrations.
func InitDB(ctx context.Context, appName string) *sql.DB {
	appDir, err := portable.DataDir(appName)
	if err != nil {
		log.Fatalf("failed to get app data dir: %v", err)
	}

	dbPath := filepath.Join(appDir, "data.db")

	dsn := dbPath +
		"?_pragma=foreign_keys(1)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("failed to open db at %s: %v", dbPath, err)
	}

	// One connection avoids SQLITE_BUSY between concurrent writers.
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close() // already failing; the ping error is the one worth reporting
		log.Fatalf("ping db: %s", err)
	}

	return db
}
