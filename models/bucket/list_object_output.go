package bucket

import "time"

type ObjectItem struct {
	Key          string    `json:"key"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
	// IsFolder marks a common prefix (e.g. "photos/2026/"), not a real object.
	// Only Key and Name are set for a folder.
	IsFolder bool `json:"isFolder"`
}

type ListObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor *string      `json:"nextCursor,omitempty"`
}
