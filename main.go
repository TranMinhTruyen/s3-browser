package main

import (
	"embed"
	"log"
	"minio-browser/internal"
	"minio-browser/internal/pkg/logger"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
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

	app := internal.NewApp(cfg, appLogger)

	// Create application with options
	err = wails.Run(&options.App{
		Title:            cfg.Name,
		MinWidth:         1024,
		MinHeight:        768,
		WindowStartState: options.Maximised,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.Startup,
		Logger:           logger.NewWailsAdapter(appLogger),
		OnShutdown:       app.Shutdown,
		Debug: options.Debug{
			OpenInspectorOnStartup: true,
		},
		Bind: app.GetIPC(),
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
