package setting

import (
	"S3Browser/internal/pkg/portable"
	"S3Browser/models"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
)

const settingsFileName = "settings.json"

// submoduleFileMng reads and writes settings.json in the app data dir.
type submoduleFileMng struct {
	logger  *slog.Logger
	appName string
}

func newSubmoduleFileMng(logger *slog.Logger, appName string) *submoduleFileMng {
	return &submoduleFileMng{logger: logger.With("submodules", "file_mng"), appName: appName}
}

// path returns the settings file path, creating the data dir when missing.
func (m *submoduleFileMng) path() (string, error) {
	dir, err := portable.DataDir(m.appName)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, settingsFileName), nil
}

// read loads the file over the defaults. A missing or malformed file yields the defaults;
// only a real I/O error is returned.
func (m *submoduleFileMng) read() (models.AppSettings, error) {
	settings := defaultSettings()
	path, err := m.path()
	if err != nil {
		return settings, err
	}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}

	if err := json.Unmarshal(data, &settings); err != nil {
		m.logger.Warn("settings file is malformed, using defaults", "path", path, "error", err)
		return defaultSettings(), nil
	}
	return sanitize(settings), nil
}

// write saves atomically: a temp file in the same dir is renamed over the target, so a crash never leaves half a file.
func (m *submoduleFileMng) write(settings models.AppSettings) error {
	path, err := m.path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), settingsFileName+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
	}
	return err
}
