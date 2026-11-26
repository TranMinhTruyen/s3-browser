package bucket

import "time"

// CredentialExpiringOutput là payload của sự kiện được gửi ngay trước khi thông tin xác thực không thể tự gia hạn
// sắp hết hạn (assumeRole kèm MFA, sso, minioOidc).
type CredentialExpiringOutput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName"`
	AuthType     string `json:"authType"`
	// AwsProfile là tên hồ sơ AWS CLI, dùng trong gợi ý "aws sso login --profile".
	AwsProfile string    `json:"awsProfile,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
