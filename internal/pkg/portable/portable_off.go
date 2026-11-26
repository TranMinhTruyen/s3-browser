//go:build !portable

// Package portable xác định nơi lưu dữ liệu ứng dụng: cạnh exe (bản portable, tag "portable") hoặc trong thư mục cấu hình
// của người dùng. Hai file có build tag đối lập cung cấp cùng API; file này dùng cho bản dựng mặc định.
package portable

import (
	"os"
	"path/filepath"
)

// Enabled cho biết binary có được build với tag "portable" hay không.
const Enabled = false

// DataDir trả về <thư mục cấu hình người dùng>/<appName> và tạo thư mục nếu chưa tồn tại.
func DataDir(appName string) (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dataDir := filepath.Join(configDir, appName)
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return "", err
	}
	return dataDir, nil
}

// WebView2Dir trả về chuỗi rỗng để Wails dùng WebView2 đã cài trên hệ thống.
func WebView2Dir() (string, error) {
	return "", nil
}
