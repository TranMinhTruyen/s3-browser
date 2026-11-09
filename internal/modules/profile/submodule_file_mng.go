package profile

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// minExportPasswordLen is the shortest password accepted to protect the secrets of an export (in characters).
const minExportPasswordLen = 8

// submoduleFileMng exports profiles to, and imports them from, JSON files.
type submoduleFileMng struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
	auth   *submoduleAuthMng
}

// newSubmoduleFileMng creates the profile file submodule.
func newSubmoduleFileMng(
	app *application.App,
	logger *slog.Logger,
	q *sqlc.Queries,
	auth *submoduleAuthMng,
) *submoduleFileMng {
	return &submoduleFileMng{logger: logger.With("submodules", "profile_file"), app: app, q: q, auth: auth}
}

// exportAction asks for the file in a native save dialog, then writes the profile there.
func (m *submoduleFileMng) exportAction(input models.ExportProfileInput) models.Output[string] {
	return m.exportTo(input, m.chooseSavePath)
}

// exportTo exports the profile to the path returned by choosePath(suggested file name). An empty path or a
// cancelled dialog ends silently with an empty body. Password and secrets are never logged or put in a message.
func (m *submoduleFileMng) exportTo(
	input models.ExportProfileInput,
	choosePath func(filename string) (string, error),
) models.Output[string] {
	output := models.NewOutput[string]()

	if input.IncludeSecret && len([]rune(input.Password)) < minExportPasswordLen {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE015, ""))
	}

	row, err := m.q.SelectConnectionProfileById(m.app.Context(), input.Id)
	if err != nil {
		m.logger.Error("export: get profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}
	config, err := parseAuthConfig(row)
	if err != nil {
		m.logger.Error("export: read auth config failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}
	var secrets plainSecrets
	if input.IncludeSecret {
		if secrets, err = m.auth.open(row); err != nil {
			m.logger.Error("export: read secrets failed", "connectionId", input.Id, "error", err)
			return output.ThrowError(outputErrorMessage(err))
		}
	}

	path, err := choosePath(safeFileName(row.Name.String) + ".json")
	if utils.IsDialogCancelled(err) || (err == nil && path == "") {
		m.logger.Debug("export profile dialog cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("export: choose path failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(nameMessage(cnst.MessageTypeError, PFE010, row.Name.String, err.Error()))
	}
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		path += ".json"
	}

	data, err := buildProfileFile(row, config, secrets, input.Password)
	if err == nil {
		err = os.WriteFile(path, data, 0o600)
	}
	if err != nil {
		m.logger.Error("export: write file failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(nameMessage(cnst.MessageTypeError, PFE010, row.Name.String, err.Error()))
	}

	output.Body = path
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS004, row.Name.String, ""))
	return output
}

// chooseSavePath opens the native save dialog; the path is empty when the user cancels.
func (m *submoduleFileMng) chooseSavePath(filename string) (string, error) {
	dialog := m.app.Dialog.SaveFile().SetFilename(filename)
	dialog.AddFilter("JSON files", "*.json")
	// The app has one window; attach to it so the dialog is modal (Current may be nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}
	return dialog.PromptForSingleSelection()
}

// buildProfileFile builds the JSON of a profile file. The secrets go in only when there are any, sealed with
// password; the file never holds a secret in plaintext.
func buildProfileFile(
	row sqlc.ConnectionProfile,
	config models.AuthConfig,
	secrets plainSecrets,
	password string,
) ([]byte, error) {
	file := profileFile{
		Format:  profileFileFormat,
		Version: profileFileVersion,
		Profile: &fileProfile{
			Name:        row.Name.String,
			Color:       row.Color.String,
			Provider:    row.Provider,
			Endpoint:    row.Endpoint,
			Region:      row.Region,
			AccessKey:   row.AccessKey.String,
			PathStyle:   row.PathStyle.Bool,
			AutoConnect: row.AutoConnect.Bool,
			AuthType:    row.AuthType,
			AuthConfig:  config,
		},
	}

	if len(secrets.names()) > 0 {
		plain, err := json.Marshal(fileSecret{SecretKey: secrets.secretKey, AuthSecret: secrets.AuthSecret})
		if err != nil {
			return nil, err
		}
		sealed, err := utils.SealWithPassword(plain, password)
		if err != nil {
			return nil, err
		}
		file.Secret = &sealed
	}

	return json.MarshalIndent(file, "", "  ")
}

// safeFileName replaces the characters Windows forbids in a file name; it never returns an empty name.
func safeFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, name)
	if name = strings.TrimRight(strings.TrimSpace(name), "."); name == "" {
		return "profile"
	}
	return name
}
