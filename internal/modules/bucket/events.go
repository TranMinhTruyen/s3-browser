package bucket

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// Emitted after a new connection profile is saved; payload is the created profile
	EventConnectSaveProfile     = "bucket:connect-save-profile"
	EventDownloadObjectProgress = "bucket:download-progress"
)

// RegisterEvent must be called directly from init so the binding generator can
// emit the TypeScript payload type for Events.On / Events.Emit on the frontend.
func init() {
	application.RegisterEvent[models.ConnectionProfileOutput](EventConnectSaveProfile)
	application.RegisterEvent[models.DownloadProgressOutput](EventDownloadObjectProgress)
}
