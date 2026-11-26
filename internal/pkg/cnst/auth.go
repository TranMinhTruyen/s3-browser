package cnst

import "slices"

// Các nhà cung cấp lưu trữ mà hồ sơ có thể kết nối.
const (
	ProviderAWS   = "aws"
	ProviderMinio = "minio"
)

// Các phương thức xác thực (connection_profiles.auth_type). Đồng bộ danh sách này với CHECK trong migration
// 000002_auth_methods.sql và frontend authMethods.ts.
const (
	AuthStatic          = "static"
	AuthSharedProfile   = "sharedProfile"
	AuthAssumeRole      = "assumeRole"
	AuthSSO             = "sso"
	AuthDefaultChain    = "defaultChain"
	AuthAnonymous       = "anonymous"
	AuthMinioAssumeRole = "minioAssumeRole"
	AuthMinioLdap       = "minioLdap"
	AuthMinioOidc       = "minioOidc"
	AuthMinioCert       = "minioCert"
)

// authMethodsByProvider liệt kê các phương thức được từng provider chấp nhận.
var authMethodsByProvider = map[string][]string{
	ProviderAWS: {
		AuthStatic, AuthSharedProfile, AuthAssumeRole, AuthSSO, AuthDefaultChain, AuthAnonymous,
	},
	ProviderMinio: {
		AuthStatic, AuthMinioAssumeRole, AuthMinioLdap, AuthMinioOidc, AuthMinioCert, AuthAnonymous,
	},
}

// IsAuthTypeValid cho biết provider có hỗ trợ authType hay không.
func IsAuthTypeValid(provider, authType string) bool {
	return slices.Contains(authMethodsByProvider[provider], authType)
}

// IsAutoConnectAllowed cho biết hồ sơ có thể tự kết nối mà không cần người dùng thao tác hay không: OIDC cần đăng nhập
// bằng trình duyệt; hồ sơ AssumeRole có MFA serial cần mã MFA mới ở mỗi lần kết nối.
func IsAutoConnectAllowed(authType, mfaSerial string) bool {
	switch authType {
	case AuthMinioOidc:
		return false
	case AuthAssumeRole:
		return mfaSerial == ""
	default:
		return true
	}
}
