package cnst

import "slices"

// Storage providers a profile can connect to.
const (
	ProviderAWS   = "aws"
	ProviderMinio = "minio"
)

// Authentication methods (connection_profiles.auth_type). Keep in sync with the CHECK in the
// 000002_auth_methods.sql migration and with frontend authMethods.ts.
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

// authMethodsByProvider lists the methods each provider accepts.
var authMethodsByProvider = map[string][]string{
	ProviderAWS: {
		AuthStatic, AuthSharedProfile, AuthAssumeRole, AuthSSO, AuthDefaultChain, AuthAnonymous,
	},
	ProviderMinio: {
		AuthStatic, AuthMinioAssumeRole, AuthMinioLdap, AuthMinioOidc, AuthMinioCert, AuthAnonymous,
	},
}

// IsAuthTypeValid reports whether provider supports authType.
func IsAuthTypeValid(provider, authType string) bool {
	return slices.Contains(authMethodsByProvider[provider], authType)
}

// IsAutoConnectAllowed reports whether a profile can connect without user action: OIDC needs a browser
// login, and an AssumeRole profile with an MFA serial needs a fresh MFA code on every connect.
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
