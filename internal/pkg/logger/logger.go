// Package logger sets up the JSON slog logger that writes to a rotating file and stdout.
package logger

import (
	"S3Browser/internal/pkg/portable"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

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

// Config is the input of Setup.
type Config struct {
	AppName string
}

// Setup builds the default slog logger (debug level, with source) and installs it with slog.SetDefault.
// The returned Closer flushes and closes the log file; call it on exit.
func Setup(cfg Config) (*slog.Logger, io.Closer, error) {
	dir, err := logDir(cfg.AppName)
	if err != nil {
		return nil, nil, err
	}

	// Rotate at 5 MiB, keep 3 compressed backups for 14 days.
	rotator := &lumberjack.Logger{
		Filename:   filepath.Join(dir, "app.log"),
		MaxSize:    5,
		MaxBackups: 3,
		MaxAge:     14,
		Compress:   true,
	}

	handler := slog.NewJSONHandler(io.MultiWriter(rotator, os.Stdout), &slog.HandlerOptions{
		Level:     slog.LevelDebug,
		AddSource: true,
	})

	logger := slog.New(handler)
	slog.SetDefault(logger)
	return logger, rotator, nil
}
