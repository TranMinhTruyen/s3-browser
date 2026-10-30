package profile

// AuthConfig is the non-secret, per-method part of a profile, stored as JSON in connection_profiles.auth_config.
// One flat struct serves every authType, so the generated TS binding stays simple; unused fields stay empty.
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
	Buckets         []string `json:"buckets,omitempty"`         // anonymous
}
