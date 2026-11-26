package bucket

// UploadProgressBatchOutput là payload của sự kiện tiến độ tải lên, gồm tiến độ của mọi lượt tải lên đang chạy.
type UploadProgressBatchOutput struct {
	Items []UploadProgressOutput `json:"items"`
}
