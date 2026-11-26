package handlers

import (
	"S3Browser/internal/modules/update"
	"S3Browser/models"
	"context"
)

// UpdateHandler là service Wails quản lý việc tự cập nhật ứng dụng.
type UpdateHandler struct {
	update *update.Module
}

// NewUpdateHandler tạo handler cập nhật.
func NewUpdateHandler(update *update.Module) *UpdateHandler {
	return &UpdateHandler{
		update: update,
	}
}

// GetUpdateState trả về trạng thái cập nhật hiện tại.
func (h *UpdateHandler) GetUpdateState() models.Output[models.UpdateStateOutput] {
	return h.update.GetState()
}

// CheckUpdate tìm bản phát hành mới hơn khi người dùng yêu cầu.
func (h *UpdateHandler) CheckUpdate(ctx context.Context) models.Output[models.UpdateStateOutput] {
	return h.update.Check(ctx)
}

// DownloadUpdate bắt đầu tải bản phát hành mới xuống rồi trả về ngay.
func (h *UpdateHandler) DownloadUpdate() models.Output[models.UpdateStateOutput] {
	return h.update.Download()
}

// SetUpdateOptions áp dụng ngay các tùy chọn beta và tự động cập nhật cho bộ cập nhật, không lưu cài đặt.
func (h *UpdateHandler) SetUpdateOptions(betaUpdate, autoUpdate bool) models.Output[models.UpdateStateOutput] {
	return h.update.SetOptions(betaUpdate, autoUpdate)
}

// InstallUpdate chạy bộ cài đã tải xuống rồi thoát ứng dụng.
func (h *UpdateHandler) InstallUpdate() models.Output[models.UpdateStateOutput] {
	return h.update.Install()
}
