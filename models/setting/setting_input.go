// Package setting holds the models of the app settings module.
package setting

// SaveSettingInput is the settings the user wants to persist.
type SaveSettingInput struct {
	Theme           string `json:"theme"`
	Font            string `json:"font"`
	Language        string `json:"language"`
	LaunchOnStartup bool   `json:"launchOnStartup"`
}
