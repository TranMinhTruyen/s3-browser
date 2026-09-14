package bucket

import (
	profileModel "S3Browser/models/profile"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// Emitted after a new connection profile is saved; payload is the created profile
	EventConnectSaveProfile = "bucket:connect-save-profile"
)

// RegisterEvent must be called directly from init so the binding generator can
// emit the TypeScript payload type for Events.On / Events.Emit on the frontend.
func init() {
	application.RegisterEvent[profileModel.ConnectionProfileOutput](EventConnectSaveProfile)
}
