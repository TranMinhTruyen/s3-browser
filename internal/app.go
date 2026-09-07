package internal

import (
	"S3Browser/internal/handlers"
	"S3Browser/internal/modules/bucket"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/utils"
	"context"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App struct
type App struct {
	logger *slog.Logger
	cfg    Config
	sqlDb  *sql.DB
	app    *application.App

	profileModule *profile.Module
	bucketModule  *bucket.Module

	BucketHandler *handlers.BucketHandler
}

// NewApp creates a new App application struct
func NewApp(app *application.App, cfg Config, logger *slog.Logger) *App {
	profileModule := profile.NewModule(app, logger)
	bucketModule := bucket.NewModule(app, logger, profileModule)

	bucketHandler := handlers.NewHandler(app, logger, bucketModule)

	return &App{
		logger: logger.With("component", "app"),
		cfg:    cfg,
		app:    app,

		profileModule: profileModule,
		bucketModule:  bucketModule,

		BucketHandler: bucketHandler,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) Startup(ctx context.Context) error {
	km, err := utils.NewKeyManager()
	if err != nil {
		a.logger.Error("generate key manager failed", "error", err)
		return err
	}

	sqlDb := db.InitDB(ctx, a.cfg.Name)
	if err := db.RunMigrations(ctx, sqlDb); err != nil {
		sqlDb.Close()
		a.logger.Error("failed to run migrations", "error", err)
		return err
	}
	a.sqlDb = sqlDb

	a.profileModule.Startup(ctx, sqlDb, km)
	a.bucketModule.Startup(ctx)

	a.BucketHandler.Startup(ctx)
	return nil
}

// Clean up when shutdow app
func (a *App) Shutdown() {
	a.bucketModule.DisconnectAll()
	a.app.Event.Reset()
	if a.sqlDb != nil {
		if err := a.sqlDb.Close(); err != nil {
			a.logger.Error("close db failed", "error", err)
		}
	}
}
