package bucket

// UploadProgressBatchOutput is the payload of the upload progress event: the progress of every running upload.
type UploadProgressBatchOutput struct {
	Items []UploadProgressOutput `json:"items"`
}
