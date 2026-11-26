// Package db chứa các model đầu vào/đầu ra của module cơ sở dữ liệu (chế độ SQL).
package db

// DbProfileConfig là cấu hình kết nối của hồ sơ cơ sở dữ liệu, được lưu dưới dạng JSON. Chỉ giữ các trường của provider
// trong hồ sơ: sqlite dùng FilePath và ReadOnly, postgres dùng các trường còn lại. Mật khẩu không được lưu tại đây.
type DbProfileConfig struct {
	FilePath string `json:"filePath,omitempty"` // sqlite
	ReadOnly bool   `json:"readOnly,omitempty"` // sqlite
	Host     string `json:"host,omitempty"`     // postgres
	Port     int    `json:"port,omitempty"`     // postgres
	Database string `json:"database,omitempty"` // postgres
	Username string `json:"username,omitempty"` // postgres
	SslMode  string `json:"sslMode,omitempty"`  // postgres
}

// DbProfileInput là dữ liệu biểu mẫu để tạo hoặc cập nhật hồ sơ cơ sở dữ liệu. Id rỗng khi tạo mới. Secret là mật khẩu
// dạng văn bản thuần; nếu để trống khi cập nhật thì giữ mật khẩu đã lưu nếu provider không đổi.
type DbProfileInput struct {
	Id       string          `json:"id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Color    string          `json:"color,omitempty"`
	Provider string          `json:"provider,omitempty"`
	Config   DbProfileConfig `json:"config"`
	Secret   string          `json:"secret,omitempty"`
}

// DbProfileRefInput chỉ định một hồ sơ cơ sở dữ liệu đã lưu.
type DbProfileRefInput struct {
	ProfileId string `json:"profileId"`
}
