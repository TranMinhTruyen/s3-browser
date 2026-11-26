// Package db xử lý chế độ SQL: hồ sơ cơ sở dữ liệu đã lưu, kết nối đến engine cơ sở dữ liệu native
// (s3b_db.dll, được nạp không dùng cgo) và các truy vấn frontend gửi qua những kết nối đó.
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
	// DBE001 - Yêu cầu gửi đến engine cơ sở dữ liệu không hợp lệ.
	DBE001 = "DBE001"

	// DBE002 - Không thể mở file cơ sở dữ liệu {path}.
	DBE002 = "DBE002"

	// DBE003 - File không phải cơ sở dữ liệu SQLite.
	DBE003 = "DBE003"

	// DBE004 - Kết nối đã đóng. Hãy kết nối lại.
	DBE004 = "DBE004"

	// DBE005 - Kết quả không còn khả dụng. Hãy chạy lại truy vấn.
	DBE005 = "DBE005"

	// DBE006 - Lỗi SQL (chi tiết là lỗi từ engine; hiển thị cùng kết quả, không hiện dưới dạng toast).
	DBE006 = "DBE006"

	// DBE007 - Bảng [{name}] không tồn tại.
	DBE007 = "DBE007"

	// DBE008 - Lỗi engine cơ sở dữ liệu.
	DBE008 = "DBE008"

	// DBE009 - Không thể nạp engine cơ sở dữ liệu (s3b_db.dll).
	DBE009 = "DBE009"

	// DBE010 - Không thể lưu hồ sơ cơ sở dữ liệu [{name}].
	DBE010 = "DBE010"

	// DBE011 - Không thể xóa hồ sơ cơ sở dữ liệu [{name}].
	DBE011 = "DBE011"

	// DBE012 - Không thể tải danh sách hồ sơ cơ sở dữ liệu.
	DBE012 = "DBE012"

	// DBE013 - Không thể mở hộp thoại chọn file.
	DBE013 = "DBE013"

	// DBE014 - Hồ sơ [{name}] chưa được kết nối.
	DBE014 = "DBE014"

	// DBE015 - Thao tác đã hết thời gian chờ sau {timeout}.
	DBE015 = "DBE015"
)

const (
	// queryTimeout giới hạn thời gian của một lần gọi ExecuteSql, OpenTableRows hoặc FetchRows; cursor đang mở nhưng nhàn rỗi không bị tính giờ.
	queryTimeout = 5 * time.Minute
	// metaTimeout giới hạn thời gian mở kết nối và đọc schema.
	metaTimeout = 30 * time.Second

	// pageSize là số hàng trong trang đầu và mỗi trang FetchRows.
	pageSize = 10000
	// maxPageBytes giới hạn lượng văn bản của mỗi trang (luôn có ít nhất một hàng) để trang chứa giá trị lớn không quá nặng.
	maxPageBytes = 16 << 20
	// unlimited là giới hạn trang của FetchRows khi bật All; cao hơn nhiều so với mọi bảng thực tế và vẫn nằm trong kiểu usize của Rust.
	unlimited = 1 << 62
)

// Module quản lý hồ sơ cơ sở dữ liệu và các kết nối trong chế độ SQL.
type Module struct {
	logger *slog.Logger
	app    *application.App

	profileMng *submoduleProfileMng
	connMng    *submoduleConnMng
	queryMng   *submoduleQueryMng
	nativeMng  *submoduleNativeMng
}

// NewModule tạo module cơ sở dữ liệu. Thư viện native chỉ được nạp khi tạo kết nối đầu tiên.
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

// Loaded cho biết thư viện native đã được nạp hay chưa; hàm này không tự nạp thư viện.
func (m *Module) Loaded() bool {
	return m.nativeMng.loaded()
}

// GetAllDbProfile trả về danh sách hồ sơ cơ sở dữ liệu đã lưu.
func (m *Module) GetAllDbProfile() models.Output[models.GetAllDbProfileOutput] {
	return m.profileMng.getAll()
}

