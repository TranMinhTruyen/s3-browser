package profile

// AwsProfileOutput is one profile found in the AWS CLI config files.
type AwsProfileOutput struct {
	Name                 string `json:"name"`
	Region               string `json:"region,omitempty"`
	IsSso                bool   `json:"isSso"`
	HasCredentialProcess bool   `json:"hasCredentialProcess"`
}
