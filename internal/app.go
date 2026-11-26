// Package internal kết nối các module và handler của ứng dụng với nhau.
package internal

import (
	"S3Browser/internal/handlers"
	"S3Browser/internal/modules/bucket"
	dbmodule "S3Browser/internal/modules/db"
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/master"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/modules/update"
	"S3Browser/internal/pkg/db"
	"S3Browser/internal/pkg/utils"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App quản lý các handler được đăng ký thành service Wails và tài nguyên cần giải phóng khi tắt ứng dụng.
type App struct {
	logger *slog.Logger
	sqlDb  *sql.DB
	app    *application.App

	BucketHandler  *handlers.BucketHandler
	DbHandler      *handlers.DbHandler
	MasterHandler  *handlers.MasterHandler
	ProfileHandler *handlers.ProfileHandler
	SettingHandler *handlers.SettingHandler
	UpdateHandler  *handlers.UpdateHandler

	dbModule     *dbmodule.Module
	updateModule *update.Module
}

// NewApp mở và migration cơ sở dữ liệu, tạo các module rồi tạo handler phía trên chúng.
// Migration thất bại sẽ được trả về dưới dạng lỗi (thông báo có đường dẫn bản sao lưu) để main báo cho người dùng;
// hàm panic nếu khóa mã hóa không dùng được vì ứng dụng không thể hoạt động khi thiếu khóa.
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
	dbModule := dbmodule.NewModule(app, logger, sqlDb, km)
	settingModule := setting.NewModule(logger, cfg.Name)
	updateModule := update.NewModule(app, logger, settingModule, cfg.Version, cfg.DevMode)

	profileHandler := handlers.NewProfileHandler(profileModule)
	bucketHandler := handlers.NewBucketHandler(bucketModule)
	dbHandler := handlers.NewDbHandler(dbModule)
	masterHandler := handlers.NewMasterHandler(masterModule)
	settingHandler := handlers.NewSettingHandler(settingModule, updateModule)
	updateHandler := handlers.NewUpdateHandler(updateModule)

	return &App{
		logger:         log,
		sqlDb:          sqlDb,
		app:            app,
		BucketHandler:  bucketHandler,
		DbHandler:      dbHandler,
		MasterHandler:  masterHandler,
		ProfileHandler: profileHandler,
		SettingHandler: settingHandler,
		UpdateHandler:  updateHandler,
		dbModule:       dbModule,
		updateModule:   updateModule,
	}, nil
}

// NativeLoaded cho biết thư viện cơ sở dữ liệu native đã được nạp hay chưa (được memory probe đọc).
func (a *App) NativeLoaded() bool {
	return a.dbModule.Loaded()
}

// Shutdown hủy các lượt truyền đang chạy và thao tác kiểm tra cập nhật, đóng mọi kết nối và cơ sở dữ liệu.
func (a *App) Shutdown() {
	a.updateModule.Close()
	a.BucketHandler.CancelAllDownloads()
	a.BucketHandler.CancelAllUploads()
	a.BucketHandler.DisconnectAll()
	a.dbModule.Close()
	a.app.Event.Reset()
	if a.sqlDb != nil {
		if err := a.sqlDb.Close(); err != nil {
			a.logger.Error("close db failed", "error", err)
		}
	}
}
