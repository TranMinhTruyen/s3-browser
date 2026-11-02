package bucket

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Kinds of file ChooseAuthFile can ask for.
const (
	authFileCert = "cert"
	authFileKey  = "key"
	authFileCa   = "ca"
)

// submoduleAuthFilesMng lets the user pick the certificate, key and CA files of a profile.
type submoduleAuthFilesMng struct {
	logger *slog.Logger
	app    *application.App
}

// newSubmoduleAuthFilesMng creates the file chooser.
func newSubmoduleAuthFilesMng(app *application.App, logger *slog.Logger) *submoduleAuthFilesMng {
	return &submoduleAuthFilesMng{logger: logger.With("submodules", "auth_files"), app: app}
}

// chooseAuthFile opens the native dialog for a file of the given kind (cert, key or ca) and returns its path.
// The body is empty when the user cancels. The dialog blocks until closed, so it has no timeout.
func (m *submoduleAuthFilesMng) chooseAuthFile(kind string) models.Output[string] {
	output := models.NewOutput[string]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	switch kind {
	case authFileCert, authFileCa:
		dialog.AddFilter("Certificate files", "*.pem;*.crt;*.cer")
	case authFileKey:
		dialog.AddFilter("Key files", "*.pem;*.key")
	default:
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, "unknown file kind"))
	}
	dialog.AddFilter("All files", "*.*")
	// The app has one window; attach to it so the dialog is modal (Current may be nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if utils.IsDialogCancelled(err) {
		m.logger.Debug("choose auth file cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("choose auth file error", slog.Any("detail", err.Error()))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E029, err.Error()))
	}
	output.Body = path
	return output
}
