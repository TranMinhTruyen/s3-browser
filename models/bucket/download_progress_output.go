package bucket

type DownloadProgressOutput struct {
	DownloadId string `json:"downloadId"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}
