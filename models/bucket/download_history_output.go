package bucket

import (
	"time"
)

// DownloadHistoryItem là một lượt tải xuống đã hoàn tất hoặc đang chạy.
type DownloadHistoryItem struct {
	ID        string    `json:"id"`
	FileName  string    `json:"fileName,omitempty"`
	DestPath  string    `json:"destPath,omitempty"`
	Status    string    `json:"status,omitempty"`
	Size      float64   `json:"size,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
	Version   int64     `json:"version,omitempty"`
}

// DownloadHistoryOutput là một trang lịch sử tải xuống; AfterID là cursor của trang tiếp theo.
type DownloadHistoryOutput struct {
	DownloadHistoryList []DownloadHistoryItem `json:"downloadHistoryList,omitempty"`
	AfterID             string                `json:"afterID"`
}
