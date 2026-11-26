package bucket

// BucketPolicyInput chỉ định bucket cần lấy policy.
type BucketPolicyInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
