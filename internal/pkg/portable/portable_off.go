//go:build !portable

// Package portable decides where the app keeps its data: next to the exe (portable build) or in the user config dir.
package portable

import (
	"os"
	"path/filepath"
)

// Enabled reports whether the binary was built with the "portable" tag.
const Enabled = false

// DataDir returns <user config dir>/<appName> and creates it when missing.
func DataDir(appName string) (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dataDir := filepath.Join(configDir, appName)
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return "", err
	}
	return dataDir, nil
}

// WebView2Dir returns an empty string so Wails uses the WebView2 installed on the system.
func WebView2Dir() (string, error) {
	return "", nil
}
