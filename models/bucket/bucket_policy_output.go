package bucket

// BucketPolicyOutput là trạng thái truy cập của một bucket.
type BucketPolicyOutput struct {
	// Mode là "private" (không có policy), "public" (policy công khai chỉ đọc) hoặc "custom".
	Mode string `json:"mode"`
	// Policy là JSON policy, rỗng nếu ở chế độ private.
	Policy string `json:"policy"`
	// PublicBlocked là true nếu Block Public Access cấm policy công khai (chỉ có trên AWS thật).
	PublicBlocked bool `json:"publicBlocked"`
	// EditDenied là true nếu tài khoản được xác định là không có quyền thay đổi policy.
	EditDenied bool `json:"editDenied"`
}
