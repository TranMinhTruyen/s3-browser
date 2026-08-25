package main

import (
	"context"
	"minio-browser/internal/modules/bucket"
	"minio-browser/internal/modules/transfer"
)

// App struct
type App struct {
	bucket   *bucket.Module
	transfer *transfer.Module
}

// NewApp creates a new App application struct
func NewApp() *App {
	bucket := bucket.NewModule()
	transfer := transfer.NewModule(bucket)

	return &App{
		transfer: transfer,
		bucket:   bucket,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.bucket.Startup(ctx)
	a.transfer.Startup(ctx)
}

// Clean up when shutdow app
func (a *App) shutdown(ctx context.Context) {}
