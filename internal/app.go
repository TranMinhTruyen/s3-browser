package internal

import (
	"context"
	"database/sql"
	"log/slog"
	"minio-browser/internal/handlers"
	"minio-browser/internal/modules/bucket"
	"minio-browser/internal/modules/profile"
	"minio-browser/internal/pkg/db"
	"minio-browser/internal/pkg/utils"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	logger *slog.Logger
	cfg    Config
	sqlDb  *sql.DB

	profileModule *profile.Module
	bucketModule  *bucket.Module

	bucketHandler *handlers.BucketHandler
}

// NewApp creates a new App application struct
func NewApp(cfg Config, logger *slog.Logger) *App {
	profileModule := profile.NewModule(logger)
	bucketModule := bucket.NewModule(logger, profileModule)
	bucketHandler := handlers.NewHandler(logger, bucketModule)

	return &App{
		logger: logger.With("component", "app"),
		cfg:    cfg,

		profileModule: profileModule,
		bucketModule:  bucketModule,
		bucketHandler: bucketHandler,
	}
}

func (a *App) GetIPC() []any {
	return []any{
		a.bucketHandler.BucketIPC(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) Startup(ctx context.Context) {
	km, err := utils.NewKeyManager()
	if err != nil {
		a.logger.Error("generate key manager failed", "error", err)
		panic(err)
	}

	sqlDb := db.InitDB(ctx, a.cfg.Name)
	if err := db.RunMigrations(ctx, sqlDb); err != nil {
		sqlDb.Close()
		a.logger.Error("failed to run migrations", "error", err)
		panic(err)
	}
	a.sqlDb = sqlDb

	a.profileModule.Startup(ctx, sqlDb, km)
	a.bucketModule.Startup(ctx)

	a.bucketHandler.Startup(ctx)
}

// Clean up when shutdow app
func (a *App) Shutdown(ctx context.Context) {
	a.bucketModule.DisconnectAll()
	wruntime.EventsOffAll(ctx)
	if a.sqlDb != nil {
		if err := a.sqlDb.Close(); err != nil {
			a.logger.Error("close db failed", "error", err)
		}
	}
}
