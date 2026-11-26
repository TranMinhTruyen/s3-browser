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

// Các provider được hỗ trợ.
const (
	providerSqlite   = "sqlite"
	providerPostgres = "postgres"
)

const maxPort = 65535

// errInvalidConfig là nội dung chi tiết của DBE010 khi thiếu trường cấu hình hoặc trường không hợp lệ.
var errInvalidConfig = errors.New("invalid profile config")

// submoduleProfileMng lưu hồ sơ cơ sở dữ liệu trong chế độ SQL; mật khẩu được mã hóa bằng key manager.
type submoduleProfileMng struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
	conns  *submoduleConnMng
	km     *utils.KeyManager
}

// newSubmoduleProfileMng tạo kho hồ sơ; khi xóa hồ sơ, conns được yêu cầu đóng các kết nối tương ứng.
func newSubmoduleProfileMng(
	app *application.App,
	logger *slog.Logger,
	q *sqlc.Queries,
	conns *submoduleConnMng,
	km *utils.KeyManager,
) *submoduleProfileMng {
	return &submoduleProfileMng{logger: logger.With("submodules", "profile"), app: app, q: q, conns: conns, km: km}
}

// parseConfig đọc JSON cấu hình của hồ sơ đã lưu.
func parseConfig(p sqlc.DbProfile) (models.DbProfileConfig, error) {
	var cfg models.DbProfileConfig
	if err := json.Unmarshal([]byte(p.Config), &cfg); err != nil {
		return models.DbProfileConfig{}, err
	}
	return cfg, nil
}

// toOutput ánh xạ hồ sơ đã lưu; chỉ báo secret có tồn tại hay không.
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

// validateConfig kiểm tra các trường bắt buộc của provider rồi trả cấu hình chỉ gồm những trường provider đó sử dụng.
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

// nameMessage tạo thông báo về hồ sơ, trong đó {name} được thay bằng tên hồ sơ.
func nameMessage(code, name, errorDetail string) models.Message {
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Db, code, errorDetail, map[string]any{"name": name})
}

// seal mã hóa mật khẩu; nếu mật khẩu rỗng thì lưu thành NULL.
func (m *submoduleProfileMng) seal(v string) (sql.NullString, error) {
	if v == "" {
		return sql.NullString{}, nil
	}
	cipher, err := m.km.Encrypt(v)
	return sql.NullString{String: cipher, Valid: err == nil}, err
}

// prepare kiểm tra input rồi trả JSON cấu hình và secret đã mã hóa để lưu. stored là hàng hiện tại khi cập nhật
// (nil khi tạo mới): secret để trống sẽ giữ giá trị đã lưu nếu provider không đổi, nếu không thì xóa secret cũ.
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

// getAll liệt kê hồ sơ theo thứ tự từ cũ đến mới.
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

// create lưu hồ sơ mới.
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

// saved ánh xạ hàng đã lưu thành body đầu ra.
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

// update lưu các thay đổi của hồ sơ input.Id và giữ nguyên id; id không xác định sẽ trả DBE010.
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

// delete xóa hồ sơ rồi đóng các kết nối tương ứng; nếu thao tác xóa thất bại thì giữ các kết nối mở.
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

// chooseFile mở hộp thoại của hệ điều hành để chọn file SQLite rồi trả về đường dẫn. Hộp thoại chặn cho đến khi đóng,
// vì vậy không đặt timeout.
func (m *submoduleProfileMng) chooseFile() models.Output[string] {
	output := models.NewOutput[string]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	dialog.AddFilter("SQLite database", "*.db;*.sqlite;*.sqlite3;*.db3")
	dialog.AddFilter("All files", "*.*")
	// Ứng dụng chỉ có một cửa sổ; gắn hộp thoại vào cửa sổ này để hộp thoại ở chế độ modal (Current có thể là nil).
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
