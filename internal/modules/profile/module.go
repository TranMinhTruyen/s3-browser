package profile

import (
	"S3Browser/internal/modules/profile/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
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
	q      *sqlc.Queries
	km     *utils.KeyManager
}

func NewModule(app *application.App, logger *slog.Logger, db *sql.DB, km *utils.KeyManager) *Module {
	return &Module{
		logger: logger.With("component", "profiles_module"),
		app:    app,
		q:      sqlc.New(db),
		km:     km,
	}
}

func (m *Module) CreateProfile(
	connectionId string,
	profileInput bucket.ConnectionInput,
) error {
	encryptedSecret, err := m.km.Encrypt(profileInput.SecretKey)

	if err != nil {
		return errors.New(PFE002)
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
	}

	if _, err = m.q.CreateProfile(m.app.Context(), params); err != nil {
		m.logger.Error("save connection profile failed", "connectionId", connectionId, "error", err)
		return errors.New(PFE001)
	}

	return nil
}

func (m *Module) GetAllConnectionProfile() profile.GetAllConnectionProfileOutput {
	output := profile.GetAllConnectionProfileOutput{
		ConnectionProfiles: []profile.ConnectionProfileOutput{},
	}

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())

	if err != nil {
		output.Message = PFE003
		m.logger.Error("error get all profile", slog.Any("detail", err))
		return output
	}

	outputList := make([]profile.ConnectionProfileOutput, len(result))
	for i, item := range result {
		outputList[i] = profile.ConnectionProfileOutput{
			ID:        item.ConnectionID,
			Name:      item.ConnectionName.String,
			Color:     item.Color.String,
			CreatedAt: item.CreatedAt.Time,
			UpdatedAt: item.UpdatedAt.Time,
			Version:   item.Version,
		}
	}

	output.ConnectionProfiles = outputList
	return output
}
