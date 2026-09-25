package bucket

import "time"

type ObjectItem struct {
	Key          string    `json:"key"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
}

type ListObjectOutput struct {
	ObjectList []ObjectItem `json:"objectList"`
	NextCursor *string      `json:"nextCursor,omitempty"`
}
