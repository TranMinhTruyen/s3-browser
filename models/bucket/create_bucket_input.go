package bucket

// CreateBucketInput asks to create a bucket on a connection.
type CreateBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Region is only used by real AWS; empty means the region of the connection.
	Region string `json:"region,omitempty"`
	// Mode is the access set after creating: private (or empty, nothing is set), public or custom.
	Mode string `json:"mode,omitempty"`
	// Policy is the policy JSON, only used by the custom mode.
	Policy string `json:"policy,omitempty"`
}
