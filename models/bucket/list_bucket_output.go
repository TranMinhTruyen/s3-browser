package bucket

import "time"

// Bucket là một bucket của kết nối.
type Bucket struct {
	Name         string    `json:"name,omitempty"`
	CreationDate time.Time `json:"creationDate"`
	// Inaccessible được bật nếu đã xác định không đọc được bucket: HeadBucket thất bại (kết nối ẩn danh) hoặc trả 403
	// (các kết nối khác).
	Inaccessible bool `json:"inaccessible,omitempty"`
	// Chỉ bật ReadOnly khi thao tác liệt kê yêu cầu CheckWrite và kết nối không thể ghi (tải lên) vào bucket.
	ReadOnly bool `json:"readOnly,omitempty"`
	// Bật AccessPending khi chưa xác định quyền truy cập bucket (chưa thăm dò hoặc kết quả chưa chắc chắn);
	// frontend nên kiểm tra bằng CheckBucketAccess.
	AccessPending bool `json:"accessPending,omitempty"`
	// Chỉ bật DeleteDenied với MinIO có thông tin xác thực khi tài khoản được xác định là không có quyền
	// xóa bucket (s3:DeleteBucket).
	DeleteDenied bool `json:"deleteDenied,omitempty"`
	// PolicyMode là "private", "public" hoặc "custom"; là "unknown" nếu không đọc được policy. Rỗng nghĩa là chưa
	// xác định (chỉ CheckBucketAccess có WithPolicy mới đọc trường này) hoặc đang dùng kết nối ẩn danh.
	PolicyMode string `json:"policyMode,omitempty"`
}

// ListBucketOutput là một trang bucket; NextCursor là nil ở trang cuối.
type ListBucketOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
	NextCursor *string  `json:"nextCursor,omitempty"`
}
