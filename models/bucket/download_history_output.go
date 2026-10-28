package bucket

import (
	"time"
)

// DownloadHistoryItem is one finished or running download.
type DownloadHistoryItem struct {
	ID        string    `json:"id"`
	FileName  string    `json:"fileName,omitempty"`
	DestPath  string    `json:"destPath,omitempty"`
	Status    string    `json:"status,omitempty"`
	Size      float64   `json:"size,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
	Version   int64     `json:"version,omitempty"`
}

// DownloadHistoryOutput is one page of the download history; AfterID is the cursor of the next page.
type DownloadHistoryOutput struct {
	DownloadHistoryList []DownloadHistoryItem `json:"downloadHistoryList,omitempty"`
	AfterID             string                `json:"afterID"`
}
