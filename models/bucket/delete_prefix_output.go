package bucket

// DeletePrefixOutput đếm số object đã xóa và số object xóa thất bại.
// Failed là tổng số lỗi; Failures chỉ giữ chi tiết của các lỗi đầu tiên.
type DeletePrefixOutput struct {
	Deleted  int             `json:"deleted"`
	Failed   int             `json:"failed"`
	Failures []DeleteFailure `json:"failures"`
}
