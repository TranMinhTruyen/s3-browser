package internal

import (
	"S3Browser/internal/handlers"
	"S3Browser/internal/modules/bucket"
	"S3Browser/internal/modules/master"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/utils"
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

	BucketHandler *handlers.BucketHandler
	MasterHandler *handlers.MasterHandler
}

// NewApp creates a new App application struct
func NewApp(app *application.App, cfg Config, logger *slog.Logger) *App {
	log := logger.With("component", "app")

	sqlDb := db.InitDB(app.Context(), cfg.Name)
	if err := db.RunMigrations(app.Context(), sqlDb); err != nil {
		sqlDb.Close()
		log.Error("failed to run migrations", "error", err)
		panic(err)
	}

	km, err := utils.NewKeyManager()
	if err != nil {
		log.Error("generate key manager failed", "error", err)
		panic(err)
	}

	profileModule := profile.NewModule(app, logger, sqlDb, km)
	bucketModule := bucket.NewModule(app, logger, profileModule)
	masterModule := master.NewModule(app, logger, sqlDb)

	bucketHandler := handlers.NewBucketHandler(app, logger, bucketModule)
	masterHandler := handlers.NewMasterHandler(app, logger, masterModule)

	return &App{
		logger: log,
		cfg:    cfg,
		app:    app,
		sqlDb:  sqlDb,

		BucketHandler: bucketHandler,
		MasterHandler: masterHandler,
	}
}

// Clean up when shutdow app
func (a *App) Shutdown() {
	a.BucketHandler.DisconnectAll()
	a.app.Event.Reset()
	if a.sqlDb != nil {
		if err := a.sqlDb.Close(); err != nil {
			a.logger.Error("close db failed", "error", err)
		}
	}
}
