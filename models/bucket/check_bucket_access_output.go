package bucket

// CheckBucketAccessOutput chứa các cờ quyền truy cập (Name, Inaccessible, ReadOnly, AccessPending) của những bucket được yêu cầu.
type CheckBucketAccessOutput struct {
	BucketList []Bucket `json:"bucketList,omitempty"`
}
