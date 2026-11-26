package profile

// ImportFileOutput mô tả file hồ sơ được chọn để nhập. Path rỗng nếu người dùng hủy hộp thoại.
// Encrypted cho biết file chứa secret nên ImportProfile cần mật khẩu.
type ImportFileOutput struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Encrypted bool   `json:"encrypted"`
}
