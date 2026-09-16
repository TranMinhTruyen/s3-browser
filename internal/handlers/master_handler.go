package handlers

import (
	"S3Browser/internal/modules/master"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type MasterHandler struct {
	logger *slog.Logger
	app    *application.App
	master *master.Module
}

func NewMasterHandler(app *application.App, logger *slog.Logger, master *master.Module) *MasterHandler {
	return &MasterHandler{
		logger: logger.With("component", "master_handler"),
		app:    app,
		master: master,
	}
}

func (h *MasterHandler) GetMasterData(codes []string) models.Output[models.GetMasterDataOutput] {
	return h.master.GetMasterData(codes)
}

func (h *MasterHandler) GetRegionData() models.Output[models.RegionOutput] {
	return h.master.GetRegion()
}
