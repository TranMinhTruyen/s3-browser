package bucket

type DownloadProgressOutput struct {
	ID         string `json:"id"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}
