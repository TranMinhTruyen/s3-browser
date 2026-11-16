package setting

// AppSettings is the content of settings.json.
type AppSettings struct {
	Theme           string `json:"theme"`
	Font            string `json:"font"`
	Language        string `json:"language"`
	Size            string `json:"size"`
	LaunchOnStartup bool   `json:"launchOnStartup"`
	AutoUpdate      bool   `json:"autoUpdate"`
	BetaUpdate      bool   `json:"betaUpdate"`
}

// SettingsOutput is the settings plus whether "launch on startup" can be used on this build and OS.
type SettingsOutput struct {
	Settings           AppSettings `json:"settings"`
	AutostartSupported bool        `json:"autostartSupported"`
}
