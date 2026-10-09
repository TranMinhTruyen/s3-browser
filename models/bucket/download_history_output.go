package bucket

import (
	"time"
)

type DownloadHistoryItem struct {
	ID        string    `json:"id"`
	FileName  string    `json:"fileName,omitempty"`
	DestPath  string    `json:"destPath,omitempty"`
	Status    string    `json:"status,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
	Version   int64     `json:"version,omitempty"`
}

type DownloadHistoryOutput struct {
	DownloadHistoryList []DownloadHistoryItem `json:"downloadHistoryList,omitempty"`
}
