// Package logger thiết lập logger slog dạng JSON, ghi ra file luân phiên và stdout.
package logger

import (
	"S3Browser/internal/pkg/portable"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"gopkg.in/natefinch/lumberjack.v2"
)

// logDir trả về <base>/logs và tạo thư mục nếu chưa tồn tại.
func logDir(appName string) (string, error) {
	base, err := logBase(appName)
	if err != nil {
		return "", err
	}

	dir := filepath.Join(base, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// logBase trả về thư mục chứa thư mục "logs".
func logBase(appName string) (string, error) {
	// Bản portable: mọi dữ liệu nằm trong <thư mục exe>/data trên mọi hệ điều hành.
	if portable.Enabled || runtime.GOOS != "darwin" {
		// Trên Windows: %AppData%/<appName>; trên Linux: ~/.config/<appName>.
		return portable.DataDir(appName)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Logs", appName), nil
}

// redactedMarker được tạo trong thư mục log sau khi xóa log cũ (có thể chứa thông tin bí mật).
const redactedMarker = ".redacted"

// Config là dữ liệu đầu vào của Setup.
type Config struct {
	AppName string
	// Debug giữ mức log debug; nếu không thì dùng mức info.
	Debug bool
}

// newHandler tạo handler JSON (chỉ dùng mức debug khi bật debug). Các thuộc tính gốc "args" và "result"
// luôn được thay bằng "[redacted]": Wails v3.1.0 ghi log mọi lời gọi binding cùng tham số và giá trị trả về
// (pkg/application/messageprocessor_call.go, "Binding call complete"), cũng như lời gọi runtime cùng tham số
// (messageprocessor.go, "Runtime call"); các dữ liệu này có thể chứa thông tin bí mật và truy vấn.
// Khi nâng cấp Wails, hãy tìm trong pkg/application các thuộc tính log mới chứa dữ liệu lời gọi rồi cập nhật danh sách này.
func newHandler(w io.Writer, debug bool) slog.Handler {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	return slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:     level,
		AddSource: true,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && (a.Key == "args" || a.Key == "result") {
				return slog.String(a.Key, "[redacted]")
			}
			return a
		},
	})
}

// purgeOldLogs xóa app.log và các bản sao lưu (app-<time>.log[.gz]) một lần vì log từ phiên bản cũ có thể chứa thông tin bí mật.
// Hàm trả lỗi đầu tiên; chỉ giữ marker nếu xóa thành công.
func purgeOldLogs(dir string) error {
	marker := filepath.Join(dir, redactedMarker)
	if _, err := os.Stat(marker); err == nil {
		return nil
	}

	// Dùng ReadDir (không dùng Glob) để các ký tự [ ] * ? trong tên thư mục không bị hiểu thành mẫu.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var errs []error
	for _, e := range entries {
		if !isAppLog(e.Name()) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return os.WriteFile(marker, nil, 0o600)
}

// isAppLog cho biết tên file có phải app.log hoặc bản sao lưu lumberjack app-<time>.log[.gz] hay không.
func isAppLog(name string) bool {
	return name == "app.log" ||
		strings.HasPrefix(name, "app-") && (strings.HasSuffix(name, ".log") || strings.HasSuffix(name, ".log.gz"))
}

// Setup tạo logger slog mặc định (có thông tin nguồn, chỉ dùng mức debug nếu cfg.Debug) rồi cài đặt bằng slog.SetDefault.
// Closer trả về sẽ flush và đóng file log; gọi hàm này khi thoát ứng dụng.
func Setup(cfg Config) (*slog.Logger, io.Closer, error) {
	dir, err := logDir(cfg.AppName)
	if err != nil {
		return nil, nil, err
	}
	purgeErr := purgeOldLogs(dir)

	// Luân phiên file khi đạt 5 MiB, giữ 3 bản sao nén trong 14 ngày.
	rotator := &lumberjack.Logger{
		Filename:   filepath.Join(dir, "app.log"),
		MaxSize:    5,
		MaxBackups: 3,
		MaxAge:     14,
		Compress:   true,
	}

	logger := slog.New(newHandler(io.MultiWriter(rotator, os.Stdout), cfg.Debug))
	slog.SetDefault(logger)
	if purgeErr != nil {
		logger.Warn("purge old logs failed", "error", purgeErr)
	}
	return logger, rotator, nil
}
