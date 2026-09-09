package master

import (
	"S3Browser/internal/modules/master/sqlc"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models/common"
	"S3Browser/models/master"
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
	q      *sqlc.Queries
}

func NewModule(app *application.App, logger *slog.Logger, db *sql.DB) *Module {
	return &Module{
		logger: logger.With("component", "master_module"),
		app:    app,
		q:      sqlc.New(db),
	}
}

func (m *Module) GetMasterData(codes []string) common.Output[master.GetMasterDataOutput] {
	output := common.Output[master.GetMasterDataOutput]{}
	output.New()
	output.Body.MasterData = make(map[string][]master.MasterOutput, len(codes))

	for _, code := range codes {
		if code == "" {
			continue
		}

		rows, err := m.q.SelectMasterByCode(m.app.Context(), code)
		if err != nil {
			m.logger.Error("get master data failed", "code", code, "error", err)
			output.AddMessage(common.ErrorMessage(cnst.Master, MTE001))
			continue
		}

		items := make([]master.MasterOutput, 0, len(rows))
		for _, row := range rows {
			items = append(items, master.MasterOutput{
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

func (m *Module) GetRegion() common.Output[master.RegionOutput] {
	output := common.Output[master.RegionOutput]{}
	output.New()

	rows, err := m.q.SelectAllRegion(m.app.Context())

	if err != nil {
		m.logger.Error("get region data failed", "error", err)
		output.AddMessage(common.ErrorMessage(cnst.Master, MTE001))
		return output
	}

	output.Body.RegionData = make(map[string][]master.MasterOutput)
	for _, row := range rows {
		output.Body.RegionData[row.Value2.String] = append(
			output.Body.RegionData[row.Value2.String],
			master.MasterOutput{
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
