package db

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Supported providers.
const (
	providerSqlite   = "sqlite"
	providerPostgres = "postgres"
)

const maxPort = 65535

// errInvalidConfig is the detail of DBE010 for a missing or invalid config field.
var errInvalidConfig = errors.New("invalid profile config")

// submoduleProfileMng saves the database profiles of the SQL mode; the password is sealed with the key manager.
type submoduleProfileMng struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
	conns  *submoduleConnMng
	km     *utils.KeyManager
}

// newSubmoduleProfileMng creates the profile store; conns is asked to close a profile's connections on delete.
func newSubmoduleProfileMng(
	app *application.App,
	logger *slog.Logger,
	q *sqlc.Queries,
	conns *submoduleConnMng,
	km *utils.KeyManager,
) *submoduleProfileMng {
	return &submoduleProfileMng{logger: logger.With("submodules", "profile"), app: app, q: q, conns: conns, km: km}
}

// parseConfig reads the config JSON of a stored profile.
func parseConfig(p sqlc.DbProfile) (models.DbProfileConfig, error) {
	var cfg models.DbProfileConfig
	if err := json.Unmarshal([]byte(p.Config), &cfg); err != nil {
		return models.DbProfileConfig{}, err
	}
	return cfg, nil
}

// toOutput maps a stored profile; the secret is only reported as present.
func toOutput(p sqlc.DbProfile) (models.DbProfileOutput, error) {
	cfg, err := parseConfig(p)
	if err != nil {
		return models.DbProfileOutput{}, err
	}
	return models.DbProfileOutput{
		Id:        p.ID,
		Name:      p.Name,
		Color:     p.Color,
		Provider:  p.Provider,
		Config:    cfg,
		HasSecret: p.Secret.String != "",
	}, nil
}

// validateConfig checks the required fields of the provider and returns the config reduced to the fields
// that provider uses.
func validateConfig(provider string, cfg models.DbProfileConfig) (models.DbProfileConfig, error) {
	switch provider {
	case providerSqlite:
		if cfg.FilePath == "" {
			return cfg, fmt.Errorf("%w: file path is required", errInvalidConfig)
		}
		return models.DbProfileConfig{FilePath: cfg.FilePath, ReadOnly: cfg.ReadOnly}, nil
	case providerPostgres:
		if cfg.Host == "" || cfg.Database == "" || cfg.Username == "" {
			return cfg, fmt.Errorf("%w: host, database and username are required", errInvalidConfig)
		}
		if cfg.Port < 1 || cfg.Port > maxPort {
			return cfg, fmt.Errorf("%w: port must be between 1 and %d", errInvalidConfig, maxPort)
		}
		return models.DbProfileConfig{
			Host: cfg.Host, Port: cfg.Port, Database: cfg.Database, Username: cfg.Username, SslMode: cfg.SslMode,
		}, nil
	}
	return cfg, fmt.Errorf("%w: unsupported provider %q", errInvalidConfig, provider)
}

// nameMessage is a profile message whose text takes the profile name as {name}.
func nameMessage(code, name, errorDetail string) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Db, code, errorDetail, map[string]any{"name": name})
}

// seal encrypts the password; an empty one is stored as NULL.
func (m *submoduleProfileMng) seal(v string) (sql.NullString, error) {
	if v == "" {
		return sql.NullString{}, nil
	}
	cipher, err := m.km.Encrypt(v)
	return sql.NullString{String: cipher, Valid: err == nil}, err
}

// prepare validates input and returns the config JSON and sealed secret to store. stored is the current row on
// update (nil on create): an empty secret keeps the stored one when the provider is unchanged, otherwise the old
// secret is dropped.
func (m *submoduleProfileMng) prepare(
	input models.DbProfileInput,
	stored *sqlc.DbProfile,
) (string, sql.NullString, error) {
	cfg, err := validateConfig(input.Provider, input.Config)
	if err != nil {
		return "", sql.NullString{}, err
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return "", sql.NullString{}, err
	}

	if input.Secret == "" && stored != nil && stored.Provider == input.Provider {
		return string(raw), stored.Secret, nil
	}
	secret, err := m.seal(input.Secret)
	return string(raw), secret, err
}

