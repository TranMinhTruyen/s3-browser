package handlers

import (
	"S3Browser/internal/modules/db"
	"S3Browser/models"
	"context"
)

// DbHandler is the Wails service for the SQL mode: database profiles, connections and queries.
type DbHandler struct {
	db *db.Module
}

// NewDbHandler creates the database handler.
func NewDbHandler(db *db.Module) *DbHandler {
	return &DbHandler{
		db: db,
	}
}

// GetAllDbProfile lists the saved database profiles.
func (h *DbHandler) GetAllDbProfile() models.Output[models.GetAllDbProfileOutput] {
	return h.db.GetAllDbProfile()
}

// CreateDbProfile saves a new database profile.
func (h *DbHandler) CreateDbProfile(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return h.db.CreateDbProfile(input)
}

// UpdateDbProfileById updates a database profile.
func (h *DbHandler) UpdateDbProfileById(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return h.db.UpdateDbProfileById(input)
}

// DeleteDbProfileById deletes a database profile and closes its connections.
func (h *DbHandler) DeleteDbProfileById(input models.DbProfileInput) models.Output[bool] {
	return h.db.DeleteDbProfileById(input)
}

// ChooseDbFile opens the native dialog to pick a SQLite file.
func (h *DbHandler) ChooseDbFile() models.Output[string] {
	return h.db.ChooseDbFile()
}

// ConnectDb opens the main connection of a saved profile.
func (h *DbHandler) ConnectDb(ctx context.Context, input models.DbProfileRefInput) models.Output[bool] {
	return h.db.ConnectDb(ctx, input)
}

// DisconnectDb closes every connection of a profile.
func (h *DbHandler) DisconnectDb(input models.DbProfileRefInput) models.Output[bool] {
	return h.db.DisconnectDb(input)
}

// GetSchemaTree reads the object tree of a connected profile.
func (h *DbHandler) GetSchemaTree(
	ctx context.Context,
	input models.DbProfileRefInput,
) models.Output[models.SchemaTreeOutput] {
	return h.db.GetSchemaTree(ctx, input)
}

// GetTableInfo reads the structure of a table.
func (h *DbHandler) GetTableInfo(
	ctx context.Context,
	input models.TableInfoInput,
) models.Output[models.TableInfoOutput] {
	return h.db.GetTableInfo(ctx, input)
}

// ExecuteSql runs SQL statements on the connection of a tab.
func (h *DbHandler) ExecuteSql(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	return h.db.ExecuteSql(ctx, input)
}

// OpenTableRows reads the first page of the rows of a table.
func (h *DbHandler) OpenTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	return h.db.OpenTableRows(ctx, input)
}

// FetchRows loads the next page of the cursor of a tab.
func (h *DbHandler) FetchRows(ctx context.Context, input models.FetchRowsInput) models.Output[models.FetchRowsOutput] {
	return h.db.FetchRows(ctx, input)
}

// CloseDbTab closes the connection of a tab.
func (h *DbHandler) CloseDbTab(input models.CloseDbTabInput) models.Output[bool] {
	return h.db.CloseDbTab(input)
}
