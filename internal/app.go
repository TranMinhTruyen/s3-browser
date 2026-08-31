package internal

import (
	"context"
	"log/slog"
	"minio-browser/internal/handlers"
	"minio-browser/internal/modules/bucket"
	"minio-browser/internal/modules/profile"
	"minio-browser/internal/pkg/db"
	"minio-browser/internal/pkg/utils"
)

// App struct
type App struct {
	BucketHandler *handlers.BucketHandler
}

// NewApp creates a new App application struct
func NewApp(cfg Config, logger *slog.Logger, km *utils.KeyManager) *App {
	log := logger.With("component", "app")

	sqlDb := db.InitDB(cfg.Name)
	if err := db.RunMigrations(sqlDb); err != nil {
		log.Error("failed to run migrations", "error", err)
		panic(err)
	}

	profileModule := profile.NewModule(sqlDb, log, km)
	bucketModule := bucket.NewModule(log, profileModule)

	bucketHandler := handlers.NewHandler(log, bucketModule)

	return &App{
		BucketHandler: bucketHandler,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) Startup(ctx context.Context) {
	a.BucketHandler.Startup(ctx)
}

// Clean up when shutdow app
func (a *App) Shutdown(ctx context.Context) {
	a.BucketHandler.API().DisconnectAll()
}
