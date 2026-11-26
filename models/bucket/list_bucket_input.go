package bucket

// ListBucketInput là yêu cầu lấy một trang bucket của kết nối.
type ListBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	NextCursor   string `json:"nextCursor,omitempty"`
	Limit        int32  `json:"limit,omitempty"`
	// CheckWrite yêu cầu đánh dấu bucket chỉ đọc. Chỉ bộ chọn bucket để tải lên bật tùy chọn này vì việc kiểm tra cần thêm yêu cầu.
	CheckWrite bool `json:"checkWrite,omitempty"`
	// Màn hình danh sách bucket bật LazyAccess: bucket cần phép thử riêng (HeadBucket / thử quyền ghi) nhưng chưa có kết quả
	// cache sẽ không được thăm dò, thay vào đó trả về với AccessPending để frontend kiểm tra khi hiển thị bucket.
	LazyAccess bool `json:"lazyAccess,omitempty"`
}
