package bucket

// DeleteBucketInfoOutput chứa thông tin hộp thoại xóa bucket cần biết.
type DeleteBucketInfoOutput struct {
	// Empty là nil nếu không đọc được trạng thái.
	Empty *bool `json:"empty"`
	// Versioning là "Enabled", "Suspended" hoặc "Off"; rỗng nếu không đọc được.
	Versioning string `json:"versioning"`
	// ObjectLock là true nếu bật Object Lock; cũng là false nếu không đọc được trạng thái.
	ObjectLock bool `json:"objectLock"`
}
