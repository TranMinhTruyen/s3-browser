//go:build !windows

package update

import "errors"

// installSupported là false: bộ cài chỉ được tạo cho Windows.
func installSupported() bool {
	return false
}

// launchInstaller luôn thất bại trên hệ điều hành này.
func launchInstaller(_, _ string) error {
	return errors.New("updating is only supported on Windows")
}
