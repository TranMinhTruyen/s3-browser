//go:build portable

// Package portable xác định nơi lưu dữ liệu ứng dụng: cạnh exe (bản portable, tag "portable") hoặc trong thư mục cấu hình
// của người dùng. Hai file có build tag đối lập cung cấp cùng API nên bên gọi không cần rẽ nhánh theo tag,
// ngoại trừ khi dùng Enabled.
package portable

import (
	"os"
	"path/filepath"
)

// Enabled cho biết binary có được build với tag "portable" hay không.
const Enabled = true

// exeDir trả về thư mục của exe đang chạy sau khi phân giải symbolic link.
func exeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

// DataDir trả về <thư mục exe>/data và tạo thư mục nếu chưa tồn tại.
func DataDir(_ string) (string, error) {
	dir, err := exeDir()
	if err != nil {
		return "", err
	}
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return "", err
	}
	return dataDir, nil
}

// WebView2Dir trả về <thư mục exe>/webview2, nơi chứa WebView2 Fixed Version runtime đi kèm ứng dụng.
func WebView2Dir() (string, error) {
	dir, err := exeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "webview2"), nil
}
