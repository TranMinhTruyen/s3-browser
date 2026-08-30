package main

import (
	"context"
	"minio-browser/internal/modules/bucket"
	"minio-browser/internal/modules/handlers"
	"minio-browser/internal/pkg/db"
)

// App struct
type App struct {
	bucket   *bucket.Module
	handlers *handlers.Module
}

// NewApp creates a new App application struct
func NewApp(cfg wailsConfig) *App {
	bucket := bucket.NewModule()
	handlers := handlers.NewModule(bucket)

	sqlDb := db.InitDB(cfg.Name)
	db.RunMigrations(sqlDb)

	return &App{
		handlers: handlers,
		bucket:   bucket,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.bucket.Startup(ctx)
	a.handlers.Startup(ctx)
}

// Clean up when shutdow app
func (a *App) shutdown(ctx context.Context) {
	a.bucket.DisconnectAll()
}
