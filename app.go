package main

import (
	"context"
	"minio-browser/internal/transfer"
)

// App struct
type App struct {
	ctx      context.Context
	transfer *transfer.Module
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		transfer: transfer.NewModule(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	a.transfer.Startup(ctx)
}

// Clean up when shutdow app
func (a *App) shutdown(ctx context.Context) {}
