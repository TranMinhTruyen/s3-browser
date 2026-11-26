// Package db mở cơ sở dữ liệu SQLite và chạy các migration goose.
package db

import (
	"S3Browser/internal/pkg/portable"
	"context"
	"database/sql"
	"log"
	"path/filepath"

	// Đăng ký database/sql driver "sqlite" thuần Go (modernc).
	_ "modernc.org/sqlite"
)

// InitDB mở <thư mục dữ liệu>/data.db (bật WAL và khóa ngoại) rồi ping cơ sở dữ liệu.
// Nếu thất bại thì thoát tiến trình vì ứng dụng không thể hoạt động khi thiếu cơ sở dữ liệu.
// RunMigrations tạo bản sao lưu trước khi migration.
func InitDB(ctx context.Context, appName string) *sql.DB {
	appDir, err := portable.DataDir(appName)
	if err != nil {
		log.Fatalf("failed to get app data dir: %v", err)
	}

	dbPath := filepath.Join(appDir, "data.db")

	dsn := dbPath +
		"?_pragma=foreign_keys(1)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("failed to open db at %s: %v", dbPath, err)
	}

	// Chỉ dùng một kết nối để tránh SQLITE_BUSY giữa các thao tác ghi đồng thời.
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close() // already failing; the ping error is the one worth reporting
		log.Fatalf("ping db: %s", err)
	}

	return db
}
