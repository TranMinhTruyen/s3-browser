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
	// Error while save profile
	PFE001 = "PFE001"

	// Encrypted SecretKey failed
	PFE002 = "PFE002"

	// Error get all connnection profile
	PFE003 = "PFE003"

	// Error while update profile
	PFE004 = "PFE004"

	// Update profile [{name}] error
	PFE005 = "PFE005"

	// Delete profile [{name}] error
	PFE006 = "PFE006"

	// Save profile [{name}] success
	PFS001 = "PFS001"

	// Update profile [{name}] success
	PFS002 = "PFS002"

	// Delete profile [{name}] success
	PFS003 = "PFS003"
)

type Module struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	q      *sqlc.Queries
	km     *utils.KeyManager
}

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

func (m *Module) CreateProfile(
	profileInput models.ConnectionInput,
) models.Output[models.ConnectionProfileOutput] {
	output := models.Output[models.ConnectionProfileOutput]{}
	output.New()
	output.Body = nil
	encryptedSecret := ""

	if profileInput.SavePassword {
		encrypted, err := m.km.Encrypt(profileInput.SecretKey)

		if err != nil {
			output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
			m.logger.Error("encrypted SecretKey failed", slog.Any("error", err))
			return output
		}

		encryptedSecret = encrypted
	}

	params := sqlc.CreateProfileParams{
		ID:           utils.GenerateUUID(),
		Name:         sql.NullString{String: profileInput.Name, Valid: profileInput.Name != ""},
		Color:        sql.NullString{String: profileInput.Color, Valid: profileInput.Color != ""},
		Endpoint:     profileInput.Endpoint,
		Region:       profileInput.Region,
		AccessKey:    profileInput.AccessKey,
		SecretKey:    encryptedSecret,
		PathStyle:    sql.NullBool{Bool: profileInput.PathStyle, Valid: true},
		SavePassword: sql.NullBool{Bool: profileInput.SavePassword, Valid: true},
		AutoConnect:  sql.NullBool{Bool: profileInput.AutoConnect, Valid: true},
	}

	result, err := m.q.CreateProfile(m.app.Context(), params)

	if err != nil {
		m.logger.Error("save connection profile failed", "connectionId", profileInput.Id, "error", err)
		output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE001, err.Error()))
		return output
	}

	output.Body = &models.ConnectionProfileOutput{
		ID:           result.ID,
		Name:         result.Name.String,
		Color:        result.Color.String,
		Endpoint:     result.Endpoint,
		Region:       result.Region,
		AccessKey:    result.AccessKey,
		SecretKey:    result.SecretKey,
		PathStyle:    result.PathStyle.Bool,
		SavePassword: result.SavePassword.Bool,
		AutoConnect:  result.AutoConnect.Bool,
		CreatedAt:    result.CreatedAt.Time,
		UpdatedAt:    result.UpdatedAt.Time,
		Version:      result.Version,
	}

	output.AddMessage(models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Profile, PFE001, "", map[string]any{
		"name": result.Name.String,
	}))

	return output
}

func (m *Module) UpdateProfileById(input models.ConnectionInput) models.Output[models.ConnectionProfileOutput] {
	output := models.Output[models.ConnectionProfileOutput]{}
	output.New()
	encryptedSecret := ""

	if input.SavePassword {
		encrypted, err := m.km.Encrypt(input.SecretKey)

		if err != nil {
			output.Body = nil
			output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
			m.logger.Error("encrypted SecretKey failed", slog.Any("error", err))
			return output
		}

		encryptedSecret = encrypted
	}

	params := sqlc.UpdateConnectionProfileByIdParams{
		ID:           input.Id,
		Name:         sql.NullString{String: input.Name, Valid: input.Name != ""},
		Color:        sql.NullString{String: input.Color, Valid: input.Color != ""},
		Endpoint:     input.Endpoint,
		Region:       input.Region,
		AccessKey:    input.AccessKey,
		SecretKey:    encryptedSecret,
		PathStyle:    sql.NullBool{Bool: input.PathStyle, Valid: true},
		SavePassword: sql.NullBool{Bool: input.SavePassword, Valid: true},
		AutoConnect:  sql.NullBool{Bool: input.AutoConnect, Valid: true},
		Version:      input.Version,
	}

	result, err := m.q.UpdateConnectionProfileById(m.app.Context(), params)

	if err != nil {
		m.logger.Error("update connection profile failed", "connectionId", input.Id, "error", err)
		output.Body = nil
		output.AddMessage(
			models.CreateMessageWithParams(cnst.MessageTypeError, cnst.Profile, PFE005, err.Error(), map[string]any{
				"name": result.Name.String,
			}),
		)
		return output
	}

	output.Body = &models.ConnectionProfileOutput{
		ID:           result.ID,
		Name:         result.Name.String,
		Color:        result.Color.String,
		Endpoint:     result.Endpoint,
		Region:       result.Region,
		AccessKey:    result.AccessKey,
		SecretKey:    result.SecretKey,
		PathStyle:    result.PathStyle.Bool,
		SavePassword: result.SavePassword.Bool,
		AutoConnect:  result.AutoConnect.Bool,
		CreatedAt:    result.CreatedAt.Time,
		UpdatedAt:    result.UpdatedAt.Time,
		Version:      result.Version,
	}

	output.AddMessage(models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, PFS002, "", map[string]any{
		"name": result.Name.String,
	}))

	return output
}

