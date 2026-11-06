package bucket

// CheckBucketAccessOutput holds the access flags (Name, Inaccessible, ReadOnly, AccessPending) of the asked buckets.
type CheckBucketAccessOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
}
