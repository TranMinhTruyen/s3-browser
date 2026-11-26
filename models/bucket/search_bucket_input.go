package bucket

// SearchBucketInput tìm tên bucket theo Keyword và tiếp tục từ NextCursor.
type SearchBucketInput struct {
	ConnectionId string `json:"connectionId"`
	ProfileName  string `json:"profileName,omitempty"`
	Keyword      string `json:"keyword"`
	NextCursor   string `json:"nextCursor,omitempty"`
	// CheckWrite yêu cầu đánh dấu bucket chỉ đọc. Chỉ bộ chọn bucket để tải lên bật tùy chọn này vì việc kiểm tra cần thêm yêu cầu.
	CheckWrite bool `json:"checkWrite,omitempty"`
	// Màn hình danh sách bucket bật LazyAccess: bucket cần phép thử riêng (HeadBucket / thử quyền ghi) nhưng chưa có kết quả
	// cache sẽ không được thăm dò, thay vào đó trả về với AccessPending để frontend kiểm tra khi hiển thị bucket.
	LazyAccess bool `json:"lazyAccess,omitempty"`
}
