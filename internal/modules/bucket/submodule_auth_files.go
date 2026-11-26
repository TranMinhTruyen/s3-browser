package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Các loại file ChooseAuthFile có thể yêu cầu chọn.
const (
	authFileCert = "cert"
	authFileKey  = "key"
	authFileCa   = "ca"
)

// submoduleAuthFilesMng cho phép người dùng chọn file chứng chỉ, khóa và CA của hồ sơ.
type submoduleAuthFilesMng struct {
	logger *slog.Logger
	app    *application.App
}

// newSubmoduleAuthFilesMng tạo bộ chọn file.
func newSubmoduleAuthFilesMng(app *application.App, logger *slog.Logger) *submoduleAuthFilesMng {
	return &submoduleAuthFilesMng{logger: logger.With("submodules", "auth_files"), app: app}
}

// chooseAuthFile mở hộp thoại của hệ điều hành để chọn file thuộc loại đã cho (cert, key hoặc ca) rồi trả đường dẫn.
// Body rỗng nếu người dùng hủy. Hộp thoại chặn cho đến khi đóng nên không đặt timeout.
func (m *submoduleAuthFilesMng) chooseAuthFile(kind string) models.Output[string] {
	output := models.NewOutput[string]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	switch kind {
	case authFileCert, authFileCa:
		dialog.AddFilter("Certificate files", "*.pem;*.crt;*.cer")
	case authFileKey:
		dialog.AddFilter("Key files", "*.pem;*.key")
	default:
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, "unknown file kind"))
	}
	dialog.AddFilter("All files", "*.*")
	// Ứng dụng chỉ có một cửa sổ; gắn hộp thoại vào cửa sổ này để hộp thoại ở chế độ modal (Current có thể là nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if utils.IsDialogCancelled(err) {
		m.logger.Debug("choose auth file cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("choose auth file error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, err.Error()))
	}
	output.Body = path
	return output
}
