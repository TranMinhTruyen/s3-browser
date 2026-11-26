// Package profile chứa các model đầu vào/đầu ra của module hồ sơ kết nối.
package profile

// ConnectionProfileInput là dữ liệu biểu mẫu để tạo hoặc cập nhật hồ sơ kết nối.
// Version dùng cho khóa lạc quan khi cập nhật. Secret để trống khi cập nhật sẽ giữ các giá trị đã lưu.
// MfaCode và OidcSessionId chỉ được dùng cho một lần kết nối và không bao giờ được lưu.
type ConnectionProfileInput struct {
	Id            string     `json:"id,omitempty"`
	Name          string     `json:"name,omitempty"`
	Color         string     `json:"color,omitempty"`
	Provider      string     `json:"provider,omitempty"`
	Endpoint      string     `json:"endpoint,omitempty"`
	Region        string     `json:"region,omitempty"`
	AccessKey     string     `json:"accessKey,omitempty"`
	SecretKey     string     `json:"secretKey,omitempty"`
	PathStyle     bool       `json:"pathStyle,omitempty"`
	SavePassword  bool       `json:"savePassword,omitempty"`
	AutoConnect   bool       `json:"autoConnect,omitempty"`
	Version       int64      `json:"version,omitempty"`
	AuthType      string     `json:"authType,omitempty"`
	AuthConfig    AuthConfig `json:"authConfig"`
	AuthSecret    AuthSecret `json:"authSecret"`
	MfaCode       string     `json:"mfaCode,omitempty"`
	OidcSessionId string     `json:"oidcSessionId,omitempty"`
}
