package internal

import (
	"S3Browser/internal/handlers"
	"S3Browser/internal/modules/bucket"
	"S3Browser/internal/modules/global"
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
	sqlDb  *sql.DB
	app    *application.App

	BucketHandler  *handlers.BucketHandler
	MasterHandler  *handlers.MasterHandler
	ProfileHandler *handlers.ProfileHandler
}

// NewApp creates a new App application struct
func NewApp(app *application.App, cfg Config, logger *slog.Logger) *App {
	log := logger.With("component", "app")

	sqlDb := db.InitDB(app.Context(), cfg.Name)
	if err := db.RunMigrations(app.Context(), sqlDb); err != nil {
		if closeErr := sqlDb.Close(); closeErr != nil {
			log.Error("close db failed", "error", closeErr)
		}
		log.Error("failed to run migrations", "error", err)
		panic(err)
	}

	km, err := utils.NewKeyManager(cfg.Name)
	if err != nil {
		log.Error("generate key manager failed", "error", err)
		panic(err)
	}

	globalModule := global.NewModule()

	profileModule := profile.NewModule(app, logger, globalModule, sqlDb, km)
	bucketModule := bucket.NewModule(app, logger, globalModule, sqlDb, profileModule)
	masterModule := master.NewModule(app, logger, globalModule, sqlDb)

	profileHandler := handlers.NewProfileHandler(app, logger, profileModule)
	bucketHandler := handlers.NewBucketHandler(app, logger, bucketModule)
	masterHandler := handlers.NewMasterHandler(app, logger, masterModule)

	return &App{
		logger:         log,
		sqlDb:          sqlDb,
		app:            app,
		BucketHandler:  bucketHandler,
		MasterHandler:  masterHandler,
		ProfileHandler: profileHandler,
	}
}

// Clean up when shutting down the app
func (a *App) Shutdown() {
	a.BucketHandler.CancelAllDownloads()
	a.BucketHandler.CancelAllUploads()
	a.BucketHandler.DisconnectAll()
	a.app.Event.Reset()
	if a.sqlDb != nil {
		if err := a.sqlDb.Close(); err != nil {
			a.logger.Error("close db failed", "error", err)
		}
	}
}
