//go:build portable

// Package portable decides where the app keeps its data: next to the exe (portable build) or in the user config dir.
package portable

import (
	"os"
	"path/filepath"
)

// Enabled reports whether the binary was built with the "portable" tag.
const Enabled = true

// exeDir returns the directory of the running exe, with symlinks resolved.
func exeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

// DataDir returns <exe dir>/data and creates it when missing.
func DataDir(_ string) (string, error) {
	dir, err := exeDir()
	if err != nil {
		return "", err
	}
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return "", err
	}
	return dataDir, nil
}

// WebView2Dir returns <exe dir>/webview2, where the WebView2 Fixed Version runtime is shipped.
func WebView2Dir() (string, error) {
	dir, err := exeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "webview2"), nil
}
