package bucket

// CheckBucketAccessInput yêu cầu lấy cờ quyền truy cập của các bucket đã cho trong một kết nối.
type CheckBucketAccessInput struct {
	ConnectionId string   `json:"connectionId"`
	ProfileName  string   `json:"profileName,omitempty"`
	BucketNames  []string `json:"bucketNames"`
	// CheckWrite cũng đánh dấu các bucket chỉ đọc.
	CheckWrite bool `json:"checkWrite,omitempty"`
	// WithPolicy cũng đọc chế độ policy (Bucket.PolicyMode) của các bucket chưa có trong cache.
	WithPolicy bool `json:"withPolicy,omitempty"`
}
