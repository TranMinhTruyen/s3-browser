package bucket

// BucketPolicyInput identifies the bucket whose policy is requested.
type BucketPolicyInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