func (m *Module) DeleteProfileById(input models.ConnectionInput) models.Output[bool] {
	output := models.Output[bool]{}
	output.New()
	output.Body = utils.ToPtr(true)

	err := m.q.DeleteConnectionProfileById(m.app.Context(), input.Id)

	if err != nil {
		m.logger.Error("delete connection profile failed", "connectionId", input.Id, "error", err)
		output.Body = utils.ToPtr(false)
		output.AddMessage(
			models.CreateMessageWithParams(cnst.MessageTypeError, cnst.Profile, PFE006, err.Error(), map[string]any{
				"name": input.Name,
			}),
		)
		return output
	}

	output.AddMessage(models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Profile, PFS003, "", map[string]any{
		"name": input.Name,
	}))

	return output
}

func (m *Module) GetConnectionProfileById(connectionID string) models.Output[models.ConnectionProfileOutput] {
	output := models.Output[models.ConnectionProfileOutput]{}
	output.New()

	result, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)

	if err != nil {
		output.Body = nil
		output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output
	}

	decrypted := ""
	if result.SecretKey != "" {
		if decrypted, err = m.km.Decrypt(result.SecretKey); err != nil {
			output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
			return output
		}
	}

	output.Body = &models.ConnectionProfileOutput{
		ID:        result.ID,
		Name:      result.Name.String,
		Color:     result.Color.String,
		Endpoint:  result.Endpoint,
		Region:    result.Region,
		AccessKey: result.AccessKey,
		SecretKey: decrypted,
		PathStyle: result.PathStyle.Bool,
		CreatedAt: result.CreatedAt.Time,
		UpdatedAt: result.UpdatedAt.Time,
		Version:   result.Version,
	}

	return output
}

func (m *Module) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	output := models.Output[models.GetAllConnectionProfileOutput]{}
	output.New()

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())

	if err != nil {
		output.Body = nil
		output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
		m.logger.Error("error get all profile", slog.Any("error", err))
		return output
	}

	profiles := make(map[string]models.ConnectionProfileOutput, len(result))
	for _, item := range result {
		isConnected := m.global.HasConn(item.ConnectionID)

		decrypted := ""
		if item.SecretKey != "" {
			if decrypted, err = m.km.Decrypt(item.SecretKey); err != nil {
				output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE002, err.Error()))
			}
		}

		profiles[item.ConnectionID] = models.ConnectionProfileOutput{
			ID:           item.ConnectionID,
			Name:         item.ConnectionName.String,
			Color:        item.Color.String,
			Endpoint:     item.Endpoint,
			Region:       item.Region,
			AccessKey:    item.AccessKey,
			SecretKey:    decrypted,
			PathStyle:    item.PathStyle.Bool,
			SavePassword: item.SavePassword.Bool,
			AutoConnect:  item.AutoConnect.Bool,
			IsConnected:  isConnected,
			CreatedAt:    item.CreatedAt.Time,
			UpdatedAt:    item.UpdatedAt.Time,
			Version:      item.Version,
		}
	}

	output.Body = &models.GetAllConnectionProfileOutput{ConnectionProfiles: profiles}

	return output
}
