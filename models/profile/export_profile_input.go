package profile

// ExportProfileInput chọn hồ sơ cần xuất. Nếu bật IncludeSecret, các secret đã lưu sẽ được mã hóa bằng Password
// (ít nhất 8 ký tự) rồi ghi vào file. Password không bao giờ được lưu hoặc ghi log.
type ExportProfileInput struct {
	Id            string `json:"id"`
	IncludeSecret bool   `json:"includeSecret"`
	Password      string `json:"password,omitempty"`
}
