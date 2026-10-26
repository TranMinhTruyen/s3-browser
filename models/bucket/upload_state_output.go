package bucket

// UploadStatus is how an upload ended.
type UploadStatus string

const (
	UploadStatusSuccess  UploadStatus = "success"
	UploadStatusError    UploadStatus = "error"
	UploadStatusCanceled UploadStatus = "canceled"
)

// UploadStartedOutput is the payload of the event sent before a file starts uploading.
type UploadStartedOutput struct {
	UploadId string `json:"uploadId"`
	// FileName is the base name of the local file.
	FileName string `json:"fileName"`
	// Key is the real S3 key (after the rename for a taken key).
	Key    string `json:"key"`
	Bucket string `json:"bucket"`
	// Total is the file size in bytes (0 if it couldn't be read).
	Total int64 `json:"total"`
}

// UploadFinishedOutput is the payload of the event sent when a file's upload ends.
type UploadFinishedOutput struct {
	UploadId string       `json:"uploadId"`
	Status   UploadStatus `json:"status"`
}
