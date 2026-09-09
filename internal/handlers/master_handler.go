package handlers

import (
	"S3Browser/internal/modules/master"
	"S3Browser/models/common"
	models "S3Browser/models/master"
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

func (a *MasterHandler) GetMasterData(codes []string) common.Output[models.GetMasterDataOutput] {
	return a.master.GetMasterData(codes)
}

func (a *MasterHandler) GetRegionData() common.Output[models.RegionOutput] {
	return a.master.GetRegion()
}
