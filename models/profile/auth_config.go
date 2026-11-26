package profile

import "strings"

// AuthConfig là phần cấu hình không bí mật theo từng phương thức của hồ sơ, được lưu dưới dạng JSON trong
// connection_profiles.auth_config. Một struct phẳng dùng cho mọi authType để binding TS sinh ra luôn đơn giản;
// các trường không dùng sẽ để trống.
type AuthConfig struct {
	ProfileName     string   `json:"profileName,omitempty"`     // sharedProfile, sso, assumeRole (sourceType=profile)
	ConfigFile      string   `json:"configFile,omitempty"`      // sharedProfile, sso: optional ~/.aws/config path
	CredentialsFile string   `json:"credentialsFile,omitempty"` // sharedProfile: optional ~/.aws/credentials path
	SourceType      string   `json:"sourceType,omitempty"`      // assumeRole: "static" or "profile"
	RoleArn         string   `json:"roleArn,omitempty"`         // assumeRole, minioOidc
	ExternalId      string   `json:"externalId,omitempty"`      // assumeRole
	SessionName     string   `json:"sessionName,omitempty"`     // assumeRole
	DurationSeconds int32    `json:"durationSeconds,omitempty"` // assumeRole, minioAssumeRole, minioLdap
	MfaSerial       string   `json:"mfaSerial,omitempty"`       // assumeRole
	Policy          string   `json:"policy,omitempty"`          // minioAssumeRole
	LdapUsername    string   `json:"ldapUsername,omitempty"`    // minioLdap
	ClientId        string   `json:"clientId,omitempty"`        // minioOidc
	IssuerUrl       string   `json:"issuerUrl,omitempty"`       // minioOidc
	Scope           string   `json:"scope,omitempty"`           // minioOidc
	CallbackPort    int      `json:"callbackPort,omitempty"`    // minioOidc
	CertFile        string   `json:"certFile,omitempty"`        // minioCert: path only, never the content
	KeyFile         string   `json:"keyFile,omitempty"`         // minioCert: path only, never the content
	KeyEncrypted    bool     `json:"keyEncrypted,omitempty"`    // minioCert: the key is password protected
	CaFile          string   `json:"caFile,omitempty"`          // minio, any authType: extra trusted CA, path only
	Buckets         []string `json:"buckets,omitempty"`         // anonymous
}

// BucketNames trả về tên bucket ẩn danh theo thứ tự đã nhập, loại bỏ mục rỗng và trùng lặp.
func (c AuthConfig) BucketNames() []string {
	names := make([]string, 0, len(c.Buckets))
	seen := make(map[string]struct{}, len(c.Buckets))
	for _, b := range c.Buckets {
		b = strings.TrimSpace(b)
		if _, dup := seen[b]; b == "" || dup {
			continue
		}
		seen[b] = struct{}{}
		names = append(names, b)
	}
	return names
}
