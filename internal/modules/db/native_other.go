//go:build !windows

package db

import "errors"

// loadNative fails: the native library is only built for Windows.
func loadNative() (nativeCaller, error) {
	return nil, errors.New("the native database library is only available on Windows")
}
