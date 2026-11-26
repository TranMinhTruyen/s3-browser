package setting

import (
	"S3Browser/models"
	"fmt"
	"log/slog"
	"slices"
	"sync"
)

// Các giá trị được chấp nhận; frontend dùng cùng các key này.
var (
	themes = []string{"light", "dark", "auto"}
	fonts  = []string{
		"nunito", "system-ui", "segoe-ui", "arial", "roboto", "be-vietnam-pro", "verdana", "meiryo-ui",
		"monospace", "jetbrains-mono",
	}
	languages = []string{"en", "vi", "ja", "zh-CN", "zh-TW", "ru", "de"}
	sizes     = []string{"small", "medium", "large"}
)

// defaultSettings là các giá trị ứng dụng dùng khi chưa lưu cài đặt và là phương án thay thế cho giá trị không xác định.
func defaultSettings() models.AppSettings {
	return models.AppSettings{Theme: "light", Font: "nunito", Language: "en", Size: "medium", AutoUpdate: true}
}

// sanitize thay mỗi giá trị không xác định bằng giá trị mặc định để file cũ hoặc bị chỉnh sửa không làm lỗi khởi động.
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
	if !slices.Contains(sizes, s.Size) {
		s.Size = def.Size
	}
	return s
}

// validate từ chối mọi giá trị nằm ngoài danh sách được chấp nhận.
func validate(s models.AppSettings) error {
	switch {
	case !slices.Contains(themes, s.Theme):
		return fmt.Errorf("invalid theme %q", s.Theme)
	case !slices.Contains(fonts, s.Font):
		return fmt.Errorf("invalid font %q", s.Font)
	case !slices.Contains(languages, s.Language):
		return fmt.Errorf("invalid language %q", s.Language)
	case !slices.Contains(sizes, s.Size):
		return fmt.Errorf("invalid size %q", s.Size)
	}
	return nil
}

// submoduleSettingMng tuần tự hóa thao tác truy cập file cài đặt và áp dụng tùy chọn tự khởi động.
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

// get trả về các cài đặt đã lưu.
func (m *submoduleSettingMng) get() (models.AppSettings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.file.read()
}

// save lưu cài đặt. Nếu không thay đổi được mục tự khởi động thì các giá trị khác vẫn được lưu,
// LaunchOnStartup giữ giá trị cũ và lỗi tự khởi động được trả riêng.
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

	// Ghi file trước để lỗi ghi không làm registry thay đổi; setAutostart có tính idempotent.
	if err = m.file.write(in); err != nil {
		return in, nil, err
	}
	if autostartErr = setAutostart(m.appName, in.LaunchOnStartup); autostartErr != nil {
		// Registry không đổi: ghi lại file bằng giá trị trước đó để hai bên tiếp tục đồng bộ.
		in.LaunchOnStartup = current.LaunchOnStartup
		err = m.file.write(in)
	}
	return in, autostartErr, err
}
