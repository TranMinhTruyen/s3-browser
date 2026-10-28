package bucket

// DownloadProgressOutput is the payload of the download progress event (sizes in bytes).
type DownloadProgressOutput struct {
	DownloadId string `json:"downloadId"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}
