package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
)

//go:embed all:schemas/*.sql
var schemasFS embed.FS

const (
	// backupTimeLayout là hậu tố của <db>.bak-<suffix> (UTC để giữ đúng thứ tự khi đổi giờ mùa hè): độ dài cố định
	// giúp tên file sắp xếp theo thời gian. Giai đoạn 1 ghi giờ địa phương; hai định dạng chỉ khác độ lệch múi giờ nên tên cũ vẫn đứng trước.
	backupTimeLayout = "20060102-150405.000"

	// backupsToKeep là số file <db>.bak-* được giữ lại sau khi tạo bản sao lưu mới.
	backupsToKeep = 3
)

var (
	// backupSuffixPattern khớp hậu tố của các bản sao lưu do ứng dụng này tạo (bao gồm cả định dạng chỉ có giây
	// của giai đoạn 1 sprint 11).
	backupSuffixPattern = regexp.MustCompile(`^\d{8}-\d{6}(\.\d{3})?$`)

	// ErrBackupFailed cho biết tạo bản sao lưu trước khi migration thất bại: cơ sở dữ liệu chưa bị thay đổi.
	ErrBackupFailed = errors.New("backup before migration failed")

	// ErrMigrateFailed cho biết migration thất bại và đã được rollback; nội dung lỗi cho biết tên file sao lưu.
	ErrMigrateFailed = errors.New("run migrations failed")
)

// gooseSlogLogger chuyển đầu ra của goose sang slog.
type gooseSlogLogger struct{}

func (gooseSlogLogger) Printf(format string, v ...interface{}) {
	slog.Info("goose: " + fmt.Sprintf(format, v...))
}

func (gooseSlogLogger) Fatalf(format string, v ...interface{}) {
	slog.Error("goose: " + fmt.Sprintf(format, v...))
}

// RunMigrations áp dụng các migration schemas/*.sql được nhúng và ghi log khi phiên bản thay đổi.
func RunMigrations(ctx context.Context, sqlDB *sql.DB) error {
	goose.SetBaseFS(schemasFS)
	goose.SetLogger(gooseSlogLogger{})

	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}

	before, err := goose.GetDBVersion(sqlDB)
	if err != nil {
		return fmt.Errorf("get db version: %w", err)
	}

	backupPath, err := backupBeforeMigrate(ctx, sqlDB, before)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrBackupFailed, err)
	}

	if err := goose.UpContext(ctx, sqlDB, "schemas"); err != nil {
		// goose đã rollback migration thất bại; bản sao lưu là phương án khôi phục cho người dùng.
		slog.Error("migration failed, database rolled back", "backup", backupPath, "error", err)
		return fmt.Errorf("%w (backup: %q): %w", ErrMigrateFailed, backupPath, err)
	}

	after, err := goose.GetDBVersion(sqlDB)
	if err != nil {
		return fmt.Errorf("get db version after migrate: %w", err)
	}

	if after != before {
		slog.Info("database migrated", "from", before, "to", after)
	}
	return nil
}

// backupBeforeMigrate tạo <db>.bak-<yyyyMMdd-HHmmss> nếu còn migration mới hơn version cần chạy
// và cơ sở dữ liệu đã có dữ liệu (version > 0). Trả về "" nếu không cần sao lưu.
// VACUUM INTO tạo bản sao nhất quán kể cả khi WAL còn các trang chưa flush.
func backupBeforeMigrate(ctx context.Context, sqlDB *sql.DB, version int64) (string, error) {
	if version == 0 {
		return "", nil
	}
	pending, err := goose.CollectMigrations("schemas", version, math.MaxInt64)
	// goose báo "no migration files" nếu không có migration nào mới hơn version, tức là không còn việc cần làm.
	if errors.Is(err, goose.ErrNoMigrationFiles) || (err == nil && len(pending) == 0) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("collect pending migrations: %w", err)
	}

	var dbPath string
	row := sqlDB.QueryRowContext(ctx, "SELECT file FROM pragma_database_list WHERE name = 'main'")
	if err := row.Scan(&dbPath); err != nil || dbPath == "" {
		return "", fmt.Errorf("locate db file for backup: %w", err)
	}

	// Thêm mili giây để hai bản sao lưu tạo trong cùng một giây không trùng tên (VACUUM INTO thất bại nếu file đã tồn tại).
	backupPath := dbPath + ".bak-" + time.Now().UTC().Format(backupTimeLayout)
	if _, err := sqlDB.ExecContext(ctx, "VACUUM INTO ?", backupPath); err != nil {
		return "", fmt.Errorf("backup db before migrate: %w", err)
	}
	slog.Info("database backed up before migrate", "backup", backupPath)
	pruneBackups(dbPath, backupsToKeep)
	return backupPath, nil
}

// pruneBackups xóa các file <dbPath>.bak-<timestamp> cũ nhất và giữ lại keep file mới nhất. Xác định "cũ nhất" theo
// thời gian sửa file, không theo tên, vì phiên bản cũ đặt tên theo giờ địa phương còn phiên bản mới dùng UTC.
// Chỉ khớp tên do ứng dụng tạo nên không đụng đến file khác (ví dụ <dbPath>.bak cũ). Nếu thất bại thì chỉ ghi log;
// các bản sao lưu dư không gây hại.
func pruneBackups(dbPath string, keep int) {
	dir, prefix := filepath.Dir(dbPath), filepath.Base(dbPath)+".bak-"
	entries, err := os.ReadDir(dir)
	if err != nil {
		slog.Warn("list old backups failed", "error", err)
		return
	}

	type backup struct {
		name    string
		modTime time.Time
	}
	var backups []backup
	for _, e := range entries {
		suffix, ok := strings.CutPrefix(e.Name(), prefix)
		if !ok || !backupSuffixPattern.MatchString(suffix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			slog.Warn("stat old backup failed", "backup", e.Name(), "error", err)
			continue
		}
		backups = append(backups, backup{e.Name(), info.ModTime()})
	}
	if len(backups) <= keep {
		return
	}

	sort.Slice(backups, func(i, j int) bool {
		if !backups[i].modTime.Equal(backups[j].modTime) {
			return backups[i].modTime.Before(backups[j].modTime)
		}
		return backups[i].name < backups[j].name
	})
	for _, b := range backups[:len(backups)-keep] {
		if err := os.Remove(filepath.Join(dir, b.name)); err != nil {
			slog.Warn("remove old backup failed", "backup", b.name, "error", err)
		}
	}
}
