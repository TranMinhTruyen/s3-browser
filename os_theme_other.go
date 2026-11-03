//go:build !windows

package main

// osDarkMode is unknown before the app runs on this platform, so "auto" keeps the light background.
func osDarkMode() bool {
	return false
}
