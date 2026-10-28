package bucket

// SearchBucketOutput is one page of matching buckets; an empty NextCursor means no more results.
type SearchBucketOutput struct {
	BucketList []Bucket `json:"bucketList"`
	NextCursor string   `json:"nextCursor"`
}
