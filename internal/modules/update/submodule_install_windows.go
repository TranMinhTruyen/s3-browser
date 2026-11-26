package update

import (
	"S3Browser/internal/pkg/portable"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/windows"
)

// installSupported cho biết exe này có được cài bằng NSIS hay không: bộ cài đặt uninstall.exe cạnh ứng dụng,
// còn bản portable hoặc bản giải nén không có file này.
func installSupported() bool {
	if portable.Enabled || (runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64") {
		return false
	}
	dir, err := exeDir()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(dir, "uninstall.exe"))
	return err == nil
}

// launchInstaller chạy ngầm bộ cài qua ShellExecute để Windows tự hiển thị hộp thoại UAC.
// /relaunch yêu cầu bộ cài khởi chạy lại ứng dụng; /D (phải là tham số cuối, không có dấu ngoặc kép) giữ nguyên thư mục cài đặt.
func launchInstaller(installer, installDir string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(installer)
	if err != nil {
		return err
	}
	args, err := windows.UTF16PtrFromString("/S /relaunch /D=" + installDir)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, args, nil, windows.SW_NORMAL)
}
