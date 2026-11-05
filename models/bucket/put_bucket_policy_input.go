package bucket

// PutBucketPolicyInput sets the access mode of a bucket.
type PutBucketPolicyInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Mode is "private", "public" or "custom".
	Mode string `json:"mode"`
	// Policy is the policy JSON, only used by the "custom" mode.
	Policy string `json:"policy,omitempty"`
}
