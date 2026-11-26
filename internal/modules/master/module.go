// Package master cung cấp dữ liệu danh mục chỉ đọc (danh sách tra cứu, region) từ cơ sở dữ liệu.
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
	// MTE001 - Lỗi khi tải dữ liệu danh mục
	MTE001 = "MTE001"
)

// Module đọc dữ liệu danh mục từ cơ sở dữ liệu.
type Module struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
}

// NewModule tạo module master.
func NewModule(app *application.App, logger *slog.Logger, db *sql.DB) *Module {
	return &Module{
		logger: logger.With("component", "master_module"),
		app:    app,
		q:      sqlc.New(db),
	}
}

// toMasterOutput ánh xạ một hàng danh mục (cột nullable được chuyển thành chuỗi rỗng).
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

// GetMasterData trả các mục danh mục theo từng code được yêu cầu, dùng code làm khóa. Code nào tải thất bại sẽ được
// báo bằng MTE001 và bỏ qua để vẫn trả về dữ liệu của các code khác.
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

// GetRegion trả tất cả region, được nhóm theo provider (cột value2).
func (m *Module) GetRegion() models.Output[models.RegionOutput] {
	output := models.NewOutput[models.RegionOutput]()

	rows, err := m.q.SelectAllRegion(m.app.Context())
	if err != nil {
		m.logger.Error("get region data failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Master, MTE001, err.Error()))
	}

	output.Body.RegionData = make(map[string][]models.MasterOutput)
	for _, row := range rows {
		// Các hàng region có đúng các cột như hàng danh mục.
		provider := row.Value2.String
		output.Body.RegionData[provider] = append(
			output.Body.RegionData[provider],
			toMasterOutput(sqlc.SelectMasterByCodeRow(row)),
		)
	}

	return output
}
