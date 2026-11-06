package handlers

import (
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/modules/update"
	"S3Browser/models"
)

// SettingHandler is the Wails service for app settings.
type SettingHandler struct {
	setting *setting.Module
	update  *update.Module
}

// NewSettingHandler creates the setting handler.
func NewSettingHandler(setting *setting.Module, update *update.Module) *SettingHandler {
	return &SettingHandler{
		setting: setting,
		update:  update,
	}
}

// GetSettings returns the saved settings.
func (h *SettingHandler) GetSettings() models.Output[models.SettingsOutput] {
	return h.setting.GetSettings()
}

// SaveSettings saves the settings, applies launch on startup, the update channel and the periodic update check.
func (h *SettingHandler) SaveSettings(input models.SaveSettingInput) models.Output[models.SettingsOutput] {
	output := h.setting.SaveSettings(input)
	if output.Result {
		h.update.SetBeta(output.Body.Settings.BetaUpdate)
		h.update.SetAutoUpdate(output.Body.Settings.AutoUpdate)
	}
	return output
}

// GetTabState returns the remembered tabs.
func (h *SettingHandler) GetTabState() models.Output[models.TabState] {
	return h.setting.GetTabState()
}

// SaveTabState saves the tab order, active tab and profile of each tab.
func (h *SettingHandler) SaveTabState(input models.SaveTabStateInput) models.Output[models.TabState] {
	return h.setting.SaveTabState(input)
}
