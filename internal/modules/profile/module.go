// Package profile manages saved connection profiles and encrypts their secret keys.
package profile

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"database/sql"
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
	km     *utils.KeyManager
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
		km:     km,
	}
}

// toProfileOutput maps a stored profile; secretKey is the plain text one, never the stored cipher.
func toProfileOutput(p sqlc.ConnectionProfile, secretKey string) models.ConnectionProfileOutput {
	return models.ConnectionProfileOutput{
		ID:          p.ID,
		Name:        p.Name.String,
		Color:       p.Color.String,
		Provider:    p.Provider,
		Endpoint:    p.Endpoint,
		Region:      p.Region,
		AccessKey:   p.AccessKey,
		SecretKey:   secretKey,
		PathStyle:   p.PathStyle.Bool,
		AutoConnect: p.AutoConnect.Bool,
		CreatedAt:   p.CreatedAt.Time,
		UpdatedAt:   p.UpdatedAt.Time,
		Version:     p.Version,
	}
}

// encryptSecret returns the cipher of the secret key to store, or "" when the user doesn't want
// it saved. Intentional: on update, "" overwrites any secret stored before.
func (m *Module) encryptSecret(input models.ConnectionProfileInput) (string, error) {
	if !input.SavePassword {
		return "", nil
	}
	return m.km.Encrypt(input.SecretKey)
}

// CreateProfile saves a new profile. The secret key is stored encrypted, and only if SavePassword is set.
func (m *Module) CreateProfile(
	input models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	encryptedSecret, err := m.encryptSecret(input)
	if err != nil {
		m.logger.Error("encrypted SecretKey failed", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
	}

	params := sqlc.CreateProfileParams{
		ID:          utils.GenerateUUID(),
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   input.AccessKey,
		SecretKey:   sql.NullString{String: encryptedSecret, Valid: true},
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: input.AutoConnect, Valid: true},
	}

	result, err := m.q.CreateProfile(m.app.Context(), params)
	if err != nil {
		m.logger.Error("save connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE001, err.Error()))
	}

	output.Body = toProfileOutput(result, input.SecretKey)
	output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Profile, PFS001, "", map[string]any{
		"name": result.Name.String,
	}))

	return output
}

// UpdateProfileById updates a profile; input.Version is the optimistic-lock value the caller last read.
func (m *Module) UpdateProfileById(input models.ConnectionProfileInput) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	encryptedSecret, err := m.encryptSecret(input)
	if err != nil {
		m.logger.Error("encrypted SecretKey failed", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
	}

	params := sqlc.UpdateConnectionProfileByIdParams{
		ID:          input.Id,
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   input.AccessKey,
		SecretKey:   sql.NullString{String: encryptedSecret, Valid: true},
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: input.AutoConnect, Valid: true},
		Version:     input.Version,
	}

	result, err := m.q.UpdateConnectionProfileById(m.app.Context(), params)
	if err != nil {
		m.logger.Error("update connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE005, err.Error(), map[string]any{
				"name": input.Name,
			}),
		)
	}

	output.Body = toProfileOutput(result, input.SecretKey)
	output.AddMessage(models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Profile, PFS002, "", map[string]any{
		"name": result.Name.String,
	}))

	return output
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

// GetConnectionProfileById returns a profile with its secret key decrypted.
func (m *Module) GetConnectionProfileById(connectionID string) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	result, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)
	if err != nil {
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	decrypted := ""
	if result.SecretKey.String != "" {
		if decrypted, err = m.km.Decrypt(result.SecretKey.String); err != nil {
			return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
		}
	}

	output.Body = toProfileOutput(result, decrypted)

	return output
}

// GetAllConnectionProfile returns every profile keyed by id, with IsConnected set from the live
// connections. A secret that fails to decrypt is reported with PFE002 but its profile is still returned.
func (m *Module) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	output := models.NewOutput[models.GetAllConnectionProfileOutput]()

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())
	if err != nil {
		m.logger.Error("error get all profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	profiles := make(map[string]models.ConnectionProfileOutput, len(result))
	for _, item := range result {
		decrypted := ""
		if item.SecretKey.String != "" {
			if decrypted, err = m.km.Decrypt(item.SecretKey.String); err != nil {
				output.AddMessage(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
			}
		}

		// The list query returns different column names, so it can't share toProfileOutput directly.
		profiles[item.ConnectionID] = models.ConnectionProfileOutput{
			ID:          item.ConnectionID,
			Name:        item.ConnectionName.String,
			Color:       item.Color.String,
			Provider:    item.Provider,
			Endpoint:    item.Endpoint,
			Region:      item.Region,
			AccessKey:   item.AccessKey,
			SecretKey:   decrypted,
			PathStyle:   item.PathStyle.Bool,
			AutoConnect: item.AutoConnect.Bool,
			IsConnected: m.global.HasConn(item.ConnectionID),
			CreatedAt:   item.CreatedAt.Time,
			UpdatedAt:   item.UpdatedAt.Time,
			Version:     item.Version,
		}
	}

	output.Body = models.GetAllConnectionProfileOutput{ConnectionProfiles: profiles}

	return output
}
