package handlers

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
)

// ProfileHandler là service Wails quản lý hồ sơ kết nối.
type ProfileHandler struct {
	profile *profile.Module
}

// NewProfileHandler tạo handler hồ sơ.
func NewProfileHandler(profile *profile.Module) *ProfileHandler {
	return &ProfileHandler{
		profile: profile,
	}
}

// CreateProfile lưu hồ sơ kết nối mới.
func (h *ProfileHandler) CreateProfile(
	profileInput models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return h.profile.CreateProfile(profileInput)
}

// UpdateProfileById cập nhật hồ sơ kết nối.
func (h *ProfileHandler) UpdateProfileById(
	input models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return h.profile.UpdateProfileById(input)
}

// DeleteProfileById xóa hồ sơ và đóng kết nối đang hoạt động của hồ sơ đó.
func (h *ProfileHandler) DeleteProfileById(input models.ConnectionProfileInput) models.Output[bool] {
	return h.profile.DeleteProfileById(input)
}

// GetAllConnectionProfile liệt kê mọi hồ sơ cùng trạng thái kết nối.
func (h *ProfileHandler) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	return h.profile.GetAllConnectionProfile()
}

// ExportProfile lưu hồ sơ vào file JSON rồi trả về đường dẫn (rỗng nếu hủy hộp thoại).
func (h *ProfileHandler) ExportProfile(input models.ExportProfileInput) models.Output[string] {
	return h.profile.ExportProfile(input)
}

// ChooseImportFile mở hộp thoại chọn file hồ sơ rồi trả về đường dẫn (rỗng nếu hủy).
func (h *ProfileHandler) ChooseImportFile() models.Output[models.ImportFileOutput] {
	return h.profile.ChooseImportFile()
}

// ImportProfile lưu hồ sơ trong file thành hồ sơ mới.
func (h *ProfileHandler) ImportProfile(
	input models.ImportProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return h.profile.ImportProfile(input)
}
