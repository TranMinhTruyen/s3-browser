package bucket

import "time"

// OidcLoginOutput là kết quả đăng nhập OIDC. Token được giữ ở backend; frontend chỉ nhận session id để gửi lại trong
// ConnectionProfileInput.OidcSessionId.
type OidcLoginOutput struct {
	SessionId string    `json:"sessionId"`
	ExpiresAt time.Time `json:"expiresAt"`
}
