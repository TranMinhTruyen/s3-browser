package handlers

import (
	"S3Browser/internal/modules/setting"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SettingHandler is the Wails service for app settings.
type SettingHandler struct {
	logger  *slog.Logger
	app     *application.App
	setting *setting.Module
}

// NewSettingHandler creates the setting handler.
func NewSettingHandler(app *application.App, logger *slog.Logger, setting *setting.Module) *SettingHandler {
	return &SettingHandler{
		logger:  logger.With("component", "setting_handler"),
		app:     app,
		setting: setting,
	}
}

// GetSettings returns the saved settings.
func (h *SettingHandler) GetSettings() models.Output[models.SettingsOutput] {
	return h.setting.GetSettings()
}

// SaveSettings saves the settings and applies launch on startup.
func (h *SettingHandler) SaveSettings(input models.SaveSettingInput) models.Output[models.SettingsOutput] {
	return h.setting.SaveSettings(input)
}

// ResetSettings returns the default settings without saving them.
func (h *SettingHandler) ResetSettings() models.Output[models.SettingsOutput] {
	return h.setting.ResetSettings()
}

// GetTabState returns the remembered tabs.
func (h *SettingHandler) GetTabState() models.Output[models.TabState] {
	return h.setting.GetTabState()
}

// SaveTabState saves the tab order, active tab and profile of each tab.
func (h *SettingHandler) SaveTabState(input models.SaveTabStateInput) models.Output[models.TabState] {
	return h.setting.SaveTabState(input)
}
