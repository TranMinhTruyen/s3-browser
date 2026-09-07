package main

import (
	"S3Browser/internal"
	"S3Browser/internal/pkg/logger"
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed all:wails.json
var wailsConfigJSON []byte

func main() {
	// Create an instance of the app structure
	cfg := internal.ParseConfig(wailsConfigJSON)

	appLogger, closer, err := logger.Setup(logger.Config{
		AppName: cfg.Name,
	})
	if err != nil {
		log.Fatalf("create an instance logger error: %v", err)
	}
	defer closer.Close()

	mainApp := application.New(application.Options{
		Name: cfg.Name,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Logger: appLogger,
	})

	app := internal.NewApp(mainApp, cfg, appLogger)
	mainApp.OnShutdown(app.Shutdown)
	mainApp.RegisterService(application.NewService(app.BucketHandler.BucketIPC()))

	if err := app.Startup(mainApp.Context()); err != nil {
		log.Fatalf("app startup failed: %v", err)
	}

	mainApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:                  cfg.Name,
		MinWidth:               1024,
		MinHeight:              768,
		StartState:             application.WindowStateMaximised,
		BackgroundColour:       application.NewRGBA(27, 38, 54, 1),
		OpenInspectorOnStartup: DevMode,
	})

	if err := mainApp.Run(); err != nil {
		println("error:", err.Error())
	}
}
