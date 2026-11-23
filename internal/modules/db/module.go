// Package db runs the SQL mode: saved database profiles, connections to the native database engine
// (s3b_db.dll, loaded without cgo) and the queries the frontend sends through them.
package db

import (
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// DBE001 - Invalid request to the database engine.
	DBE001 = "DBE001"

	// DBE002 - Cannot open database file {path}.
	DBE002 = "DBE002"

	// DBE003 - The file is not a SQLite database.
	DBE003 = "DBE003"

	// DBE004 - The connection was closed. Connect again.
	DBE004 = "DBE004"

	// DBE005 - The result is no longer available. Run the query again.
	DBE005 = "DBE005"

	// DBE006 - SQL error (the detail is the engine error; shown with the result, not as a toast).
	DBE006 = "DBE006"

	// DBE007 - Table [{name}] does not exist.
	DBE007 = "DBE007"

	// DBE008 - Database engine error.
	DBE008 = "DBE008"

	// DBE009 - The database engine (s3b_db.dll) could not be loaded.
	DBE009 = "DBE009"

	// DBE010 - Cannot save database profile [{name}].
	DBE010 = "DBE010"

	// DBE011 - Cannot delete database profile [{name}].
	DBE011 = "DBE011"

	// DBE012 - Cannot load database profiles.
	DBE012 = "DBE012"

	// DBE013 - Cannot open the file dialog.
	DBE013 = "DBE013"

	// DBE014 - Profile [{name}] is not connected.
	DBE014 = "DBE014"

	// DBE015 - The operation timed out after {timeout}.
	DBE015 = "DBE015"
)

const (
	// queryTimeout limits one ExecuteSql, OpenTableRows or FetchRows call; an idle open cursor is not timed.
	queryTimeout = 5 * time.Minute
	// metaTimeout limits opening a connection and reading the schema.
	metaTimeout = 30 * time.Second

	// pageSize is the rows of the first page and of each FetchRows page.
	pageSize = 10000
	// maxPageBytes caps the text of one page (always at least one row), so a page of big values stays small.
	maxPageBytes = 16 << 20
	// unlimited is the page limit of FetchRows with All; far above any real table, and still fits Rust usize.
	unlimited = 1 << 62
)

// Module owns the database profiles and the connections of the SQL mode.
type Module struct {
	logger *slog.Logger
	app    *application.App

	profileMng *submoduleProfileMng
	connMng    *submoduleConnMng
	queryMng   *submoduleQueryMng
	nativeMng  *submoduleNativeMng
}

// NewModule creates the database module. The native library is only loaded by the first connection.
func NewModule(app *application.App, logger *slog.Logger, db *sql.DB, km *utils.KeyManager) *Module {
	log := logger.With("component", "db_module")
	native := newSubmoduleNativeMng(logger, loadNative)
	q := sqlc.New(db)
	conns := newSubmoduleConnMng(app, logger, native, q)

	return &Module{
		logger:     log,
		app:        app,
		profileMng: newSubmoduleProfileMng(app, logger, q, conns, km),
		connMng:    conns,
		queryMng:   newSubmoduleQueryMng(app, logger, native, conns),
		nativeMng:  native,
	}
}

// Loaded reports whether the native library is loaded. It never loads it.
func (m *Module) Loaded() bool {
	return m.nativeMng.loaded()
}

// GetAllDbProfile lists the saved database profiles.
func (m *Module) GetAllDbProfile() models.Output[models.GetAllDbProfileOutput] {
	return m.profileMng.getAll()
}

// CreateDbProfile saves a new profile. The provider is sqlite or postgres; the password is stored sealed.
func (m *Module) CreateDbProfile(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return m.profileMng.create(input)
}

// UpdateDbProfileById updates a profile.
func (m *Module) UpdateDbProfileById(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return m.profileMng.update(input)
}

// DeleteDbProfileById deletes the profile, then closes its connections; a failed delete keeps them open.
func (m *Module) DeleteDbProfileById(input models.DbProfileInput) models.Output[bool] {
	return m.profileMng.delete(input)
}

// ChooseDbFile opens the native dialog to pick a SQLite file and returns its path; the body is empty when
// the user cancels.
func (m *Module) ChooseDbFile() models.Output[string] {
	return m.profileMng.chooseFile()
}

// ConnectDb opens the main connection of a saved profile (used for the object tree and table info).
// Connecting an already connected profile does nothing.
func (m *Module) ConnectDb(ctx context.Context, input models.DbProfileRefInput) models.Output[bool] {
	return m.connMng.connect(ctx, input.ProfileId)
}

// DisconnectDb closes the main connection and every tab connection of the profile.
func (m *Module) DisconnectDb(input models.DbProfileRefInput) models.Output[bool] {
	return m.connMng.disconnect(input.ProfileId)
}

// GetSchemaTree reads the object tree of a connected profile.
func (m *Module) GetSchemaTree(
	ctx context.Context,
	input models.DbProfileRefInput,
) models.Output[models.SchemaTreeOutput] {
	return m.connMng.schemaTree(ctx, input.ProfileId)
}

// GetTableInfo reads the columns, indexes, constraints, foreign keys and source of a table.
func (m *Module) GetTableInfo(
	ctx context.Context,
	input models.TableInfoInput,
) models.Output[models.TableInfoOutput] {
	return m.connMng.tableInfo(ctx, input)
}

// ExecuteSql runs the statements of input.Sql in order on the connection of the tab, stopping at the first
// failed one. A SQL error is reported in the statement, not as a message.
func (m *Module) ExecuteSql(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	return m.queryMng.execute(ctx, input)
}

// OpenTableRows reads the first page of the rows of a table on the connection of the tab.
func (m *Module) OpenTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	return m.queryMng.openTableRows(ctx, input)
}

// FetchRows loads the next page of the cursor of the tab, or all remaining rows (no page limit, no timeout;
// the frontend stops it by canceling the call) when input.All is set.
func (m *Module) FetchRows(ctx context.Context, input models.FetchRowsInput) models.Output[models.FetchRowsOutput] {
	return m.queryMng.fetchRows(ctx, input)
}

// CloseDbTab closes the connection of the tab; a tab without one is fine.
func (m *Module) CloseDbTab(input models.CloseDbTabInput) models.Output[bool] {
	return m.connMng.closeTab(input.TabId)
}

// Close closes every connection (app shutdown). It does nothing if the native library was never loaded.
func (m *Module) Close() {
	m.connMng.closeAll()
}
