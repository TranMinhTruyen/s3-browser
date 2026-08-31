package profile

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"minio-browser/internal/modules/profile/sqlc"
	"minio-browser/internal/pkg/utils"
	"minio-browser/models"
)

var (
	// Error while save profile
	PFE001 = "PFE001"
	// Encrypted SecretKey failed
	PFE002 = "PFE002"

	// Save profile success
	PFS001 = "PFS001"
)

type Module struct {
	q      *sqlc.Queries
	ctx    context.Context
	logger *slog.Logger
	km     *utils.KeyManager
}

func NewModule(db *sql.DB, logger *slog.Logger, km *utils.KeyManager) *Module {
	log := logger.With("component", "profiles_module")

	return &Module{
		q:      sqlc.New(db),
		logger: log,
		km:     km,
	}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

func (m *Module) CreateProfile(
	connectionId string,
	profileInput models.ConnectionInput,
) (sqlc.ConnectionProfile, error) {
	encryptedSecret, err := m.km.Encrypt(profileInput.SecretKey)

	if err != nil {
		return sqlc.ConnectionProfile{}, errors.New(PFE002)
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

	return m.q.CreateProfile(m.ctx, params)
}
