// Package setting chứa các model của module cài đặt ứng dụng.
package setting

// SaveSettingInput chứa các cài đặt người dùng muốn lưu.
type SaveSettingInput struct {
	Theme           string `json:"theme"`
	Font            string `json:"font"`
	Language        string `json:"language"`
	Size            string `json:"size"`
	LaunchOnStartup bool   `json:"launchOnStartup"`
	AutoUpdate      bool   `json:"autoUpdate"`
	BetaUpdate      bool   `json:"betaUpdate"`
}
