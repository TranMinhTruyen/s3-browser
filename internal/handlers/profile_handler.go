package handlers

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ProfileHandler is the Wails service for connection profiles.
type ProfileHandler struct {
	logger  *slog.Logger
	app     *application.App
	profile *profile.Module
}

// NewProfileHandler creates the profile handler.
func NewProfileHandler(app *application.App, logger *slog.Logger, profile *profile.Module) *ProfileHandler {
	return &ProfileHandler{
		logger:  logger.With("component", "profile_handler"),
		app:     app,
		profile: profile,
	}
}

// CreateProfile saves a new connection profile.
func (h *ProfileHandler) CreateProfile(
	profileInput models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return h.profile.CreateProfile(profileInput)
}

// UpdateProfileById updates a connection profile.
func (h *ProfileHandler) UpdateProfileById(
	input models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return h.profile.UpdateProfileById(input)
}

// DeleteProfileById deletes a profile and closes its active connection.
func (h *ProfileHandler) DeleteProfileById(input models.ConnectionProfileInput) models.Output[bool] {
	return h.profile.DeleteProfileById(input)
}

// GetAllConnectionProfile lists all profiles with their connected state.
func (h *ProfileHandler) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	return h.profile.GetAllConnectionProfile()
}
