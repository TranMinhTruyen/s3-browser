package bucket

import "time"

// Bucket is one bucket of a connection.
type Bucket struct {
	Name         string    `json:"name,omitempty"`
	CreationDate time.Time `json:"creationDate"`
}

// ListBucketOutput is one page of buckets; NextCursor is nil on the last page.
type ListBucketOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
	NextCursor *string  `json:"nextCursor,omitempty"`
}
