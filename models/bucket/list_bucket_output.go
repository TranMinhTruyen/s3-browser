package bucket

import "time"

type Bucket struct {
	Name         string    `json:"name,omitempty"`
	CreationDate time.Time `json:"creationDate"`
}

type ListBucketOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
	NextCursor *string  `json:"nextCursor,omitempty"`
}
