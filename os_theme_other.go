//go:build !windows

package main

// Không xác định được osDarkMode trước khi ứng dụng chạy trên nền tảng này nên "auto" giữ màu nền sáng.
func osDarkMode() bool {
	return false
}
