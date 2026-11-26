package update

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Tên sự kiện gửi đến frontend, theo định dạng domain:kebab-name.
const (
	// Phát khi trạng thái cập nhật thay đổi và mỗi 200 ms trong lúc tải bộ cài; payload là UpdateStateOutput.
	EventStateChanged = "update:state-changed"
)

// Phải gọi RegisterEvent trực tiếp từ init để bộ sinh binding tạo kiểu payload TypeScript
// cho Events.On / Events.Emit ở frontend.
func init() {
	application.RegisterEvent[models.UpdateStateOutput](EventStateChanged)
}
