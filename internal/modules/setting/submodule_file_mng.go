package setting

import (
	"S3Browser/models"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
)

const settingsFileName = "settings.json"

// submoduleFileMng reads and writes settings.json in the app data dir.
// It has no lock of its own: submoduleSettingMng.mu serializes every call.
type submoduleFileMng struct {
	logger  *slog.Logger
	appName string
}

func newSubmoduleFileMng(logger *slog.Logger, appName string) *submoduleFileMng {
	return &submoduleFileMng{logger: logger.With("submodules", "file_mng"), appName: appName}
}

// read loads the file over the defaults. A missing or malformed file yields the defaults;
// only a real I/O error is returned.
func (m *submoduleFileMng) read() (models.AppSettings, error) {
	settings := defaultSettings()
	path, err := dataFilePath(m.appName, settingsFileName)
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

// write saves the settings atomically (see writeJSONAtomic).
func (m *submoduleFileMng) write(settings models.AppSettings) error {
	path, err := dataFilePath(m.appName, settingsFileName)
	if err != nil {
		return err
	}
	return writeJSONAtomic(path, settings)
}
