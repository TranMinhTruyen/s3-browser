package profile

// ImportProfileInput chọn file hồ sơ cần nhập. Password dùng để giải mã secret trong file đã mã hóa và không bao giờ
// được lưu hoặc ghi log.
type ImportProfileInput struct {
	Path     string `json:"path"`
	Password string `json:"password,omitempty"`
}
