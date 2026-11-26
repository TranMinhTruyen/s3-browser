package bucket

// BucketDetailOutput chứa thông tin chi tiết chỉ đọc của bucket. Con trỏ nil nghĩa là không đọc được mục đó
// (bị từ chối, không hỗ trợ, timeout); frontend sẽ hiển thị "-".
type BucketDetailOutput struct {
	Region      *string `json:"region"`
	Arn         string  `json:"arn"`
	EndpointUrl string  `json:"endpointUrl"`
	// PolicyMode là "private", "public" hoặc "custom".
	PolicyMode    *string `json:"policyMode"`
	PublicBlocked *bool   `json:"publicBlocked"`
	// Versioning là "Enabled", "Suspended" hoặc "Off".
	Versioning *string `json:"versioning"`
	// Encryption là thuật toán mặc định (kèm id khóa KMS nếu có) hoặc "None".
	Encryption *string `json:"encryption"`
	// ObjectLock là "Enabled" (kèm thời hạn lưu giữ mặc định nếu có) hoặc "Disabled".
	ObjectLock *string `json:"objectLock"`
	// Tags rỗng nếu bucket không có tag.
	Tags *map[string]string `json:"tags"`
	// RootCount là số object và thư mục ở gốc, tối đa 10.000.
	RootCount *int `json:"rootCount"`
	// RootCountCapped là true nếu ở gốc có nhiều mục hơn RootCount.
	RootCountCapped bool `json:"rootCountCapped"`
}
