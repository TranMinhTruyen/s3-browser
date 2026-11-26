package bucket

// DownloadProgressOutput là payload của sự kiện tiến độ tải xuống (kích thước tính bằng byte).
type DownloadProgressOutput struct {
	DownloadId string `json:"downloadId"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}
