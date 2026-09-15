package handlers

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	models "S3Browser/models/profile"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ProfileHandler struct {
	logger  *slog.Logger
	app     *application.App
	profile *profile.Module
}

func NewProfileHandler(app *application.App, logger *slog.Logger, profile *profile.Module) *ProfileHandler {
	return &ProfileHandler{
		logger:  logger.With("component", "master_handler"),
		app:     app,
		profile: profile,
	}
}

func (h *ProfileHandler) CreateProfile(
	profileInput bucket.ConnectionInput,
) common.Output[models.ConnectionProfileOutput] {
	return h.profile.CreateProfile(profileInput)
}

func (h *ProfileHandler) UpdateProfileById(input bucket.ConnectionInput) common.Output[models.ConnectionProfileOutput] {
	return h.profile.UpdateProfileById(input)
}

func (h *ProfileHandler) DeleteProfileById(input bucket.ConnectionInput) common.Output[bool] {
	return h.profile.DeleteProfileById(input)
}

func (h *ProfileHandler) GetAllConnectionProfile() common.Output[models.GetAllConnectionProfileOutput] {
	return h.profile.GetAllConnectionProfile()
}
