// Package internal wires the modules and handlers of the app together.
package internal

import (
	"S3Browser/internal/handlers"
	"S3Browser/internal/modules/bucket"
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/master"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/utils"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App owns the handlers registered as Wails services and the resources released on shutdown.
type App struct {
	logger *slog.Logger
	sqlDb  *sql.DB
	app    *application.App

	BucketHandler  *handlers.BucketHandler
	MasterHandler  *handlers.MasterHandler
	ProfileHandler *handlers.ProfileHandler
	SettingHandler *handlers.SettingHandler
}

// NewApp opens and migrates the database, builds the modules, then the handlers on top of them.
// A failed migration is returned as an error (the message holds the backup path) so main can tell the user;
// it panics when the encryption key is unusable, because the app cannot run without it.
func NewApp(app *application.App, cfg Config, logger *slog.Logger) (*App, error) {
	log := logger.With("component", "app")

	sqlDb := db.InitDB(app.Context(), cfg.Name)
	if err := db.RunMigrations(app.Context(), sqlDb); err != nil {
		if closeErr := sqlDb.Close(); closeErr != nil {
			log.Error("close db failed", "error", closeErr)
		}
		log.Error("failed to run migrations", "error", err)
		return nil, err
	}

	km, err := utils.NewKeyManager(cfg.Name)
	if err != nil {
		log.Error("generate key manager failed", "error", err)
		panic(err)
	}

	globalModule := global.NewModule()

	profileModule := profile.NewModule(app, logger, globalModule, sqlDb, km)
	bucketModule := bucket.NewModule(app, logger, globalModule, sqlDb, profileModule)
	masterModule := master.NewModule(app, logger, sqlDb)
	settingModule := setting.NewModule(logger, cfg.Name)

	profileHandler := handlers.NewProfileHandler(profileModule)
	bucketHandler := handlers.NewBucketHandler(bucketModule)
	masterHandler := handlers.NewMasterHandler(masterModule)
	settingHandler := handlers.NewSettingHandler(settingModule)

	return &App{
		logger:         log,
		sqlDb:          sqlDb,
		app:            app,
		BucketHandler:  bucketHandler,
		MasterHandler:  masterHandler,
		ProfileHandler: profileHandler,
		SettingHandler: settingHandler,
	}, nil
}

// Shutdown cancels running transfers, closes every connection and the database.
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
