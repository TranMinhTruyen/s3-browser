package profile

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// minExportPasswordLen is the shortest password accepted to protect the secrets of an export (in characters).
	minExportPasswordLen = 8
	// maxImportFileSize is the largest profile file read on import, in bytes.
	maxImportFileSize = 1 << 20
	// maxProfileNameLen is the longest profile name, in characters.
	maxProfileNameLen = 100
)

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

// importedProfile is a profile file ready to be created as a new profile.
type importedProfile struct {
	input models.ConnectionProfileInput
	// clearedFields names the file paths that do not exist here and were emptied.
	clearedFields []string
	// allowMissingCertKey is set when the certificate or key file of a minioCert profile was just cleared.
	allowMissingCertKey bool
}

// chooseImportAction asks for a profile file in a native open dialog and checks it. Cancelling gives an empty body.
func (m *submoduleFileMng) chooseImportAction() models.Output[models.ImportFileOutput] {
	output := models.NewOutput[models.ImportFileOutput]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	dialog.AddFilter("JSON files", "*.json")
	// The app has one window; attach to it so the dialog is modal (Current may be nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if utils.IsDialogCancelled(err) || (err == nil && path == "") {
		m.logger.Debug("import profile dialog cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("import: choose file failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE011, err.Error()))
	}

	file, failure := m.readFile(path)
	if failure != nil {
		return output.ThrowError(*failure)
	}
	output.Body = models.ImportFileOutput{Path: path, Name: filepath.Base(path), Encrypted: file.Secret != nil}
	return output
}

// importAction reads and checks the profile file again, opens its secrets with the password and builds the
// input to create. Secrets and the password are never logged or put in a message.
func (m *submoduleFileMng) importAction(input models.ImportProfileInput) (importedProfile, *models.Message) {
	file, failure := m.readFile(input.Path)
	if failure != nil {
		return importedProfile{}, failure
	}

	var secret fileSecret
	if file.Secret != nil {
		if len([]rune(input.Password)) < minExportPasswordLen {
			return importedProfile{}, errMessage(PFE015, errors.New("password needed"))
		}
		plain, err := utils.OpenWithPassword(*file.Secret, input.Password)
		if err == nil {
			err = json.Unmarshal(plain, &secret)
		}
		if err != nil {
			code := PFE014
			if errors.Is(err, utils.ErrInvalidSealed) {
				code = PFE012
			}
			m.logger.Warn("import: open secrets failed", "code", code)
			return importedProfile{}, errMessage(code, err)
		}
	}

	rows, err := m.q.SelectAllConnectionProfile(m.app.Context())
	if err != nil {
		m.logger.Error("import: get profiles failed", "error", err)
		return importedProfile{}, errMessage(PFE003, err)
	}
	taken := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		taken[row.Name.String] = struct{}{}
	}

	p := file.Profile
	cleared := clearMissingPaths(&p.AuthConfig)
	certCleared, keyCleared := slices.Contains(cleared, "certFile"), slices.Contains(cleared, "keyFile")
	return importedProfile{
		input: models.ConnectionProfileInput{
			Name:         uniqueName(p.Name, taken),
			Color:        p.Color,
			Provider:     p.Provider,
			Endpoint:     p.Endpoint,
			Region:       p.Region,
			AccessKey:    p.AccessKey,
			SecretKey:    secret.SecretKey,
			PathStyle:    p.PathStyle,
			SavePassword: file.Secret != nil,
			AutoConnect:  p.AutoConnect,
			AuthType:     p.AuthType,
			AuthConfig:   p.AuthConfig,
			AuthSecret:   secret.AuthSecret,
		},
		clearedFields: cleared,
		allowMissingCertKey: (certCleared || keyCleared) &&
			(p.AuthConfig.CertFile != "" || certCleared) && (p.AuthConfig.KeyFile != "" || keyCleared),
	}, nil
}

// readFile reads a profile file of at most maxImportFileSize bytes and checks its format and version.
func (m *submoduleFileMng) readFile(path string) (profileFile, *models.Message) {
	f, err := os.Open(path)
	if err != nil {
		m.logger.Error("import: open file failed", "error", err)
		return profileFile{}, errMessage(PFE011, err)
	}
	defer func() { _ = f.Close() }()

	data, err := io.ReadAll(io.LimitReader(f, maxImportFileSize+1))
	if err != nil || len(data) > maxImportFileSize {
		if err == nil {
			err = errors.New("file is larger than 1 MB")
		}
		m.logger.Error("import: read file failed", "error", err)
		return profileFile{}, errMessage(PFE011, err)
	}

	file, err := parseProfileFile(data)
	var unsupported unsupportedVersionError
	switch {
	case errors.As(err, &unsupported):
		msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE013, "", map[string]any{
			"version": unsupported.version,
		})
		return profileFile{}, &msg
	case err != nil:
		return profileFile{}, errMessage(PFE012, err)
	}
	return file, nil
}

// uniqueName returns name, or name + " (n)" with the smallest n >= 2 that is not in taken. The name is cut by
// characters so the result is at most maxProfileNameLen long.
func uniqueName(name string, taken map[string]struct{}) string {
	if _, ok := taken[name]; !ok {
		return name
	}
	runes := []rune(name)
	for n := 2; ; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		base := runes[:min(len(runes), maxProfileNameLen-len(suffix))]
		if candidate := string(base) + suffix; !isTaken(taken, candidate) {
			return candidate
		}
	}
}

// isTaken reports whether name is in taken.
func isTaken(taken map[string]struct{}, name string) bool {
	_, ok := taken[name]
	return ok
}

// clearMissingPaths empties the file paths of cfg that do not exist on this computer and returns their names.
func clearMissingPaths(cfg *models.AuthConfig) []string {
	var cleared []string
	for _, f := range []struct {
		name string
		path *string
	}{
		{"certFile", &cfg.CertFile},
		{"keyFile", &cfg.KeyFile},
		{"caFile", &cfg.CaFile},
		{"configFile", &cfg.ConfigFile},
		{"credentialsFile", &cfg.CredentialsFile},
	} {
		if *f.path == "" {
			continue
		}
		path := expandHome(*f.path)
		if isUnsafePath(path) {
			*f.path = ""
			cleared = append(cleared, f.name)
			continue
		}
		if _, err := os.Stat(path); err != nil {
			*f.path = ""
			cleared = append(cleared, f.name)
		}
	}
	return cleared
}

// isUnsafePath reports whether path may reach another host or a device. Only relative paths and plain drive
// paths (X:\...) are safe: UNC (\\host\share, //host/share), \\?\, \\.\ and NT \??\ forms are never stat-ed.
func isUnsafePath(path string) bool {
	isSep := func(c byte) bool { return c == '\\' || c == '/' }
	if len(path) >= 2 && isSep(path[0]) && isSep(path[1]) ||
		strings.HasPrefix(path, `\??\`) || strings.HasPrefix(path, `/??/`) {
		return true
	}
	vol := filepath.VolumeName(path)
	return vol != "" && (len(vol) != 2 || vol[1] != ':')
}

// expandHome replaces a leading "~" with the user's home directory, as the AWS credential loader does.
func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}
