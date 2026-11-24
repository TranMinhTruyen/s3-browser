// Package logger sets up the JSON slog logger that writes to a rotating file and stdout.
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

// logDir returns <base>/logs and creates it when missing.
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

// logBase returns the directory that holds the "logs" folder.
func logBase(appName string) (string, error) {
	// portable: everything lives in <exe dir>/data, on every OS
	if portable.Enabled || runtime.GOOS != "darwin" {
		// windows: %AppData%/<appName>, linux: ~/.config/<appName>
		return portable.DataDir(appName)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Logs", appName), nil
}

// redactedMarker is created in the logs folder once old logs (which may hold secrets) were purged.
const redactedMarker = ".redacted"

// Config is the input of Setup.
type Config struct {
	AppName string
	// Debug keeps the debug level; otherwise the level is info.
	Debug bool
}

// newHandler builds the JSON handler (debug level only when debug). The root attributes "args" and
// "result" are always replaced by "[redacted]": Wails v3.1.0 logs every binding call with its arguments
// and return value (pkg/application/messageprocessor_call.go, "Binding call complete") and runtime calls
// with their arguments (messageprocessor.go, "Runtime call"), which carry secrets and query data.
// When upgrading Wails, grep pkg/application for new log attributes holding call data and update this list.
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

// purgeOldLogs deletes app.log and its backups (app-<time>.log[.gz]) once, because logs written by
// earlier versions may contain secrets. It returns the first error; the marker is kept only on success.
func purgeOldLogs(dir string) error {
	marker := filepath.Join(dir, redactedMarker)
	if _, err := os.Stat(marker); err == nil {
		return nil
	}

	// ReadDir (not Glob) so that [ ] * ? in the folder name are not read as a pattern.
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

// isAppLog reports app.log and lumberjack backups app-<time>.log[.gz].
func isAppLog(name string) bool {
	return name == "app.log" ||
		strings.HasPrefix(name, "app-") && (strings.HasSuffix(name, ".log") || strings.HasSuffix(name, ".log.gz"))
}

// Setup builds the default slog logger (with source, debug level only when cfg.Debug) and installs it
// with slog.SetDefault. The returned Closer flushes and closes the log file; call it on exit.
func Setup(cfg Config) (*slog.Logger, io.Closer, error) {
	dir, err := logDir(cfg.AppName)
	if err != nil {
		return nil, nil, err
	}
	purgeErr := purgeOldLogs(dir)

	// Rotate at 5 MiB, keep 3 compressed backups for 14 days.
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
