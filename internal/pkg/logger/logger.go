package logger

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/natefinch/lumberjack.v2"
)

func LogDir(appName string) (string, error) {
	var base string
	var err error

	switch runtime.GOOS {
	case "darwin":
		home, e := os.UserHomeDir()
		if e != nil {
			return "", e
		}
		base = filepath.Join(home, "Library", "Logs")
	default: // windows: %AppData%, linux: ~/.config
		base, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
	}

	dir := filepath.Join(base, appName, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

type Config struct {
	AppName string
}

func Setup(cfg Config) (*slog.Logger, io.Closer, error) {
	dir, err := LogDir(cfg.AppName)
	if err != nil {
		return nil, nil, err
	}

	rotator := &lumberjack.Logger{
		Filename:   filepath.Join(dir, "app.log"),
		MaxSize:    5,
		MaxBackups: 3,
		MaxAge:     14,
		Compress:   true,
	}

	level := slog.LevelDebug
	handler := slog.NewJSONHandler(io.MultiWriter(rotator, os.Stdout), &slog.HandlerOptions{
		Level:     level,
		AddSource: true,
	})

	logger := slog.New(handler)
	slog.SetDefault(logger)
	return logger, rotator, nil
}

type WailsAdapter struct{ l *slog.Logger }

func NewWailsAdapter(l *slog.Logger) *WailsAdapter {
	return &WailsAdapter{l: l.With("source", "wails")}
}

func (a *WailsAdapter) Print(message string)   { a.l.Info(message) }
func (a *WailsAdapter) Trace(message string)   { a.l.Debug(message) }
func (a *WailsAdapter) Debug(message string)   { a.l.Debug(message) }
func (a *WailsAdapter) Info(message string)    { a.l.Info(message) }
func (a *WailsAdapter) Warning(message string) { a.l.Warn(message) }
func (a *WailsAdapter) Error(message string)   { a.l.Error(message) }
func (a *WailsAdapter) Fatal(message string) {
	a.l.Error(message)
	os.Exit(1)
}