// CreateDbProfile lưu hồ sơ mới. Provider là sqlite hoặc postgres; mật khẩu được lưu ở dạng mã hóa.
func (m *Module) CreateDbProfile(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return m.profileMng.create(input)
}

// UpdateDbProfileById cập nhật hồ sơ.
func (m *Module) UpdateDbProfileById(input models.DbProfileInput) models.Output[models.DbProfileOutput] {
	return m.profileMng.update(input)
}

// DeleteDbProfileById xóa hồ sơ rồi đóng các kết nối của hồ sơ; nếu xóa thất bại, kết nối vẫn được giữ mở.
func (m *Module) DeleteDbProfileById(input models.DbProfileInput) models.Output[bool] {
	return m.profileMng.delete(input)
}

// ChooseDbFile mở hộp thoại của hệ điều hành để chọn file SQLite và trả về đường dẫn; body rỗng nếu người dùng hủy.
func (m *Module) ChooseDbFile() models.Output[string] {
	return m.profileMng.chooseFile()
}

// ConnectDb mở kết nối chính của hồ sơ đã lưu (dùng cho cây đối tượng và thông tin bảng).
// Nếu hồ sơ đã kết nối thì hàm không làm gì.
func (m *Module) ConnectDb(ctx context.Context, input models.DbProfileRefInput) models.Output[bool] {
	return m.connMng.connect(ctx, input.ProfileId)
}

// DisconnectDb đóng kết nối chính và mọi kết nối tab của hồ sơ.
func (m *Module) DisconnectDb(input models.DbProfileRefInput) models.Output[bool] {
	return m.connMng.disconnect(input.ProfileId)
}

// GetSchemaTree đọc cây đối tượng của hồ sơ đã kết nối.
func (m *Module) GetSchemaTree(
	ctx context.Context,
	input models.DbProfileRefInput,
) models.Output[models.SchemaTreeOutput] {
	return m.connMng.schemaTree(ctx, input.ProfileId)
}

// GetTableInfo đọc cột, chỉ mục, ràng buộc, khóa ngoại và câu lệnh tạo bảng.
func (m *Module) GetTableInfo(
	ctx context.Context,
	input models.TableInfoInput,
) models.Output[models.TableInfoOutput] {
	return m.connMng.tableInfo(ctx, input)
}

// ExecuteSql chạy lần lượt các câu lệnh trong input.Sql trên kết nối của tab và dừng ở câu đầu tiên thất bại.
// Lỗi SQL được ghi vào kết quả câu lệnh, không gửi dưới dạng thông báo.
func (m *Module) ExecuteSql(
	ctx context.Context,
	input models.ExecuteSqlInput,
) models.Output[models.ExecuteSqlOutput] {
	return m.queryMng.execute(ctx, input)
}

// OpenTableRows đọc trang đầu tiên của các hàng trong bảng trên kết nối của tab.
func (m *Module) OpenTableRows(
	ctx context.Context,
	input models.OpenTableRowsInput,
) models.Output[models.StatementResult] {
	return m.queryMng.openTableRows(ctx, input)
}

// FetchRows tải trang tiếp theo từ cursor của tab hoặc, nếu input.All được bật, tải toàn bộ hàng còn lại
// (không giới hạn số trang hay thời gian chờ; frontend có thể dừng bằng cách hủy lời gọi).
func (m *Module) FetchRows(ctx context.Context, input models.FetchRowsInput) models.Output[models.FetchRowsOutput] {
	return m.queryMng.fetchRows(ctx, input)
}

// CloseDbTab đóng kết nối của tab; tab không có kết nối cũng được chấp nhận.
func (m *Module) CloseDbTab(input models.CloseDbTabInput) models.Output[bool] {
	return m.connMng.closeTab(input.TabId)
}

// Close đóng mọi kết nối khi ứng dụng tắt. Hàm không làm gì nếu thư viện native chưa từng được nạp.
func (m *Module) Close() {
	m.connMng.closeAll()
}
