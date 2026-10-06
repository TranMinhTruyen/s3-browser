package bucket

import (
	"time"
)

type DownloadHistoryItem struct {
	ID        string    `json:"id"`
	FileName  string    `json:"file_name,omitempty"`
	DestPath  string    `json:"dest_path,omitempty"`
	Status    string    `json:"status,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
	Version   int64     `json:"version,omitempty"`
}

type DownloadHistoryOutput struct {
	DownloadHistoryList []DownloadHistoryItem `json:"downloadHistoryList,omitempty"`
}
