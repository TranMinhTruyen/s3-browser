// Package profile manages saved connection profiles and encrypts their secrets.
package profile

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"database/sql"
	"errors"
	"log/slog"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// PFE001 - Error while saving profile
	PFE001 = "PFE001"

	// PFE002 - Encrypted SecretKey failed
	PFE002 = "PFE002"

	// PFE003 - Error while getting connection profiles
	PFE003 = "PFE003"

	// PFE005 - Update profile [{name}] error
	PFE005 = "PFE005"

	// PFE006 - Delete profile [{name}] error
	PFE006 = "PFE006"

	// PFE007 - Profile [{name}] has uploads or downloads in progress, cannot delete
	PFE007 = "PFE007"

	// PFE008 - Authentication method {authType} is not valid for provider {provider}.
	PFE008 = "PFE008"

	// PFE009 - Authentication settings are invalid.
	PFE009 = "PFE009"

	// PFE010 - Cannot export profile [{name}].
	PFE010 = "PFE010"

	// PFE011 - Cannot read the profile file (it may be larger than 1 MB).
	PFE011 = "PFE011"

	// PFE012 - The file is not a valid S3Browser profile file.
	PFE012 = "PFE012"

	// PFE013 - Profile file version {version} is not supported.
	PFE013 = "PFE013"

	// PFE014 - Wrong password, or the file is damaged.
	PFE014 = "PFE014"

	// PFE015 - Enter a password of at least 8 characters.
	PFE015 = "PFE015"

	// PFS001 - Add new profile [{name}] success
	PFS001 = "PFS001"

	// PFS002 - Update profile [{name}] success
	PFS002 = "PFS002"

	// PFS003 - Delete profile [{name}] success
	PFS003 = "PFS003"

	// PFS004 - Export profile [{name}] success
	PFS004 = "PFS004"

	// PFW001 - Profile [{name}] imported. These file paths do not exist on this computer and were cleared: {fields}.
	PFW001 = "PFW001"
)

// Module stores connection profiles in the database.
type Module struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	q      *sqlc.Queries

	submoduleAuthMng *submoduleAuthMng
	submoduleFileMng *submoduleFileMng
}

// NewModule creates the profile module.
func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	km *utils.KeyManager,
) *Module {
	q := sqlc.New(db)
	auth := newSubmoduleAuthMng(km)

	return &Module{
		logger: logger.With("component", "profiles_module"),
		app:    app,
		global: global,
		q:      q,

		submoduleAuthMng: auth,
		submoduleFileMng: newSubmoduleFileMng(app, logger, q, auth),
	}
}

// toProfileOutput maps a stored profile for the frontend. It never exposes a secret, only their names.
// On error (secret or auth_config unreadable) it still returns the readable part of the profile.
func (m *Module) toProfileOutput(p sqlc.ConnectionProfile) (models.ConnectionProfileOutput, error) {
	secrets, secretErr := m.submoduleAuthMng.open(p)
	authConfig, configErr := parseAuthConfig(p)

	return models.ConnectionProfileOutput{
		ID:           p.ID,
		Name:         p.Name.String,
		Color:        p.Color.String,
		Provider:     p.Provider,
		Endpoint:     p.Endpoint,
		Region:       p.Region,
		AccessKey:    p.AccessKey.String,
		PathStyle:    p.PathStyle.Bool,
		AutoConnect:  p.AutoConnect.Bool,
		CreatedAt:    p.CreatedAt.Time,
		UpdatedAt:    p.UpdatedAt.Time,
		Version:      p.Version,
		IsConnected:  m.global.HasConn(p.ID),
		AuthType:     p.AuthType,
		AuthConfig:   authConfig,
		SavedSecrets: secrets.names(),
	}, errors.Join(secretErr, configErr)
}

// outputErrorMessage maps an error of toProfileOutput to its message: PFE009 for a bad auth_config, else PFE002.
func outputErrorMessage(err error) models.Message {
	code := PFE002
	if errors.Is(err, errInvalidAuthConfig) {
		code = PFE009
	}
	return models.NewMessage(cnst.MessageTypeError, cnst.Profile, code, err.Error())
}

