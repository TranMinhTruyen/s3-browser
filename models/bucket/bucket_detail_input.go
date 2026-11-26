package bucket

// BucketDetailInput chỉ định bucket cần lấy thông tin chi tiết.
type BucketDetailInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
