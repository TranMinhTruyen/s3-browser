// Package handlers cung cấp các module cho frontend dưới dạng service Wails. Handler chỉ đóng vai trò chuyển tiếp
// lời gọi đến module, nơi xử lý logic.
package handlers

import (
	"S3Browser/internal/modules/master"
	"S3Browser/models"
)

// MasterHandler là service Wails cung cấp dữ liệu danh mục.
type MasterHandler struct {
	master *master.Module
}

// NewMasterHandler tạo handler danh mục.
func NewMasterHandler(master *master.Module) *MasterHandler {
	return &MasterHandler{
		master: master,
	}
}

// GetMasterData trả về các mục danh mục ứng với những code đã cho.
func (h *MasterHandler) GetMasterData(codes []string) models.Output[models.GetMasterDataOutput] {
	return h.master.GetMasterData(codes)
}

// GetRegionData trả về các region được nhóm theo provider.
func (h *MasterHandler) GetRegionData() models.Output[models.RegionOutput] {
	return h.master.GetRegion()
}
