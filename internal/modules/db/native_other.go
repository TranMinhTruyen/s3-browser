//go:build !windows

package db

import "errors"

// loadNative báo lỗi: thư viện native chỉ được build cho Windows.
func loadNative() (nativeCaller, error) {
	return nil, errors.New("the native database library is only available on Windows")
}
