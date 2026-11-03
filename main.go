// Command S3Browser is a desktop S3/MinIO browser built on Wails v3.
package main

import (
	"S3Browser/internal"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/logger"
	"S3Browser/internal/pkg/portable"
	"embed"
	"errors"
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// assets is the built frontend served to the webview.
//
//go:embed all:frontend/dist
var assets embed.FS

// wailsConfigJSON is read back at runtime so wails.json stays the single source of the app name.
//
//go:embed all:wails.json
var wailsConfigJSON []byte

// portableWindowsOptions points WebView2 at the runtime shipped next to the exe and keeps its profile in data/,
// so the app writes nothing to %APPDATA%.
func portableWindowsOptions(appName string) (application.WindowsOptions, error) {
	webviewDir, err := portable.WebView2Dir()
	if err != nil {
		return application.WindowsOptions{}, err
	}
	dataDir, err := portable.DataDir(appName)
	if err != nil {
		return application.WindowsOptions{}, err
	}
	return application.WindowsOptions{
		WebviewBrowserPath:  webviewDir,
		WebviewUserDataPath: filepath.Join(dataDir, "webview"),
	}, nil
}

// backgroundColour is the native window background for the saved theme, so the window does not flash the wrong
// colour before the page renders. "auto" follows the OS scheme (osDark, see osDarkMode).
func backgroundColour(theme string, osDark bool) application.RGBA {
	if theme == "dark" || (theme == "auto" && osDark) {
		return application.NewRGBA(36, 36, 36, 255)
	}
	return application.NewRGBA(255, 255, 255, 255)
}

// startupErrorMessage explains a database startup failure by stage: a failed backup left the database untouched,
// a failed migration was rolled back and the error text names the backup file.
func startupErrorMessage(err error) string {
	switch {
	case errors.Is(err, db.ErrBackupFailed):
		return "The database backup before the upgrade failed, so the upgrade was not run " +
			"and your data was not changed.\n\n" + err.Error()
	case errors.Is(err, db.ErrMigrateFailed):
		return "The database upgrade failed and was rolled back. " +
			"Your data is kept in the backup file named below.\n\n" + err.Error()
	}
	return "The database could not be opened.\n\n" + err.Error()
}

// main wires logger, app, handlers and the main window, then runs the Wails event loop.
func main() {
	cfg := internal.ParseConfig(wailsConfigJSON)

	appLogger, closer, err := logger.Setup(logger.Config{
		AppName: cfg.Name,
	})
	if err != nil {
		log.Fatalf("create an instance logger error: %v", err)
	}
	defer closer.Close()

	options := application.Options{
		Name: cfg.Name,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Logger: appLogger,
	}
	if portable.Enabled {
		options.Windows, err = portableWindowsOptions(cfg.Name)
		if err != nil {
			log.Fatalf("resolve portable paths error: %v", err)
		}
	}
	mainApp := application.New(options)

	app, err := internal.NewApp(mainApp, cfg, appLogger)
	if err != nil {
		// Native dialogs only work once the app runs, so show the error from ApplicationStarted, then quit.
		mainApp.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			mainApp.Dialog.Error().SetTitle(cfg.Name).SetMessage(startupErrorMessage(err)).Show()
			mainApp.Quit()
		})
		if runErr := mainApp.Run(); runErr != nil {
			println("error:", runErr.Error())
		}
		return
	}
	mainApp.OnShutdown(app.Shutdown)
	mainApp.RegisterService(application.NewService(app.BucketHandler))
	mainApp.RegisterService(application.NewService(app.MasterHandler))
	mainApp.RegisterService(application.NewService(app.ProfileHandler))
	mainApp.RegisterService(application.NewService(app.SettingHandler))

	theme := app.SettingHandler.GetSettings().Body.Settings.Theme
	mainWindow := mainApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:                  cfg.Name,
		MinWidth:               1024,
		MinHeight:              768,
		Frameless:              true,
		StartState:             application.WindowStateMaximised,
		BackgroundColour:       backgroundColour(theme, osDarkMode()),
		OpenInspectorOnStartup: DevMode,
		EnableFileDrop:         true,
	})
	// Files dropped on an element with data-file-drop-target arrive here, with their full paths.
	mainWindow.OnWindowEvent(events.Common.WindowFilesDropped, app.BucketHandler.FilesDropped)

	if err := mainApp.Run(); err != nil {
		println("error:", err.Error())
	}
}
