//go:build !windows

package update

import "errors"

// installSupported is false: the installer is only built for Windows.
func installSupported() bool {
	return false
}

// launchInstaller always fails on this OS.
func launchInstaller(_, _ string) error {
	return errors.New("updating is only supported on Windows")
}
