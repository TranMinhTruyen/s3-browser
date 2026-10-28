// Package setting stores the user preferences (theme, font, language, launch on startup) in settings.json.
package setting

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// STE001 - Error while loading settings
	STE001 = "STE001"

	// STE002 - Error while saving settings
	STE002 = "STE002"

	// STE003 - Cannot change launch on Windows startup, other settings were saved
	STE003 = "STE003"

	// STE004 - Invalid setting value
	STE004 = "STE004"
)

// Module reads and writes the app settings file.
type Module struct {
	logger  *slog.Logger
	app     *application.App
	setting *submoduleSettingMng
}

// NewModule creates the setting module; appName selects the data dir and names the autostart entry.
func NewModule(app *application.App, logger *slog.Logger, appName string) *Module {
	return &Module{
		logger:  logger.With("component", "setting_module"),
		app:     app,
		setting: newSubmoduleSettingMng(logger, appName),
	}
}

// GetSettings returns the saved settings. A missing or malformed file yields the defaults.
func (m *Module) GetSettings() models.Output[models.SettingsOutput] {
	output := models.NewOutput[models.SettingsOutput]()
	output.Body.AutostartSupported = autostartSupported()

	settings, err := m.setting.get()
	output.Body.Settings = settings
	if err != nil {
		m.logger.Error("load settings failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE001, err.Error()))
	}
	return output
}

// SaveSettings validates and saves the settings, then applies launch on startup.
func (m *Module) SaveSettings(input models.SaveSettingInput) models.Output[models.SettingsOutput] {
	output := models.NewOutput[models.SettingsOutput]()
	output.Body.AutostartSupported = autostartSupported()

	settings := models.AppSettings(input)
	if err := validate(settings); err != nil {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE004, err.Error()))
	}

	saved, autostartErr, err := m.setting.save(settings)
	if err != nil {
		m.logger.Error("save settings failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE002, err.Error()))
	}
	if autostartErr != nil {
		m.logger.Warn("update launch on startup failed", "error", autostartErr)
		output.AddMessage(models.NewMessage(cnst.MessageTypeWarn, cnst.Setting, STE003, autostartErr.Error()))
	}
	output.Body.Settings = saved
	return output
}

// ResetSettings returns the default settings without saving them; the user confirms with SaveSettings.
func (m *Module) ResetSettings() models.Output[models.SettingsOutput] {
	output := models.NewOutput[models.SettingsOutput]()
	output.Body.AutostartSupported = autostartSupported()
	output.Body.Settings = defaultSettings()
	return output
}
