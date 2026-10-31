package bucket

import "time"

// CredentialExpiringOutput is the payload of the event sent shortly before credentials that can't be renewed
// automatically expire (assumeRole with MFA, sso, minioOidc).
type CredentialExpiringOutput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName"`
	AuthType     string `json:"authType"`
	// AwsProfile is the AWS CLI profile name, for the "aws sso login --profile" hint.
	AwsProfile string    `json:"awsProfile,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
