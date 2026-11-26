package bucket

// DownloadProgressBatchOutput là payload của sự kiện tiến độ tải xuống, gồm tiến độ của mọi lượt tải xuống đang chạy.
type DownloadProgressBatchOutput struct {
	Items []DownloadProgressOutput `json:"items"`
}
