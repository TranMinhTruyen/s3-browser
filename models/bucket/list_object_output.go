package bucket

import "time"

// ObjectItem là object hoặc thư mục (common prefix) trong bucket.
type ObjectItem struct {
	Key          string    `json:"key"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
	// IsFolder đánh dấu common prefix (ví dụ "photos/2026/"), không phải object thật.
	// Với thư mục, chỉ đặt Key và Name.
	IsFolder bool `json:"isFolder"`
}

// ListObjectOutput là một trang object; NextCursor là nil ở trang cuối.
type ListObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor *string      `json:"nextCursor,omitempty"`
	// Bật AccessDenied khi máy chủ trả 403 để frontend có thể quay lại danh sách bucket.
	AccessDenied bool `json:"accessDenied,omitempty"`
}
