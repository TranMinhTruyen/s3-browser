package handlers

import (
	"S3Browser/internal/modules/db"
	"S3Browser/models"
	"context"
)

// DbHandler là service Wails cho chế độ SQL: hồ sơ cơ sở dữ liệu, kết nối và truy vấn.
type DbHandler struct {
	db *db.Module
}

// NewDbHandler tạo handler cơ sở dữ liệu.
func NewDbHandler(db *db.Module) *DbHandler {
	return &DbHandler{
		db: db,
	}
}

// GetAllDbProfile liệt kê các hồ sơ cơ sở dữ liệu đã lưu.
func (h *DbHandler) GetAllDbProfile() models.Output[models.GetAllDbProfileOutput] {
	return h.db.GetAllDbProfile()
}

// CreateDbProfile lưu hồ sơ cơ sở dữ liệu mới.
func (h *DbHandler) CreateDbProfile(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return h.db.CreateDbProfile(input)
}

// UpdateDbProfileById cập nhật hồ sơ cơ sở dữ liệu.
func (h *DbHandler) UpdateDbProfileById(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return h.db.UpdateDbProfileById(input)
}

// DeleteDbProfileById xóa hồ sơ cơ sở dữ liệu và đóng các kết nối tương ứng.
func (h *DbHandler) DeleteDbProfileById(input models.DbProfileInput) models.Output[bool] {
	return h.db.DeleteDbProfileById(input)
}

// ChooseDbFile mở hộp thoại của hệ điều hành để chọn file SQLite.
func (h *DbHandler) ChooseDbFile() models.Output[string] {
	return h.db.ChooseDbFile()
}

// ConnectDb mở kết nối chính của hồ sơ đã lưu.
func (h *DbHandler) ConnectDb(ctx context.Context, input models.DbProfileRefInput) models.Output[bool] {
	return h.db.ConnectDb(ctx, input)
}

// DisconnectDb đóng mọi kết nối của một hồ sơ.
func (h *DbHandler) DisconnectDb(input models.DbProfileRefInput) models.Output[bool] {
	return h.db.DisconnectDb(input)
}

// GetSchemaTree đọc cây đối tượng của hồ sơ đã kết nối.
func (h *DbHandler) GetSchemaTree(
	ctx context.Context,
	input models.DbProfileRefInput,
) models.Output[models.SchemaTreeOutput] {
	return h.db.GetSchemaTree(ctx, input)
}

// GetTableInfo đọc cấu trúc của bảng.
func (h *DbHandler) GetTableInfo(
	ctx context.Context,
	input models.TableInfoInput,
) models.Output[models.TableInfoOutput] {
	return h.db.GetTableInfo(ctx, input)
}

// ExecuteSql chạy các câu lệnh SQL trên kết nối của tab.
func (h *DbHandler) ExecuteSql(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	return h.db.ExecuteSql(ctx, input)
}

// OpenTableRows đọc trang đầu tiên của các hàng trong bảng.
func (h *DbHandler) OpenTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	return h.db.OpenTableRows(ctx, input)
}

// FetchRows tải trang tiếp theo của cursor thuộc tab.
func (h *DbHandler) FetchRows(ctx context.Context, input models.FetchRowsInput) models.Output[models.FetchRowsOutput] {
	return h.db.FetchRows(ctx, input)
}

// CloseDbTab đóng kết nối của tab.
func (h *DbHandler) CloseDbTab(input models.CloseDbTabInput) models.Output[bool] {
	return h.db.CloseDbTab(input)
}
