// Package setting lưu tùy chọn của người dùng (giao diện, phông chữ, ngôn ngữ, cỡ UI, khởi chạy cùng hệ thống) trong settings.json.
package setting

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"log/slog"
)

var (
	// STE001 - Lỗi khi tải cài đặt
	STE001 = "STE001"

	// STE002 - Lỗi khi lưu cài đặt
	STE002 = "STE002"

	// STE003 - Không thể đổi tùy chọn khởi chạy cùng Windows; các cài đặt khác đã được lưu
	STE003 = "STE003"

	// STE004 - Giá trị cài đặt không hợp lệ
	STE004 = "STE004"

	// STE005 - Lỗi khi tải trạng thái tab
	STE005 = "STE005"

	// STE006 - Lỗi khi lưu trạng thái tab
	STE006 = "STE006"

	// STE007 - Dữ liệu tab không hợp lệ
	STE007 = "STE007"
)

// Module đọc và ghi file cài đặt ứng dụng.
type Module struct {
	logger  *slog.Logger
	setting *submoduleSettingMng
	tab     *submoduleTabMng
}

// NewModule tạo module setting; appName dùng để chọn thư mục dữ liệu và đặt tên mục tự khởi động.
func NewModule(logger *slog.Logger, appName string) *Module {
	return &Module{
		logger:  logger.With("component", "setting_module"),
		setting: newSubmoduleSettingMng(logger, appName),
		tab:     newSubmoduleTabMng(logger, appName),
	}
}

// GetSettings trả về các cài đặt đã lưu. Nếu file không tồn tại hoặc sai định dạng, hàm trả về giá trị mặc định.
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

// SaveSettings kiểm tra rồi lưu cài đặt, sau đó áp dụng tùy chọn khởi chạy cùng hệ thống.
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

// SetLaunchOnStartup chỉ thay đổi tùy chọn khởi chạy cùng hệ thống (registry và file cài đặt), giữ nguyên các giá trị đã lưu khác.
// Nếu không thể cập nhật registry, hàm trả về giá trị cũ kèm cảnh báo STE003.
func (m *Module) SetLaunchOnStartup(enabled bool) models.Output[models.SettingsOutput] {
	output := models.NewOutput[models.SettingsOutput]()

	current, err := m.setting.get()
	if err != nil {
		m.logger.Error("load settings failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE001, err.Error()))
	}
	current.LaunchOnStartup = enabled
	return m.SaveSettings(models.SaveSettingInput(current))
}

// GetTabState trả về các tab đã ghi nhớ. Nếu file không tồn tại, sai định dạng hoặc không hợp lệ, hàm trả về trạng thái rỗng.
func (m *Module) GetTabState() models.Output[models.TabState] {
	output := models.NewOutput[models.TabState]()

	state, err := m.tab.get()
	output.Body = state
	if err != nil {
		m.logger.Error("load tab state failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE005, err.Error()))
	}
	return output
}

// SaveTabState kiểm tra rồi lưu thứ tự tab, tab đang hoạt động và hồ sơ của từng tab.
func (m *Module) SaveTabState(input models.SaveTabStateInput) models.Output[models.TabState] {
	output := models.NewOutput[models.TabState]()

	state := models.TabState{Tabs: input.Tabs, ActiveTab: input.ActiveTab}
	invalid, err := m.tab.save(state)
	if invalid != nil {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE007, invalid.Error()))
	}
	if err != nil {
		m.logger.Error("save tab state failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE006, err.Error()))
	}
	output.Body = state
	return output
}

// SaveSqlTabState kiểm tra rồi lưu thứ tự tab SQL, tab đang hoạt động và nội dung từng tab.
func (m *Module) SaveSqlTabState(input models.SaveSqlTabStateInput) models.Output[models.TabState] {
	output := models.NewOutput[models.TabState]()

	invalid, err := m.tab.saveSql(input)
	if invalid != nil {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE007, invalid.Error()))
	}
	if err != nil {
		m.logger.Error("save SQL tab state failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Setting, STE006, err.Error()))
	}
	output.Body.SqlTabs = input.Tabs
	output.Body.ActiveSqlTab = input.ActiveTab
	return output
}
