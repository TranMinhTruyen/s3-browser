package master

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/models"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// Error get master data
	MTE001 = "MTE001"
)

type Module struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	q      *sqlc.Queries
}

func NewModule(app *application.App, logger *slog.Logger, global *global.Module, db *sql.DB) *Module {
	return &Module{
		logger: logger.With("component", "master_module"),
		app:    app,
		global: global,
		q:      sqlc.New(db),
	}
}

func (m *Module) GetMasterData(codes []string) models.Output[models.GetMasterDataOutput] {
	output := models.Output[models.GetMasterDataOutput]{}
	output.New()
	output.Body.MasterData = make(map[string][]models.MasterOutput, len(codes))

	for _, code := range codes {
		if code == "" {
			continue
		}

		rows, err := m.q.SelectMasterByCode(m.app.Context(), code)
		if err != nil {
			m.logger.Error("get master data failed", "code", code, "error", err)
			output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Master, MTE001, err.Error()))
			continue
		}

		items := make([]models.MasterOutput, 0, len(rows))
		for _, row := range rows {
			items = append(items, models.MasterOutput{
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
			})
		}

		output.Body.MasterData[code] = items
	}

	return output
}

func (m *Module) GetRegion() models.Output[models.RegionOutput] {
	output := models.Output[models.RegionOutput]{}
	output.New()

	rows, err := m.q.SelectAllRegion(m.app.Context())

	if err != nil {
		output.Body = nil
		m.logger.Error("get region data failed", "error", err)
		output.AddMessage(models.CreateMessage(cnst.MessageTypeError, cnst.Master, MTE001, err.Error()))
		return output
	}

	output.Body.RegionData = make(map[string][]models.MasterOutput)
	for _, row := range rows {
		output.Body.RegionData[row.Value2.String] = append(
			output.Body.RegionData[row.Value2.String],
			models.MasterOutput{
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
			},
		)
	}

	return output
}
