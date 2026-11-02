package setting

import (
	"S3Browser/models"
	"fmt"
	"log/slog"
	"slices"
	"sync"
)

// Accepted values; the frontend uses the same keys.
var (
	themes = []string{"light", "dark", "auto"}
	fonts  = []string{
		"nunito", "system-ui", "segoe-ui", "arial", "roboto", "be-vietnam-pro", "verdana", "meiryo-ui",
		"monospace", "jetbrains-mono",
	}
	languages = []string{"en", "vi", "ja", "zh-CN", "zh-TW", "ru", "de"}
)

// defaultSettings is what the app uses when nothing is saved, and the fallback for any unknown value.
func defaultSettings() models.AppSettings {
	return models.AppSettings{Theme: "light", Font: "nunito", Language: "en"}
}

// sanitize replaces each unknown value with its default, so an old or edited file never breaks startup.
func sanitize(s models.AppSettings) models.AppSettings {
	def := defaultSettings()
	if !slices.Contains(themes, s.Theme) {
		s.Theme = def.Theme
	}
	if !slices.Contains(fonts, s.Font) {
		s.Font = def.Font
	}
	if !slices.Contains(languages, s.Language) {
		s.Language = def.Language
	}
	return s
}

// validate rejects any value outside the accepted lists.
func validate(s models.AppSettings) error {
	switch {
	case !slices.Contains(themes, s.Theme):
		return fmt.Errorf("invalid theme %q", s.Theme)
	case !slices.Contains(fonts, s.Font):
		return fmt.Errorf("invalid font %q", s.Font)
	case !slices.Contains(languages, s.Language):
		return fmt.Errorf("invalid language %q", s.Language)
	}
	return nil
}

// submoduleSettingMng serializes access to the settings file and applies the autostart option.
type submoduleSettingMng struct {
	logger  *slog.Logger
	appName string
	file    *submoduleFileMng
	mu      sync.Mutex
}

func newSubmoduleSettingMng(logger *slog.Logger, appName string) *submoduleSettingMng {
	return &submoduleSettingMng{
		logger:  logger.With("submodules", "setting_mng"),
		appName: appName,
		file:    newSubmoduleFileMng(logger, appName),
	}
}

// get returns the saved settings.
func (m *submoduleSettingMng) get() (models.AppSettings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.file.read()
}

// save persists the settings. When the autostart entry cannot be changed the other values are still saved,
// LaunchOnStartup keeps its previous value and the autostart error is returned separately.
func (m *submoduleSettingMng) save(in models.AppSettings) (saved models.AppSettings, autostartErr, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	current, err := m.file.read()
	if err != nil {
		return in, nil, err
	}

	if !autostartSupported() {
		in.LaunchOnStartup = false
		return in, nil, m.file.write(in)
	}

	// Write the file first so a failed write never leaves the registry changed; setAutostart is idempotent.
	if err = m.file.write(in); err != nil {
		return in, nil, err
	}
	if autostartErr = setAutostart(m.appName, in.LaunchOnStartup); autostartErr != nil {
		// Registry unchanged: rewrite the file with the previous value so both stay in sync.
		in.LaunchOnStartup = current.LaunchOnStartup
		err = m.file.write(in)
	}
	return in, autostartErr, err
}
