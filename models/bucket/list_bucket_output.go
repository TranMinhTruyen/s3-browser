package bucket

import "time"

// Bucket is one bucket of a connection.
type Bucket struct {
	Name         string    `json:"name,omitempty"`
	CreationDate time.Time `json:"creationDate"`
	// Inaccessible is set when the bucket is known to be unreadable: HeadBucket failed (anonymous connection) or
	// answered 403 (any other connection).
	Inaccessible bool `json:"inaccessible,omitempty"`
	// ReadOnly is set only when the listing asked for CheckWrite and the connection could not write (upload) to the
	// bucket.
	ReadOnly bool `json:"readOnly,omitempty"`
	// AccessPending is set when the access of the bucket is not known yet (not probed, or the probe gave no sure
	// answer); the frontend should check it with CheckBucketAccess.
	AccessPending bool `json:"accessPending,omitempty"`
}

// ListBucketOutput is one page of buckets; NextCursor is nil on the last page.
type ListBucketOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
	NextCursor *string  `json:"nextCursor,omitempty"`
}
