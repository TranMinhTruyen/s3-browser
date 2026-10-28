package bucket

// UploadProgressOutput is the payload of the upload progress event (sizes in bytes).
type UploadProgressOutput struct {
	UploadId string `json:"uploadId"`
	Uploaded int64  `json:"uploaded"`
	Total    int64  `json:"total"`
}
