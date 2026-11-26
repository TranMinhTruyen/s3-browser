package bucket

// DeleteBucketOutput đếm số object (phiên bản và delete marker) đã xóa trước khi xóa bucket.
// Failed là tổng số lỗi; Failures chỉ giữ chi tiết của các lỗi đầu tiên.
type DeleteBucketOutput struct {
	Deleted       int             `json:"deleted"`
	Failed        int             `json:"failed"`
	Failures      []DeleteFailure `json:"failures"`
	BucketDeleted bool            `json:"bucketDeleted"`
}
