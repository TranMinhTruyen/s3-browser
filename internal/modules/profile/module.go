package profile

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"S3Browser/models/profile"
	"database/sql"
	"errors"
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

	// Save profile success
	PFS001 = "PFS001"
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
	connectionId string,
	profileInput bucket.ConnectionInput,
) error {
	encryptedSecret := ""

	if profileInput.SavePassword {
		encrypted, err := m.km.Encrypt(profileInput.SecretKey)

		if err != nil {
			return errors.New(PFE002)
		}

		encryptedSecret = encrypted
	}

	params := sqlc.CreateProfileParams{
		ID:           connectionId,
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

	if _, err := m.q.CreateProfile(m.app.Context(), params); err != nil {
		m.logger.Error("save connection profile failed", "connectionId", connectionId, "error", err)
		return errors.New(PFE001)
	}

	m.app.Event.Emit("profile:reload-connection-profiles")

	return nil
}

func (m *Module) GetConnectionProfileById(connectionID string) common.Output[profile.ConnectionProfileOutput] {
	output := common.Output[profile.ConnectionProfileOutput]{}
	output.New()

	result, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)

	if err != nil {
		output.Body = nil
		output.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE003))
		m.logger.Error("error white get profile", slog.Any("error", err))
		return output
	}

	decrypted, err := m.km.Decrypt(result.SecretKey)

	if err != nil {
		output.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE002))
		return output
	}

	output.Body = &profile.ConnectionProfileOutput{
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

func (m *Module) GetAllConnectionProfile() common.Output[profile.GetAllConnectionProfileOutput] {
	output := common.Output[profile.GetAllConnectionProfileOutput]{}
	output.New()

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())

	if err != nil {
		output.Body = nil
		output.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Profile, PFE003))
		m.logger.Error("error get all profile", slog.Any("error", err))
		return output
	}

	profiles := make(map[string]profile.ConnectionProfileOutput, len(result))
	for _, item := range result {
		isConnected := m.global.HasConn(item.ConnectionID)

		profiles[item.ConnectionID] = profile.ConnectionProfileOutput{
			ID:          item.ConnectionID,
			Name:        item.ConnectionName.String,
			Color:       item.Color.String,
			AutoConnect: item.AutoConnect.Bool,
			IsConnected: isConnected,
			CreatedAt:   item.CreatedAt.Time,
			UpdatedAt:   item.UpdatedAt.Time,
			Version:     item.Version,
		}
	}

	output.Body = &profile.GetAllConnectionProfileOutput{ConnectionProfiles: profiles}

	return output
}
