package bucket

// DownloadProgressBatchOutput is the payload of the download progress event: the progress of every running download.
type DownloadProgressBatchOutput struct {
	Items []DownloadProgressOutput `json:"items"`
}
