package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"log/slog"

	"github.com/pressly/goose/v3"
)

//go:embed all:schemas/*.sql
var schemasFS embed.FS

type gooseSlogLogger struct{}

func (gooseSlogLogger) Printf(format string, v ...interface{}) {
	slog.Info("goose: " + fmt.Sprintf(format, v...))
}

func (gooseSlogLogger) Fatalf(format string, v ...interface{}) {
	slog.Error("goose: " + fmt.Sprintf(format, v...))
}

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

	if err := goose.UpContext(ctx, sqlDB, "schemas"); err != nil {
		return fmt.Errorf("run migrations: %w", err)
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