// warnMessage is outputErrorMessage as a warning, for a profile that was saved but can't be read back fully.
func warnMessage(err error) models.Message {
	msg := outputErrorMessage(err)
	msg.MessageType = cnst.MessageTypeWarn
	return msg
}

// CreateProfile saves a new profile. Secrets are stored encrypted, and only if SavePassword is set.
// An authType the provider doesn't support is rejected with PFE008 and nothing is written.
func (m *Module) CreateProfile(
	input models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return m.createProfile(input, false)
}

// createProfile is CreateProfile; allowMissingCertKey is only set by the import (see prepare).
func (m *Module) createProfile(
	input models.ConnectionProfileInput,
	allowMissingCertKey bool,
) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	auth, failure := m.submoduleAuthMng.prepare(input, nil, allowMissingCertKey)
	if failure != nil {
		return output.ThrowError(*failure)
	}

	params := sqlc.CreateProfileParams{
		ID:          utils.GenerateUUID(),
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   auth.accessKey,
		SecretKey:   auth.secretKey,
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: auth.autoConnect, Valid: true},
		AuthType:    auth.authType,
		AuthConfig:  auth.config,
		AuthSecret:  auth.secret,
	}

	result, err := m.q.CreateProfile(m.app.Context(), params)
	if err != nil {
		m.logger.Error("save connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE001, err.Error()))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("read saved profile failed", "connectionId", result.ID, "error", err)
		// The profile is saved: report a warning, not a failure.
		output.AddMessage(warnMessage(err))
	}
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS001, result.Name.String, ""))

	return output
}

// UpdateProfileById updates a profile; input.Version is the optimistic-lock value the caller last read.
// An empty secret keeps the stored one; SavePassword=false deletes every stored secret.
func (m *Module) UpdateProfileById(input models.ConnectionProfileInput) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	// The stored row is only needed to keep secrets the caller left empty.
	var stored *sqlc.ConnectionProfile
	if input.SavePassword {
		row, err := m.q.SelectConnectionProfileById(m.app.Context(), input.Id)
		if err != nil {
			m.logger.Error("get stored profile failed", "connectionId", input.Id, "error", err)
			return output.ThrowError(updateError(input.Name, err))
		}
		stored = &row
	}

	auth, failure := m.submoduleAuthMng.prepare(input, stored, false)
	if failure != nil {
		return output.ThrowError(*failure)
	}

	params := sqlc.UpdateConnectionProfileByIdParams{
		ID:          input.Id,
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   auth.accessKey,
		SecretKey:   auth.secretKey,
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: auth.autoConnect, Valid: true},
		AuthType:    auth.authType,
		AuthConfig:  auth.config,
		AuthSecret:  auth.secret,
		Version:     input.Version,
	}

	result, err := m.q.UpdateConnectionProfileById(m.app.Context(), params)
	if err != nil {
		m.logger.Error("update connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(updateError(input.Name, err))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("read saved profile failed", "connectionId", result.ID, "error", err)
		output.AddMessage(warnMessage(err))
	}
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS002, result.Name.String, ""))

	return output
}

// nameMessage is a profile message whose text takes the profile name as {name}.
func nameMessage(msgType, code, name, errorDetail string) models.Message {
	return models.NewParamsMessage(msgType, cnst.Profile, code, errorDetail, map[string]any{"name": name})
}

// updateError is the PFE005 message of a failed update of profile name.
func updateError(name string, err error) models.Message {
	return nameMessage(cnst.MessageTypeError, PFE005, name, err.Error())
}

// DeleteProfileById closes the profile's active connection (if any), then deletes the profile.
// Result is false if the profile couldn't be deleted, or a transfer still runs on its connection.
func (m *Module) DeleteProfileById(input models.ConnectionProfileInput) models.Output[bool] {
	output := models.NewOutput[bool]()

	conn, removed, busy := m.global.RemoveConnIfIdle(input.Id)
	if busy {
		m.logger.Warn("delete profile refused, transfers in progress", "connectionId", input.Id)
		return output.ThrowError(
			nameMessage(cnst.MessageTypeError, PFE007, input.Name, ""),
		)
	}
	if removed {
		// Closed here, after the container's lock is released: closing does network I/O.
		conn.Close()
	}

	if err := m.q.DeleteConnectionProfileById(m.app.Context(), input.Id); err != nil {
		m.logger.Error("delete connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(
			nameMessage(cnst.MessageTypeError, PFE006, input.Name, err.Error()),
		)
	}

	output.Body = true
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS003, input.Name, ""))

	return output
}

