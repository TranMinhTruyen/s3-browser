//go:build windows

package setting

import (
	"S3Browser/internal/pkg/portable"
	"errors"
	"os"

	"golang.org/x/sys/windows/registry"
)

const runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`

// autostartSupported is true only for the installed build: a portable exe can move, so its path must not be registered.
func autostartSupported() bool {
	return !portable.Enabled
}

// setAutostart adds or removes the HKCU Run entry that starts the app with Windows.
func setAutostart(appName string, enable bool) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = key.Close() }()

	if !enable {
		if err := key.DeleteValue(appName); err != nil && !errors.Is(err, registry.ErrNotExist) {
			return err
		}
		return nil
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return key.SetStringValue(appName, `"`+exe+`"`)
}
