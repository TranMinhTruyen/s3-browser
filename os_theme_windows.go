//go:build windows

package main

import "github.com/wailsapp/wails/v3/pkg/w32"

// osDarkMode đọc giao diện ứng dụng Windows từ registry. Không thể dùng Env.IsDarkMode() vì hàm trả false
// cho đến khi ứng dụng chạy, trong khi cần chọn màu nền cửa sổ trước thời điểm đó.
func osDarkMode() bool {
	return w32.IsCurrentlyDarkMode()
}
