package update

import (
	"S3Browser/internal/pkg/portable"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/windows"
)

// installSupported reports whether this exe came from the NSIS installer: the installer writes uninstall.exe
// next to the app, and a portable or unpacked build has none.
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

// launchInstaller runs the installer silently through ShellExecute so Windows shows the UAC prompt itself.
// /relaunch makes the installer start the app again, /D (must be last, no quotes) keeps the install folder.
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
