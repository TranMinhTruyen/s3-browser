package bucket

type SearchBucketOutput struct {
	BucketList []Bucket `json:"bucketList"`
	NextCursor string   `json:"nextCursor"`
}
