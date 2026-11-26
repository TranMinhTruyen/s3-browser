package bucket

// PutBucketPolicyInput đặt chế độ truy cập của bucket.
type PutBucketPolicyInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
	// Mode là "private", "public" hoặc "custom".
	Mode string `json:"mode"`
	// Policy là JSON policy, chỉ dùng với chế độ "custom".
	Policy string `json:"policy,omitempty"`
}
