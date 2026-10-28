// Package master serves read-only master data (lookup lists, regions) from the database.
package master

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/models"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// MTE001 - Error while loading master data
	MTE001 = "MTE001"
)

// Module reads master data from the database.
type Module struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
}

// NewModule creates the master module.
func NewModule(app *application.App, logger *slog.Logger, db *sql.DB) *Module {
	return &Module{
		logger: logger.With("component", "master_module"),
		app:    app,
		q:      sqlc.New(db),
	}
}

// toMasterOutput maps a master row (nullable columns become empty strings).
func toMasterOutput(row sqlc.SelectMasterByCodeRow) models.MasterOutput {
	return models.MasterOutput{
		Code:      row.Code,
		Name:      row.Name,
		SortOrder: row.SortOrder,
		Value1:    row.Value1,
		Value2:    row.Value2.String,
		Value3:    row.Value3.String,
		Value4:    row.Value4.String,
		Value5:    row.Value5.String,
		Value6:    row.Value6.String,
		Value7:    row.Value7.String,
		Value8:    row.Value8.String,
		Value9:    row.Value9.String,
		Value10:   row.Value10.String,
	}
}

// GetMasterData returns the master items of each requested code, keyed by code. A code that
// fails to load is reported with MTE001 and skipped, so the other codes are still returned.
func (m *Module) GetMasterData(codes []string) models.Output[models.GetMasterDataOutput] {
	output := models.NewOutput[models.GetMasterDataOutput]()
	output.Body.MasterData = make(map[string][]models.MasterOutput, len(codes))

	for _, code := range codes {
		if code == "" {
			continue
		}

		rows, err := m.q.SelectMasterByCode(m.app.Context(), code)
		if err != nil {
			m.logger.Error("get master data failed", "code", code, "error", err)
			output.AddMessage(models.NewMessage(cnst.MessageTypeError, cnst.Master, MTE001, err.Error()))
			continue
		}

		items := make([]models.MasterOutput, 0, len(rows))
		for _, row := range rows {
			items = append(items, toMasterOutput(row))
		}

		output.Body.MasterData[code] = items
	}

	return output
}

// GetRegion returns all regions grouped by provider (the value2 column).
func (m *Module) GetRegion() models.Output[models.RegionOutput] {
	output := models.NewOutput[models.RegionOutput]()

	rows, err := m.q.SelectAllRegion(m.app.Context())
	if err != nil {
		m.logger.Error("get region data failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Master, MTE001, err.Error()))
	}

	output.Body.RegionData = make(map[string][]models.MasterOutput)
	for _, row := range rows {
		// Region rows have exactly the same columns as master rows.
		provider := row.Value2.String
		output.Body.RegionData[provider] = append(
			output.Body.RegionData[provider],
			toMasterOutput(sqlc.SelectMasterByCodeRow(row)),
		)
	}

	return output
}
