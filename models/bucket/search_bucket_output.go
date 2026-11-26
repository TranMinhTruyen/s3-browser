package bucket

// SearchBucketOutput là một trang bucket khớp; NextCursor rỗng nghĩa là không còn kết quả.
type SearchBucketOutput struct {
	BucketList []Bucket `json:"bucketList"`
	NextCursor string   `json:"nextCursor"`
}
