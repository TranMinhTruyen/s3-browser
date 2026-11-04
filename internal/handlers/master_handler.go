// Package handlers exposes the modules to the frontend as Wails services. Handlers stay thin:
// they only forward to the module, which owns the logic.
package handlers

import (
	"S3Browser/internal/modules/master"
	"S3Browser/models"
)

// MasterHandler is the Wails service for master data.
type MasterHandler struct {
	master *master.Module
}

// NewMasterHandler creates the master handler.
func NewMasterHandler(master *master.Module) *MasterHandler {
	return &MasterHandler{
		master: master,
	}
}

// GetMasterData returns the master items of the given codes.
func (h *MasterHandler) GetMasterData(codes []string) models.Output[models.GetMasterDataOutput] {
	return h.master.GetMasterData(codes)
}

// GetRegionData returns the regions grouped by provider.
func (h *MasterHandler) GetRegionData() models.Output[models.RegionOutput] {
	return h.master.GetRegion()
}
