package profile

import (
	"S3Browser/internal/modules/profile/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
	"S3Browser/models/profile"
	"context"
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
	q      *sqlc.Queries
	ctx    context.Context
	logger *slog.Logger
	app    *application.App
	km     *utils.KeyManager
}

func NewModule(app *application.App, logger *slog.Logger) *Module {
	return &Module{
		logger: logger.With("component", "profiles_module"),
		app:    app,
	}
}

func (m *Module) Startup(ctx context.Context, db *sql.DB, km *utils.KeyManager) {
	m.ctx = ctx
	m.q = sqlc.New(db)
	m.km = km
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

	_, err = m.q.CreateProfile(m.ctx, params)

	return err
}

func (m *Module) GetAllConnectionProfile() profile.GetAllConnectionProfileOutput {
	output := profile.GetAllConnectionProfileOutput{
		ConnectionProfiles: []profile.ConnectionProfileOutput{},
	}

	result, err := m.q.SelectAllConnectionProfile(m.ctx)

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
