//go:build windows

package main

import "github.com/wailsapp/wails/v3/pkg/w32"

// osDarkMode reads the Windows app theme from the registry. Env.IsDarkMode() cannot be used here because it
// returns false until the app runs, and the window background must be chosen before that.
func osDarkMode() bool {
	return w32.IsCurrentlyDarkMode()
}
