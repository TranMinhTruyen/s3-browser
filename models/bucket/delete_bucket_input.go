package bucket

// DeleteBucketInput chỉ định bucket cần xóa hoặc bucket cần lấy thông tin trước khi xóa.
type DeleteBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Bucket       string `json:"bucket"`
}
