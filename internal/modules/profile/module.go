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

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// PFE001 - Error while save profile
	PFE001 = "PFE001"

	// PFE002 - Encrypted SecretKey failed
	PFE002 = "PFE002"

	// PFE003 - Error get all connnection profile
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

	// PFS001 - Add new profile [{name}] success
	PFS001 = "PFS001"

	// PFS002 - Update profile [{name}] success
	PFS002 = "PFS002"

	// PFS003 - Delete profile [{name}] success
	PFS003 = "PFS003"
)

// Module stores connection profiles in the database.
type Module struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	q      *sqlc.Queries

	submoduleAuthMng *submoduleAuthMng
}

// NewModule creates the profile module.
func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	km *utils.KeyManager,
) *Module {
	return &Module{
		logger: logger.With("component", "profiles_module"),
		app:    app,
		global: global,
		q:      sqlc.New(db),

		submoduleAuthMng: newSubmoduleAuthMng(km),
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
	output := models.NewOutput[models.ConnectionProfileOutput]()

	auth, failure := m.submoduleAuthMng.prepare(input, nil)
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
	output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Profile, PFS001, "", map[string]any{
		"name": result.Name.String,
	}))

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

	auth, failure := m.submoduleAuthMng.prepare(input, stored)
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
	output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Profile, PFS002, "", map[string]any{
		"name": result.Name.String,
	}))

	return output
}

// updateError is the PFE005 message of a failed update of profile name.
func updateError(name string, err error) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE005, err.Error(), map[string]any{
		"name": name,
	})
}

// DeleteProfileById closes the profile's active connection (if any), then deletes the profile.
// Result is false if the profile couldn't be deleted, or a transfer still runs on its connection.
func (m *Module) DeleteProfileById(input models.ConnectionProfileInput) models.Output[bool] {
	output := models.NewOutput[bool]()

	conn, removed, busy := m.global.RemoveConnIfIdle(input.Id)
	if busy {
		m.logger.Warn("delete profile refused, transfers in progress", "connectionId", input.Id)
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE007, "", map[string]any{
				"name": input.Name,
			}),
		)
	}
	if removed {
		// Closed here, after the container's lock is released: closing does network I/O.
		conn.Transport.CloseIdleConnections()
	}

	if err := m.q.DeleteConnectionProfileById(m.app.Context(), input.Id); err != nil {
		m.logger.Error("delete connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE006, err.Error(), map[string]any{
				"name": input.Name,
			}),
		)
	}

	output.Body = true
	output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Profile, PFS003, "", map[string]any{
		"name": input.Name,
	}))

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
