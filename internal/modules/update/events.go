package update

import (
	"S3Browser/models"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Event names emitted to the frontend, in the form domain:kebab-name.
const (
	// Emitted when the update state changes, and every 200 ms while the installer downloads; payload is
	// UpdateStateOutput
	EventStateChanged = "update:state-changed"
)

// RegisterEvent must be called directly from init so the binding generator can
// emit the TypeScript payload type for Events.On / Events.Emit on the frontend.
func init() {
	application.RegisterEvent[models.UpdateStateOutput](EventStateChanged)
}
