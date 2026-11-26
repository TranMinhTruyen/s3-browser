package setting

import (
	"S3Browser/models"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
)

const settingsFileName = "settings.json"

// submoduleFileMng đọc và ghi settings.json trong thư mục dữ liệu ứng dụng.
// Module không có khóa riêng: submoduleSettingMng.mu tuần tự hóa mọi lời gọi.
type submoduleFileMng struct {
	logger  *slog.Logger
	appName string
}

func newSubmoduleFileMng(logger *slog.Logger, appName string) *submoduleFileMng {
	return &submoduleFileMng{logger: logger.With("submodules", "file_mng"), appName: appName}
}

// read tải file và ghi đè lên giá trị mặc định. File không tồn tại hoặc sai định dạng sẽ dùng giá trị mặc định;
// chỉ lỗi I/O thực sự mới được trả về.
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

// write lưu cài đặt theo cách nguyên tử (xem writeJSONAtomic).
func (m *submoduleFileMng) write(settings models.AppSettings) error {
	path, err := dataFilePath(m.appName, settingsFileName)
	if err != nil {
		return err
	}
	return writeJSONAtomic(path, settings)
}
