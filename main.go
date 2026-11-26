// Command S3Browser là ứng dụng desktop duyệt S3/MinIO được xây dựng trên Wails v3.
package main

import (
	"S3Browser/internal"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/logger"
	"S3Browser/internal/pkg/memprobe"
	"S3Browser/internal/pkg/portable"
	"embed"
	"errors"
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"go.yaml.in/yaml/v3"
)

// assets là frontend đã build, được phục vụ cho webview.
//
//go:embed all:frontend/dist
var assets embed.FS

// wailsConfigJSON được đọc lại lúc chạy để wails.json tiếp tục là nguồn duy nhất của tên ứng dụng.
//
//go:embed all:wails.json
var wailsConfigJSON []byte

// buildConfigYAML được đọc lại lúc chạy để build/config.yml tiếp tục là nguồn duy nhất của phiên bản ứng dụng.
//
//go:embed build/config.yml
var buildConfigYAML []byte

// appVersion trả info.version trong build/config.yml hoặc "" nếu không phân tích được file.
func appVersion(raw []byte) string {
	var cfg struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	_ = yaml.Unmarshal(raw, &cfg) // on error the version stays empty, which turns the updater off
	return cfg.Info.Version
}

// portableWindowsOptions trỏ WebView2 đến runtime đi kèm exe và lưu hồ sơ trong data/,
// nhờ đó ứng dụng không ghi dữ liệu vào %APPDATA%.
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

// backgroundColour là màu nền native của cửa sổ theo giao diện đã lưu để cửa sổ không nháy sai màu trước khi trang hiển thị.
// "auto" theo giao diện hệ điều hành (osDark, xem osDarkMode).
func backgroundColour(theme string, osDark bool) application.RGBA {
	if theme == "dark" || (theme == "auto" && osDark) {
		return application.NewRGBA(36, 36, 36, 255)
	}
	return application.NewRGBA(255, 255, 255, 255)
}

// startupErrorMessage giải thích lỗi khởi động cơ sở dữ liệu theo từng giai đoạn: sao lưu thất bại thì cơ sở dữ liệu
// chưa bị thay đổi; migration thất bại đã được rollback và nội dung lỗi nêu tên file sao lưu.
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

// main kết nối logger, ứng dụng, handler và cửa sổ chính rồi chạy vòng lặp sự kiện Wails.
func main() {
	cfg := internal.ParseConfig(wailsConfigJSON)
	cfg.Version = appVersion(buildConfigYAML)
	cfg.DevMode = DevMode

	appLogger, closer, err := logger.Setup(logger.Config{
		AppName: cfg.Name,
		Debug:   DevMode,
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
	applyBenchOptions(appLogger, &options.Windows)
	mainApp := application.New(options)

	app, err := internal.NewApp(mainApp, cfg, appLogger)
	if err != nil {
		// Hộp thoại của hệ điều hành chỉ hoạt động sau khi ứng dụng chạy, vì vậy hiển thị lỗi từ ApplicationStarted rồi thoát.
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
	memprobe.Start(mainApp.Context(), appLogger, app.NativeLoaded)
	mainApp.RegisterService(application.NewService(app.BucketHandler))
	mainApp.RegisterService(application.NewService(app.DbHandler))
	mainApp.RegisterService(application.NewService(app.MasterHandler))
	mainApp.RegisterService(application.NewService(app.ProfileHandler))
	mainApp.RegisterService(application.NewService(app.SettingHandler))
	mainApp.RegisterService(application.NewService(app.UpdateHandler))

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
	// File được thả vào phần tử có data-file-drop-target sẽ được gửi đến đây kèm đường dẫn đầy đủ.
	mainWindow.OnWindowEvent(events.Common.WindowFilesDropped, app.BucketHandler.FilesDropped)

	if err := mainApp.Run(); err != nil {
		println("error:", err.Error())
	}
}
