package bucket

// DeleteFailure mô tả một object không thể xóa và lý do tương ứng.
type DeleteFailure struct {
	Key   string `json:"key"`
	Error string `json:"error"`
}
