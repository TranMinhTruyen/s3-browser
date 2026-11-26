// Package update kiểm tra GitHub Releases để tìm phiên bản mới, tải bộ cài NSIS có kiểm tra SHA-256 rồi chạy bộ cài.
// Module là API công khai để các handler gọi; phần xử lý nằm trong các file submodule_*.go.
package update

import (
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Mã thông báo mà module update trả về cho frontend.
// Quy ước đặt tên: UPS = thành công, UPE = lỗi.
var (
	// Đang sử dụng phiên bản mới nhất {version}.
	UPS001 = "UPS001"

	// Không thể kiểm tra bản cập nhật.
	UPE001 = "UPE001"

	// GitHub đang giới hạn số yêu cầu; hãy thử lại sau.
	UPE002 = "UPE002"

	// Không thể tải bản cập nhật.
	UPE003 = "UPE003"

	// Bản cập nhật không có checksum hoặc checksum không khớp; file đã bị xóa.
	UPE004 = "UPE004"

	// Không thể chạy bộ cài (hoặc quyền quản trị viên đã bị từ chối).
	UPE005 = "UPE005"

	// Phiên bản {version} không có bộ cài dành cho máy này.
	UPE006 = "UPE006"
)

// Module quản lý việc tự cập nhật ứng dụng.
type Module struct {
	app *application.App
	mng *submoduleUpdateMng
}

// NewModule tạo module update. version được lấy từ build/config.yml; tính năng này tắt với bản portable
// và bản dựng không dùng NSIS, luôn bật trong chế độ dev để kiểm thử. Việc kiểm tra định kỳ bắt đầu khi
// autoUpdate được bật trong cài đặt đã lưu.
func NewModule(app *application.App, logger *slog.Logger, setting *setting.Module, version string, devMode bool,
) *Module {
	m := &Module{app: app, mng: newSubmoduleUpdateMng(app, logger, version, devMode)}
	saved := setting.GetSettings().Body.Settings
	m.mng.setBeta(saved.BetaUpdate)
	m.mng.setAutoUpdate(saved.AutoUpdate)
	return m
}

// GetState trả về trạng thái cập nhật hiện tại.
func (m *Module) GetState() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	output.Body = m.mng.snapshot()
	return output
}

// Check tìm bản phát hành mới hơn khi người dùng yêu cầu. Kết quả nằm trong trạng thái trả về; nếu bỏ qua lần
// kiểm tra vì đang có lần khác chạy, đang tải xuống hoặc đã có bộ cài sẵn sàng thì trạng thái không đổi.
// Khi bật tự động cập nhật, bản phát hành mới sẽ được tải xuống ngay.
func (m *Module) Check(ctx context.Context) models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer context.AfterFunc(m.app.Context(), cancel)()

	err := m.mng.check(ctx)
	output.Body = m.mng.snapshot()
	switch {
	case errors.Is(err, errBusy):
	case errors.Is(ctx.Err(), context.Canceled):
		output.Result = false
	case err != nil:
		return output.ThrowError(errorMessage(err))
	case output.Body.State == stateUpToDate:
		output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Update, UPS001, "",
			map[string]any{"version": output.Body.CurrentVersion}))
	}
	return output
}

// Download bắt đầu tải bản phát hành tìm được ở lần kiểm tra gần nhất rồi trả về ngay; tiến độ được gửi qua
// sự kiện update:state-changed.
func (m *Module) Download() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	err := m.mng.startDownload()
	output.Body = m.mng.snapshot()
	if err != nil {
		return output.ThrowError(errorMessage(err))
	}
	return output
}

// Install chạy ngầm bộ cài đã tải xuống (Windows sẽ hỏi quyền quản trị viên) rồi thoát ứng dụng; bộ cài khởi
// chạy phiên bản mới sau khi hoàn tất. Nếu không chạy được bộ cài, ứng dụng vẫn tiếp tục hoạt động.
func (m *Module) Install() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	err := m.mng.install()
	output.Body = m.mng.snapshot()
	if err != nil {
		return output.ThrowError(errorMessage(err))
	}
	m.app.Quit()
	return output
}

// SetAutoUpdate bật hoặc tắt kiểm tra định kỳ. Lượt tải xuống đang chạy vẫn tiếp tục.
func (m *Module) SetAutoUpdate(enabled bool) {
	m.mng.setAutoUpdate(enabled)
}

// SetBeta quyết định các lần kiểm tra tiếp theo có xét cả bản phát hành thử nghiệm (true) hay chỉ bản ổn định (false).
func (m *Module) SetBeta(enabled bool) {
	m.mng.setBeta(enabled)
}

// SetOptions áp dụng đồng thời hai tùy chọn cập nhật, không lưu chúng, rồi trả về trạng thái mới.
func (m *Module) SetOptions(beta, autoUpdate bool) models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	m.mng.setBeta(beta)
	m.mng.setAutoUpdate(autoUpdate)
	output.Body = m.mng.snapshot()
	return output
}

// Close dừng kiểm tra định kỳ và mọi lượt tải xuống.
func (m *Module) Close() {
	m.mng.close()
}

// errorMessage chuyển lỗi của submodule thành thông báo tương ứng; các lỗi khác dùng UPE001.
func errorMessage(err error) models.Message {
	var updErr *updateError
	if !errors.As(err, &updErr) {
		updErr = &updateError{code: UPE001, err: err}
	}
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Update, updErr.code, updErr.err.Error(),
		map[string]any{"version": updErr.version})
}