// ExportProfile writes a profile to a JSON file chosen in a native save dialog and returns the written path.
// With IncludeSecret the saved secrets are sealed with Password (at least 8 characters, else PFE015); without it
// the file holds no secret. The body is empty, with no message, when the user cancels the dialog.
func (m *Module) ExportProfile(input models.ExportProfileInput) models.Output[string] {
	return m.submoduleFileMng.exportAction(input)
}

// ChooseImportFile opens a native dialog to pick a profile file and checks it (size, format, version).
// The body tells whether the file holds secrets (so a password is needed); its path is empty when cancelled.
func (m *Module) ChooseImportFile() models.Output[models.ImportFileOutput] {
	return m.submoduleFileMng.chooseImportAction()
}

// ImportProfile saves the profile of a profile file as a new profile with a new id and its secrets encrypted
// again. A taken name gets " (2)", " (3)"... and a file path that does not exist here is cleared (PFW001).
// The file is checked again, and nothing is written when it is invalid or the password is wrong.
// It never connects, even with AutoConnect.
func (m *Module) ImportProfile(input models.ImportProfileInput) models.Output[models.ConnectionProfileOutput] {
	imported, failure := m.submoduleFileMng.importAction(input)
	if failure != nil {
		output := models.NewOutput[models.ConnectionProfileOutput]()
		return output.ThrowError(*failure)
	}

	output := m.createProfile(imported.input, imported.allowMissingCertKey)
	if output.Result && len(imported.clearedFields) > 0 {
		output.AddMessage(models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Profile, PFW001, "", map[string]any{
			"name":   output.Body.Name,
			"fields": strings.Join(imported.clearedFields, ", "),
		}))
	}
	return output
}

// GetConnectionProfileById returns a profile; its secrets are not included, only the names in SavedSecrets.
func (m *Module) GetConnectionProfileById(connectionID string) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	result, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)
	if err != nil {
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("error while read profile", "connectionId", connectionID, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}

	return output
}

// GetConnectInput returns a saved profile as a connect input with its secrets decrypted. It is for the
// backend only (no handler exposes it): the frontend never receives the secrets.
func (m *Module) GetConnectInput(connectionID string) models.Output[models.ConnectionProfileInput] {
	output := models.NewOutput[models.ConnectionProfileInput]()

	row, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)
	if err != nil {
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	secrets, secretErr := m.submoduleAuthMng.open(row)
	authConfig, configErr := parseAuthConfig(row)
	if err := errors.Join(secretErr, configErr); err != nil {
		m.logger.Error("error while read profile", "connectionId", connectionID, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}

	output.Body = models.ConnectionProfileInput{
		Id:          row.ID,
		Name:        row.Name.String,
		Color:       row.Color.String,
		Provider:    row.Provider,
		Endpoint:    row.Endpoint,
		Region:      row.Region,
		AccessKey:   row.AccessKey.String,
		SecretKey:   secrets.secretKey,
		PathStyle:   row.PathStyle.Bool,
		AutoConnect: row.AutoConnect.Bool,
		Version:     row.Version,
		AuthType:    row.AuthType,
		AuthConfig:  authConfig,
		AuthSecret:  secrets.AuthSecret,
	}

	return output
}

// GetAllConnectionProfile returns every profile keyed by id, with IsConnected set from the live
// connections. A profile whose secret or auth_config is unreadable is reported with PFE002/PFE009
// but still returned.
func (m *Module) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	output := models.NewOutput[models.GetAllConnectionProfileOutput]()

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())
	if err != nil {
		m.logger.Error("error get all profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	profiles := make(map[string]models.ConnectionProfileOutput, len(result))
	for _, item := range result {
		profile, err := m.toProfileOutput(item)
		if err != nil {
			m.logger.Error("error while read profile", "connectionId", item.ID, "error", err)
			output.AddMessage(outputErrorMessage(err))
		}
		profiles[item.ID] = profile
	}

	output.Body = models.GetAllConnectionProfileOutput{ConnectionProfiles: profiles}

	return output
}
