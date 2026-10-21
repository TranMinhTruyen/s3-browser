package bucket

type UploadProgressOutput struct {
	UploadId string `json:"uploadId"`
	Uploaded int64  `json:"uploaded"`
	Total    int64  `json:"total"`
}
