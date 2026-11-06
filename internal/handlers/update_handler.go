package handlers

import (
	"S3Browser/internal/modules/update"
	"S3Browser/models"
	"context"
)

// UpdateHandler is the Wails service for the app self-update.
type UpdateHandler struct {
	update *update.Module
}

// NewUpdateHandler creates the update handler.
func NewUpdateHandler(update *update.Module) *UpdateHandler {
	return &UpdateHandler{
		update: update,
	}
}

// GetUpdateState returns the current update state.
func (h *UpdateHandler) GetUpdateState() models.Output[models.UpdateStateOutput] {
	return h.update.GetState()
}

// CheckUpdate looks for a newer release when the user asks.
func (h *UpdateHandler) CheckUpdate(ctx context.Context) models.Output[models.UpdateStateOutput] {
	return h.update.Check(ctx)
}

// DownloadUpdate starts downloading the new release and returns at once.
func (h *UpdateHandler) DownloadUpdate() models.Output[models.UpdateStateOutput] {
	return h.update.Download()
}

// InstallUpdate runs the downloaded installer and quits the app.
func (h *UpdateHandler) InstallUpdate() models.Output[models.UpdateStateOutput] {
	return h.update.Install()
}
