package bucket

// ObjectDetailOutput chứa thông tin HeadObject của một object.
type ObjectDetailOutput struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	// StorageClass rỗng nếu provider không trả về (S3 bỏ qua trường này với STANDARD).
	StorageClass string `json:"storageClass"`
	// Metadata là metadata do người dùng đặt (x-amz-meta-*), key ở dạng chữ thường. Không bao giờ nil.
	Metadata map[string]string `json:"metadata"`
}
