package utils

// dialogCancelled là nội dung của cfd.ErrorCancelled mà Wails trả về trên Windows khi người dùng đóng hộp thoại chọn file.
// macOS và Linux thay vào đó trả về đường dẫn rỗng cùng lỗi nil.
const dialogCancelled = "cancelled by user"

// IsDialogCancelled cho biết err có nghĩa là người dùng đã hủy hộp thoại chọn file của hệ điều hành hay không.
// So sánh nội dung lỗi vì Wails định nghĩa lỗi trong package nội bộ nên không thể import hoặc so bằng errors.Is.
func IsDialogCancelled(err error) bool {
	return err != nil && err.Error() == dialogCancelled
}
