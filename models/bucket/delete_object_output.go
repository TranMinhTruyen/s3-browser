package bucket

// DeleteObjOutput liệt kê các key đã xóa và các key xóa thất bại.
type DeleteObjOutput struct {
	Deleted []string        `json:"deleted"`
	Failed  []DeleteFailure `json:"failed"`
}
