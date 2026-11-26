package profile

// AwsProfileOutput là một hồ sơ tìm thấy trong các file cấu hình AWS CLI.
type AwsProfileOutput struct {
	Name                 string `json:"name"`
	Region               string `json:"region,omitempty"`
	IsSso                bool   `json:"isSso"`
	HasCredentialProcess bool   `json:"hasCredentialProcess"`
}
