package bucket

// DeleteBucketOutput counts the objects (versions and delete markers) deleted before the bucket itself.
// Failed is the total; Failures keeps the details of the first ones only.
type DeleteBucketOutput struct {
	Deleted       int             `json:"deleted"`
	Failed        int             `json:"failed"`
	Failures      []DeleteFailure `json:"failures"`
	BucketDeleted bool            `json:"bucketDeleted"`
}
