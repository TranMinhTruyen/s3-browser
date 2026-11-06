package bucket

import "time"

// ObjectItem is an object or a folder (common prefix) of a bucket.
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

// ListObjectOutput is one page of objects; NextCursor is nil on the last page.
type ListObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor *string      `json:"nextCursor,omitempty"`
	// AccessDenied is set when the server answered 403, so the frontend can go back to the bucket list.
	AccessDenied bool `json:"accessDenied,omitempty"`
}
