package bucket

type DownloadHistoryInput struct {
	AfterID  string `json:"afterID"`
	PageSize int64  `json:"pageSize"`
}
