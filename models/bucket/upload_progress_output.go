package bucket

// UploadProgressOutput là payload của sự kiện tiến độ tải lên (kích thước tính bằng byte).
type UploadProgressOutput struct {
	UploadId string `json:"uploadId"`
	Uploaded int64  `json:"uploaded"`
	Total    int64  `json:"total"`
}
