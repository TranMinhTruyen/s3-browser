package handlers

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
)

// ProfileHandler is the Wails service for connection profiles.
type ProfileHandler struct {
	profile *profile.Module
}

// NewProfileHandler creates the profile handler.
func NewProfileHandler(profile *profile.Module) *ProfileHandler {
	return &ProfileHandler{
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

// ExportProfile saves a profile to a JSON file and returns its path (empty when the dialog is cancelled).
func (h *ProfileHandler) ExportProfile(input models.ExportProfileInput) models.Output[string] {
	return h.profile.ExportProfile(input)
}
