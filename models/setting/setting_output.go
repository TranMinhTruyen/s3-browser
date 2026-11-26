package setting

// AppSettings là nội dung của settings.json.
type AppSettings struct {
	Theme           string `json:"theme"`
	Font            string `json:"font"`
	Language        string `json:"language"`
	Size            string `json:"size"`
	LaunchOnStartup bool   `json:"launchOnStartup"`
	AutoUpdate      bool   `json:"autoUpdate"`
	BetaUpdate      bool   `json:"betaUpdate"`
}

// SettingsOutput chứa cài đặt và thông tin tùy chọn "khởi chạy cùng hệ thống" có dùng được trên bản dựng, hệ điều hành này hay không.
type SettingsOutput struct {
	Settings           AppSettings `json:"settings"`
	AutostartSupported bool        `json:"autostartSupported"`
}
