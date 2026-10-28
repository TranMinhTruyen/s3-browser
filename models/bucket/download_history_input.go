package bucket

// DownloadHistoryInput is a keyset page request: AfterID is the last ID of the previous page.
type DownloadHistoryInput struct {
	AfterID  string `json:"afterID"`
	PageSize int64  `json:"pageSize"`
}
