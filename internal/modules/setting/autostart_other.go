//go:build !windows

package setting

// autostartSupported is false: launch on startup is only implemented for Windows.
func autostartSupported() bool {
	return false
}

// setAutostart does nothing on this OS.
func setAutostart(_ string, _ bool) error {
	return nil
}