// getAll lists the profiles, oldest first.
func (m *submoduleProfileMng) getAll() models.Output[models.GetAllDbProfileOutput] {
	output := models.NewOutput[models.GetAllDbProfileOutput]()

	rows, err := m.q.SelectAllDbProfile(m.app.Context())
	if err != nil {
		m.logger.Error("get all db profile failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE012, err.Error()))
	}

	output.Body.DbProfiles = make([]models.DbProfileOutput, 0, len(rows))
	for _, row := range rows {
		profile, err := toOutput(row)
		if err != nil {
			m.logger.Error("read db profile failed", "profileId", row.ID, "error", err)
			return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE012, err.Error()))
		}
		output.Body.DbProfiles = append(output.Body.DbProfiles, profile)
	}
	return output
}

// create saves a new profile.
func (m *submoduleProfileMng) create(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	output := models.NewOutput[models.DbProfileOutput]()

	config, secret, err := m.prepare(input, nil)
	if err != nil {
		m.logger.Error("validate db profile failed", "error", err)
		return output.ThrowError(nameMessage(DBE010, input.Name, err.Error()))
	}

	row, err := m.q.InsertDbProfile(m.app.Context(), sqlc.InsertDbProfileParams{
		ID:       utils.GenerateUUID(),
		Name:     input.Name,
		Color:    input.Color,
		Provider: input.Provider,
		Config:   config,
		Secret:   secret,
	})
	if err != nil {
		m.logger.Error("save db profile failed", "error", err)
		return output.ThrowError(nameMessage(DBE010, input.Name, err.Error()))
	}

	return m.saved(output, row, input.Name)
}

// saved maps the stored row into the output body.
func (m *submoduleProfileMng) saved(
	output models.Output[models.DbProfileOutput],
	row sqlc.DbProfile,
	name string,
) models.Output[models.DbProfileOutput] {
	body, err := toOutput(row)
	if err != nil {
		m.logger.Error("read db profile failed", "profileId", row.ID, "error", err)
		return output.ThrowError(nameMessage(DBE010, name, err.Error()))
	}
	output.Body = body
	return output
}

// update saves the changes of the profile input.Id, keeping the id; an unknown id is DBE010.
func (m *submoduleProfileMng) update(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	output := models.NewOutput[models.DbProfileOutput]()

	stored, err := m.q.SelectDbProfileById(m.app.Context(), input.Id)
	if err != nil {
		m.logger.Error("load db profile failed", "profileId", input.Id, "error", err)
		return output.ThrowError(nameMessage(DBE010, input.Name, err.Error()))
	}
	config, secret, err := m.prepare(input, &stored)
	if err != nil {
		m.logger.Error("validate db profile failed", "profileId", input.Id, "error", err)
		return output.ThrowError(nameMessage(DBE010, input.Name, err.Error()))
	}

	row, err := m.q.UpdateDbProfileById(m.app.Context(), sqlc.UpdateDbProfileByIdParams{
		ID:       input.Id,
		Name:     input.Name,
		Color:    input.Color,
		Provider: input.Provider,
		Config:   config,
		Secret:   secret,
	})
	if err != nil {
		m.logger.Error("update db profile failed", "profileId", input.Id, "error", err)
		return output.ThrowError(nameMessage(DBE010, input.Name, err.Error()))
	}

	return m.saved(output, row, input.Name)
}

// delete removes the profile, then closes its connections; if the delete fails the connections stay open.
func (m *submoduleProfileMng) delete(input models.DbProfileInput) models.Output[bool] {
	output := models.NewOutput[bool]()

	if _, err := m.q.DeleteDbProfileById(m.app.Context(), input.Id); err != nil {
		m.logger.Error("delete db profile failed", "profileId", input.Id, "error", err)
		return output.ThrowError(nameMessage(DBE011, input.Name, err.Error()))
	}
	m.conns.closeConns(m.conns.removeProfile(input.Id)...)

	output.Body = true
	return output
}

// chooseFile opens the native dialog for a SQLite file and returns its path. The dialog blocks until closed,
// so it has no timeout.
func (m *submoduleProfileMng) chooseFile() models.Output[string] {
	output := models.NewOutput[string]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	dialog.AddFilter("SQLite database", "*.db;*.sqlite;*.sqlite3;*.db3")
	dialog.AddFilter("All files", "*.*")
	// The app has one window; attach to it so the dialog is modal (Current may be nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if utils.IsDialogCancelled(err) {
		return output
	}
	if err != nil {
		m.logger.Error("choose db file error", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE013, err.Error()))
	}

	output.Body = path
	return output
}
