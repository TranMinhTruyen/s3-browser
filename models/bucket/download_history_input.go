package bucket

// DownloadHistoryInput là yêu cầu phân trang keyset: AfterID là ID cuối cùng của trang trước.
type DownloadHistoryInput struct {
	AfterID  string `json:"afterID"`
	PageSize int64  `json:"pageSize"`
}
