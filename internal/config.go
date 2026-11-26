package internal

import "encoding/json"

// Config chứa các trường được đọc lại từ wails.json khi chạy,
// để file cấu hình dự án tiếp tục là nguồn duy nhất của metadata ứng dụng.
type Config struct {
	Name string `json:"name"`
	// Version và DevMode không có trong wails.json: main lấy chúng từ build/config.yml và build tag.
	Version string `json:"-"`
	DevMode bool   `json:"-"`
}

// ParseConfig giải mã payload wails.json được nhúng và truyền vào từ main.
// Payload sai định dạng sẽ trả Config zero thay vì lỗi.
func ParseConfig(raw []byte) Config {
	var cfg Config
	_ = json.Unmarshal(raw, &cfg) // on error keep whatever was decoded, see doc
	return cfg
}
