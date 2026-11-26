// Package update chứa các model của module tự cập nhật ứng dụng.
package update

// UpdateStateOutput là trạng thái tự cập nhật, được trả về từ các lời gọi update và gửi qua sự kiện
// update:state-changed.
type UpdateStateOutput struct {
	// Supported là false với bản dev, portable, không dùng NSIS và hệ điều hành khác; frontend sẽ ẩn tính năng.
	Supported bool `json:"supported"`
	// State là idle, checking, upToDate, available, downloading, ready hoặc error.
	State          string `json:"state"`
	CurrentVersion string `json:"currentVersion"`
	// Version là phiên bản mới, được đặt từ trạng thái available trở đi.
	Version string `json:"version,omitempty"`
	// ReleaseUrl là trang GitHub của bản phát hành mới.
	ReleaseUrl string `json:"releaseUrl,omitempty"`
	// Written và Total lần lượt là số byte đã tải và kích thước bộ cài trong khi tải xuống.
	Written int64 `json:"written"`
	Total   int64 `json:"total"`
	// ErrorCode là mã thông báo lỗi (UPE...) khi State là error.
	ErrorCode string `json:"errorCode,omitempty"`
}
