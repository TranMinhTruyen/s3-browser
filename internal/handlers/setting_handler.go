package handlers

import (
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/modules/update"
	"S3Browser/models"
)

// SettingHandler là service Wails quản lý cài đặt ứng dụng.
type SettingHandler struct {
	setting *setting.Module
	update  *update.Module
}

// NewSettingHandler tạo handler cài đặt.
func NewSettingHandler(setting *setting.Module, update *update.Module) *SettingHandler {
	return &SettingHandler{
		setting: setting,
		update:  update,
	}
}

// GetSettings trả về các cài đặt đã lưu.
func (h *SettingHandler) GetSettings() models.Output[models.SettingsOutput] {
	return h.setting.GetSettings()
}

// SaveSettings lưu cài đặt rồi áp dụng tùy chọn khởi chạy cùng hệ thống, kênh cập nhật và kiểm tra cập nhật định kỳ.
func (h *SettingHandler) SaveSettings(input models.SaveSettingInput) models.Output[models.SettingsOutput] {
	output := h.setting.SaveSettings(input)
	if output.Result {
		h.update.SetBeta(output.Body.Settings.BetaUpdate)
		h.update.SetAutoUpdate(output.Body.Settings.AutoUpdate)
	}
	return output
}

// SetLaunchOnStartup chỉ ghi tùy chọn khởi chạy cùng hệ thống (được dùng bởi Apply); đầu ra chứa giá trị thực tế được giữ lại.
func (h *SettingHandler) SetLaunchOnStartup(enabled bool) models.Output[models.SettingsOutput] {
	return h.setting.SetLaunchOnStartup(enabled)
}

// GetTabState trả về các tab đã ghi nhớ.
func (h *SettingHandler) GetTabState() models.Output[models.TabState] {
	return h.setting.GetTabState()
}

// SaveTabState lưu thứ tự tab, tab đang hoạt động và hồ sơ của từng tab.
func (h *SettingHandler) SaveTabState(input models.SaveTabStateInput) models.Output[models.TabState] {
	return h.setting.SaveTabState(input)
}

// SaveSqlTabState lưu thứ tự tab SQL, tab đang hoạt động và nội dung từng tab.
func (h *SettingHandler) SaveSqlTabState(input models.SaveSqlTabStateInput) models.Output[models.TabState] {
	return h.setting.SaveSqlTabState(input)
}
