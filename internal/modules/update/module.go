// Package update checks GitHub Releases for a newer version of the app, downloads the NSIS installer with a
// SHA-256 check and runs it. Module is the public API called by the handlers; the work is done by the
// submodule_*.go files.
package update

import (
	"S3Browser/internal/modules/setting"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"errors"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Message codes returned to the frontend by the update module.
// Naming convention: UPS = success, UPE = error.
var (
	// You are using the latest version {version}.
	UPS001 = "UPS001"

	// Cannot check for updates.
	UPE001 = "UPE001"

	// GitHub is limiting requests, try again later.
	UPE002 = "UPE002"

	// Cannot download the update.
	UPE003 = "UPE003"

	// The update has no checksum or the checksum does not match, the file was deleted.
	UPE004 = "UPE004"

	// Cannot run the installer (or administrator permission was denied).
	UPE005 = "UPE005"

	// Version {version} has no installer for this machine.
	UPE006 = "UPE006"
)

// Module is the self-update of the app.
type Module struct {
	app *application.App
	mng *submoduleUpdateMng
}

// NewModule creates the update module. version comes from build/config.yml; the feature is off for portable
// and non-NSIS builds, and always on in dev mode for testing. The periodic check starts when autoUpdate is on
// in the saved settings.
func NewModule(app *application.App, logger *slog.Logger, setting *setting.Module, version string, devMode bool,
) *Module {
	m := &Module{app: app, mng: newSubmoduleUpdateMng(app, logger, version, devMode)}
	saved := setting.GetSettings().Body.Settings
	m.mng.setBeta(saved.BetaUpdate)
	m.mng.setAutoUpdate(saved.AutoUpdate)
	return m
}

// GetState returns the current update state.
func (m *Module) GetState() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	output.Body = m.mng.snapshot()
	return output
}

// Check looks for a newer release when the user asks. The result is in the returned state, so a check that
// is skipped because another one, a download or a ready installer is in the way returns the state unchanged.
// With auto update on, a new release starts downloading right away.
func (m *Module) Check(ctx context.Context) models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer context.AfterFunc(m.app.Context(), cancel)()

	err := m.mng.check(ctx)
	output.Body = m.mng.snapshot()
	switch {
	case errors.Is(err, errBusy):
	case errors.Is(ctx.Err(), context.Canceled):
		output.Result = false
	case err != nil:
		return output.ThrowError(errorMessage(err))
	case output.Body.State == stateUpToDate:
		output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Update, UPS001, "",
			map[string]any{"version": output.Body.CurrentVersion}))
	}
	return output
}

// Download starts downloading the release found by the last check and returns at once; progress comes with
// the update:state-changed event.
func (m *Module) Download() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	err := m.mng.startDownload()
	output.Body = m.mng.snapshot()
	if err != nil {
		return output.ThrowError(errorMessage(err))
	}
	return output
}

// Install runs the downloaded installer silently (Windows asks for administrator permission) and quits the
// app; the installer starts the new version when it is done. If the installer cannot run, the app keeps running.
func (m *Module) Install() models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	err := m.mng.install()
	output.Body = m.mng.snapshot()
	if err != nil {
		return output.ThrowError(errorMessage(err))
	}
	m.app.Quit()
	return output
}

// SetAutoUpdate starts or stops the periodic check. A download that is already running keeps going.
func (m *Module) SetAutoUpdate(enabled bool) {
	m.mng.setAutoUpdate(enabled)
}

// SetBeta makes the next checks follow pre-releases too (true) or stable releases only (false).
func (m *Module) SetBeta(enabled bool) {
	m.mng.setBeta(enabled)
}

// SetOptions applies both update switches at once, without saving them, and returns the resulting state.
func (m *Module) SetOptions(beta, autoUpdate bool) models.Output[models.UpdateStateOutput] {
	output := models.NewOutput[models.UpdateStateOutput]()
	m.mng.setBeta(beta)
	m.mng.setAutoUpdate(autoUpdate)
	output.Body = m.mng.snapshot()
	return output
}

// Close stops the periodic check and any download.
func (m *Module) Close() {
	m.mng.close()
}

// errorMessage turns a failure of the submodule into its message; anything else is UPE001.
func errorMessage(err error) models.Message {
	var updErr *updateError
	if !errors.As(err, &updErr) {
		updErr = &updateError{code: UPE001, err: err}
	}
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Update, updErr.code, updErr.err.Error(),
		map[string]any{"version": updErr.version})
}
