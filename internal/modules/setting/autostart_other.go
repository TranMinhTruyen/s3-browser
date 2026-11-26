//go:build !windows

package setting

// autostartSupported là false: hiện chỉ hỗ trợ khởi chạy cùng hệ thống trên Windows.
func autostartSupported() bool {
	return false
}

// setAutostart không làm gì trên hệ điều hành này.
func setAutostart(_ string, _ bool) error {
	return nil
}
