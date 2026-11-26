package setting

import (
	"S3Browser/internal/pkg/portable"
	"encoding/json"
	"os"
	"path/filepath"
)

// dataFilePath trả về đường dẫn đến file trong thư mục dữ liệu ứng dụng, tạo thư mục nếu chưa tồn tại.
func dataFilePath(appName, fileName string) (string, error) {
	dir, err := portable.DataDir(appName)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, fileName), nil
}

// writeJSONAtomic lưu v dưới dạng JSON: flush file tạm trong cùng thư mục xuống đĩa rồi đổi tên file tạm đè lên file đích,
// nhờ đó sự cố hoặc mất điện không để lại file ghi dở.
// Hàm không khóa; bên gọi tuần tự hóa các lần ghi (submoduleSettingMng.mu cho cài đặt, submoduleTabMng.mu cho tab).
func writeJSONAtomic(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if err == nil {
		// Nếu thiếu Sync, thao tác đổi tên có thể xuống đĩa trước dữ liệu, khiến file rỗng sau sự cố.
		err = tmp.Sync()
	}
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
