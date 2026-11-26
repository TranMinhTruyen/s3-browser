package bucket

// UploadStatus mô tả trạng thái kết thúc của một lượt tải lên.
type UploadStatus string

// Các giá trị UploadStatus có thể có.
const (
	UploadStatusSuccess  UploadStatus = "success"
	UploadStatusError    UploadStatus = "error"
	UploadStatusCanceled UploadStatus = "canceled"
)

// UploadStartedOutput là payload của sự kiện gửi trước khi bắt đầu tải file lên.
type UploadStartedOutput struct {
	UploadId string `json:"uploadId"`
	// FileName là tên cơ sở của file trên máy.
	FileName string `json:"fileName"`
	// Key là key S3 thực tế (sau khi đổi tên nếu key đã được dùng).
	Key    string `json:"key"`
	Bucket string `json:"bucket"`
	// Total là kích thước file tính bằng byte (0 nếu không đọc được).
	Total int64 `json:"total"`
}

// UploadFinishedOutput là payload của sự kiện gửi khi kết thúc tải file lên.
type UploadFinishedOutput struct {
	UploadId string       `json:"uploadId"`
	Status   UploadStatus `json:"status"`
}
