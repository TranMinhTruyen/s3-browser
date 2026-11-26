// Package profile quản lý hồ sơ kết nối đã lưu và mã hóa các thông tin bí mật.
package profile

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"database/sql"
	"errors"
	"log/slog"
	"slices"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// PFE001 - Lỗi khi lưu hồ sơ
	PFE001 = "PFE001"

	// PFE002 - Không thể giải mã SecretKey
	PFE002 = "PFE002"

	// PFE003 - Lỗi khi lấy danh sách hồ sơ kết nối
	PFE003 = "PFE003"

	// PFE005 - Lỗi khi cập nhật hồ sơ [{name}]
	PFE005 = "PFE005"

	// PFE006 - Lỗi khi xóa hồ sơ [{name}]
	PFE006 = "PFE006"

	// PFE007 - Hồ sơ [{name}] đang tải lên hoặc tải xuống, không thể xóa
	PFE007 = "PFE007"

	// PFE008 - Phương thức xác thực {authType} không hợp lệ với nhà cung cấp {provider}.
	PFE008 = "PFE008"

	// PFE009 - Cấu hình xác thực không hợp lệ.
	PFE009 = "PFE009"

	// PFE010 - Không thể xuất hồ sơ [{name}].
	PFE010 = "PFE010"

	// PFE011 - Không thể đọc file hồ sơ (có thể file lớn hơn 1 MiB).
	PFE011 = "PFE011"

	// PFE012 - File không phải là file hồ sơ S3Browser hợp lệ.
	PFE012 = "PFE012"

	// PFE013 - Không hỗ trợ phiên bản {version} của file hồ sơ.
	PFE013 = "PFE013"

	// PFE014 - Mật khẩu sai hoặc file bị hỏng.
	PFE014 = "PFE014"

	// PFE015 - Mật khẩu phải có ít nhất 8 ký tự.
	PFE015 = "PFE015"

	// PFS001 - Thêm hồ sơ [{name}] thành công
	PFS001 = "PFS001"

	// PFS002 - Cập nhật hồ sơ [{name}] thành công
	PFS002 = "PFS002"

	// PFS003 - Xóa hồ sơ [{name}] thành công
	PFS003 = "PFS003"

	// PFS004 - Xuất hồ sơ [{name}] thành công
	PFS004 = "PFS004"

	// PFW001 - Đã nhập hồ sơ [{name}]. Các đường dẫn file sau không tồn tại trên máy này và đã được xóa: {fields}.
	PFW001 = "PFW001"
)

// Module lưu hồ sơ kết nối trong cơ sở dữ liệu.
type Module struct {
	logger *slog.Logger
	app    *application.App
	global *global.Module
	q      *sqlc.Queries

	submoduleAuthMng *submoduleAuthMng
	submoduleFileMng *submoduleFileMng
}

// NewModule tạo module profile.
func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	km *utils.KeyManager,
) *Module {
	q := sqlc.New(db)
	auth := newSubmoduleAuthMng(km)

	return &Module{
		logger: logger.With("component", "profiles_module"),
		app:    app,
		global: global,
		q:      q,

		submoduleAuthMng: auth,
		submoduleFileMng: newSubmoduleFileMng(app, logger, q, auth),
	}
}

// toProfileOutput chuyển hồ sơ đã lưu thành dữ liệu đầu ra cho frontend. Hàm không trả lộ thông tin bí mật,
// chỉ trả tên các thông tin đó. Nếu có lỗi (không đọc được secret hoặc auth_config), hàm vẫn trả phần hồ sơ đọc được.
func (m *Module) toProfileOutput(p sqlc.ConnectionProfile) (models.ConnectionProfileOutput, error) {
	secrets, secretErr := m.submoduleAuthMng.open(p)
	authConfig, configErr := parseAuthConfig(p)

	return models.ConnectionProfileOutput{
		ID:           p.ID,
		Name:         p.Name.String,
		Color:        p.Color.String,
		Provider:     p.Provider,
		Endpoint:     p.Endpoint,
		Region:       p.Region,
		AccessKey:    p.AccessKey.String,
		PathStyle:    p.PathStyle.Bool,
		AutoConnect:  p.AutoConnect.Bool,
		CreatedAt:    p.CreatedAt.Time,
		UpdatedAt:    p.UpdatedAt.Time,
		Version:      p.Version,
		IsConnected:  m.global.HasConn(p.ID),
		AuthType:     p.AuthType,
		AuthConfig:   authConfig,
		SavedSecrets: secrets.names(),
	}, errors.Join(secretErr, configErr)
}

// outputErrorMessage ánh xạ lỗi của toProfileOutput sang thông báo tương ứng: PFE009 nếu auth_config sai,
// nếu không thì là PFE002.
func outputErrorMessage(err error) models.Message {
	code := PFE002
	if errors.Is(err, errInvalidAuthConfig) {
		code = PFE009
	}
	return models.NewMessage(cnst.MessageTypeError, cnst.Profile, code, err.Error())
}

// warnMessage chuyển thông báo của outputErrorMessage thành cảnh báo khi hồ sơ đã lưu nhưng không thể đọc lại đầy đủ.
func warnMessage(err error) models.Message {
	msg := outputErrorMessage(err)
	msg.MessageType = cnst.MessageTypeWarn
	return msg
}

// CreateProfile lưu hồ sơ mới. Thông tin bí mật được mã hóa và chỉ lưu khi SavePassword được bật.
// Nếu nhà cung cấp không hỗ trợ authType, hàm trả PFE008 và không ghi dữ liệu.
func (m *Module) CreateProfile(
	input models.ConnectionProfileInput,
) models.Output[models.ConnectionProfileOutput] {
	return m.createProfile(input, false)
}

// createProfile thực hiện việc lưu hồ sơ như CreateProfile; chỉ thao tác nhập mới bật allowMissingCertKey (xem prepare).
func (m *Module) createProfile(
	input models.ConnectionProfileInput,
	allowMissingCertKey bool,
) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	auth, failure := m.submoduleAuthMng.prepare(input, nil, allowMissingCertKey)
	if failure != nil {
		return output.ThrowError(*failure)
	}

	params := sqlc.CreateProfileParams{
		ID:          utils.GenerateUUID(),
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   auth.accessKey,
		SecretKey:   auth.secretKey,
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: auth.autoConnect, Valid: true},
		AuthType:    auth.authType,
		AuthConfig:  auth.config,
		AuthSecret:  auth.secret,
	}

	result, err := m.q.CreateProfile(m.app.Context(), params)
	if err != nil {
		m.logger.Error("save connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE001, err.Error()))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("read saved profile failed", "connectionId", result.ID, "error", err)
		// Hồ sơ đã được lưu nên trả cảnh báo thay vì báo lỗi.
		output.AddMessage(warnMessage(err))
	}
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS001, result.Name.String, ""))

	return output
}

// UpdateProfileById cập nhật hồ sơ; input.Version là giá trị khóa lạc quan mà bên gọi đọc lần gần nhất.
// Secret để trống sẽ giữ nguyên giá trị đã lưu; SavePassword=false sẽ xóa toàn bộ secret đã lưu.
func (m *Module) UpdateProfileById(input models.ConnectionProfileInput) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	// Chỉ cần đọc bản ghi đã lưu để giữ lại các secret mà bên gọi để trống.
	var stored *sqlc.ConnectionProfile
	if input.SavePassword {
		row, err := m.q.SelectConnectionProfileById(m.app.Context(), input.Id)
		if err != nil {
			m.logger.Error("get stored profile failed", "connectionId", input.Id, "error", err)
			return output.ThrowError(updateError(input.Name, err))
		}
		stored = &row
	}

	auth, failure := m.submoduleAuthMng.prepare(input, stored, false)
	if failure != nil {
		return output.ThrowError(*failure)
	}

	params := sqlc.UpdateConnectionProfileByIdParams{
		ID:          input.Id,
		Name:        sql.NullString{String: input.Name, Valid: true},
		Color:       sql.NullString{String: input.Color, Valid: true},
		Provider:    input.Provider,
		Endpoint:    input.Endpoint,
		Region:      input.Region,
		AccessKey:   auth.accessKey,
		SecretKey:   auth.secretKey,
		PathStyle:   sql.NullBool{Bool: input.PathStyle, Valid: true},
		AutoConnect: sql.NullBool{Bool: auth.autoConnect, Valid: true},
		AuthType:    auth.authType,
		AuthConfig:  auth.config,
		AuthSecret:  auth.secret,
		Version:     input.Version,
	}

	result, err := m.q.UpdateConnectionProfileById(m.app.Context(), params)
	if err != nil {
		m.logger.Error("update connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(updateError(input.Name, err))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("read saved profile failed", "connectionId", result.ID, "error", err)
		output.AddMessage(warnMessage(err))
	}
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS002, result.Name.String, ""))

	return output
}

// nameMessage tạo thông báo về hồ sơ, trong đó {name} được thay bằng tên hồ sơ.
func nameMessage(msgType, code, name, errorDetail string) models.Message {
	return models.NewParamsMessage(msgType, cnst.Profile, code, errorDetail, map[string]any{"name": name})
}

// updateError tạo thông báo PFE005 khi cập nhật tên hồ sơ thất bại.
func updateError(name string, err error) models.Message {
	return nameMessage(cnst.MessageTypeError, PFE005, name, err.Error())
}

// DeleteProfileById đóng kết nối đang hoạt động của hồ sơ (nếu có), rồi xóa hồ sơ.
// Result là false nếu không xóa được hồ sơ hoặc vẫn còn lượt truyền dữ liệu trên kết nối đó.
func (m *Module) DeleteProfileById(input models.ConnectionProfileInput) models.Output[bool] {
	output := models.NewOutput[bool]()

	conn, removed, busy := m.global.RemoveConnIfIdle(input.Id)
	if busy {
		m.logger.Warn("delete profile refused, transfers in progress", "connectionId", input.Id)
		return output.ThrowError(
			nameMessage(cnst.MessageTypeError, PFE007, input.Name, ""),
		)
	}
	if removed {
		// Đóng kết nối tại đây, sau khi nhả khóa của container, vì thao tác đóng có I/O mạng.
		conn.Close()
	}

	if err := m.q.DeleteConnectionProfileById(m.app.Context(), input.Id); err != nil {
		m.logger.Error("delete connection profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(
			nameMessage(cnst.MessageTypeError, PFE006, input.Name, err.Error()),
		)
	}

	output.Body = true
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS003, input.Name, ""))

	return output
}

// ExportProfile ghi hồ sơ vào file JSON được chọn qua hộp thoại lưu của hệ điều hành và trả về đường dẫn file.
// Nếu bật IncludeSecret, các secret đã lưu được mã hóa bằng Password (ít nhất 8 ký tự, nếu không trả PFE015);
// nếu không, file sẽ không chứa secret. Khi người dùng hủy hộp thoại, body rỗng và không có thông báo.
func (m *Module) ExportProfile(input models.ExportProfileInput) models.Output[string] {
	return m.submoduleFileMng.exportAction(input)
}

// ChooseImportFile mở hộp thoại của hệ điều hành để chọn file hồ sơ và kiểm tra kích thước, định dạng, phiên bản.
// Body cho biết file có chứa secret hay không (để xác định có cần mật khẩu); đường dẫn rỗng nếu người dùng hủy.
func (m *Module) ChooseImportFile() models.Output[models.ImportFileOutput] {
	return m.submoduleFileMng.chooseImportAction()
}

// ImportProfile lưu hồ sơ trong file thành hồ sơ mới với id mới và mã hóa lại các secret.
// Nếu tên đã được dùng, hàm thêm " (2)", " (3)"...; đường dẫn file không tồn tại trên máy này sẽ bị xóa.
// Khi đó PFW001 thay cho thông báo thành công PFS001.
// File được kiểm tra lại; nếu file không hợp lệ hoặc mật khẩu sai thì không ghi dữ liệu.
// Hàm không kết nối, kể cả khi AutoConnect được bật.
func (m *Module) ImportProfile(input models.ImportProfileInput) models.Output[models.ConnectionProfileOutput] {
	imported, failure := m.submoduleFileMng.importAction(input)
	if failure != nil {
		output := models.NewOutput[models.ConnectionProfileOutput]()
		return output.ThrowError(*failure)
	}

	output := m.createProfile(imported.input, imported.allowMissingCertKey)
	if output.Result && len(imported.clearedFields) > 0 {
		// PFW001 đã thông báo nhập hồ sơ thành công nên thay cho toast PFS001.
		output.MessageList = slices.DeleteFunc(output.MessageList, func(msg models.Message) bool {
			return msg.MessageCode == PFS001
		})
		output.AddMessage(models.NewParamsMessage(cnst.MessageTypeWarn, cnst.Profile, PFW001, "", map[string]any{
			"name":   output.Body.Name,
			"fields": strings.Join(imported.clearedFields, ", "),
		}))
	}
	return output
}

// GetConnectionProfileById trả về hồ sơ; không kèm secret mà chỉ kèm tên trong SavedSecrets.
func (m *Module) GetConnectionProfileById(connectionID string) models.Output[models.ConnectionProfileOutput] {
	output := models.NewOutput[models.ConnectionProfileOutput]()

	result, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)
	if err != nil {
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	if output.Body, err = m.toProfileOutput(result); err != nil {
		m.logger.Error("error while read profile", "connectionId", connectionID, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}

	return output
}

// GetConnectInput trả hồ sơ đã lưu dưới dạng dữ liệu đầu vào kết nối và giải mã các secret.
// Hàm chỉ dành cho backend (không handler nào công khai hàm này), frontend không bao giờ nhận được secret.
func (m *Module) GetConnectInput(connectionID string) models.Output[models.ConnectionProfileInput] {
	output := models.NewOutput[models.ConnectionProfileInput]()

	row, err := m.q.SelectConnectionProfileById(m.app.Context(), connectionID)
	if err != nil {
		m.logger.Error("error while get profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	secrets, secretErr := m.submoduleAuthMng.open(row)
	authConfig, configErr := parseAuthConfig(row)
	if err := errors.Join(secretErr, configErr); err != nil {
		m.logger.Error("error while read profile", "connectionId", connectionID, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}

	output.Body = models.ConnectionProfileInput{
		Id:          row.ID,
		Name:        row.Name.String,
		Color:       row.Color.String,
		Provider:    row.Provider,
		Endpoint:    row.Endpoint,
		Region:      row.Region,
		AccessKey:   row.AccessKey.String,
		SecretKey:   secrets.secretKey,
		PathStyle:   row.PathStyle.Bool,
		AutoConnect: row.AutoConnect.Bool,
		Version:     row.Version,
		AuthType:    row.AuthType,
		AuthConfig:  authConfig,
		AuthSecret:  secrets.AuthSecret,
	}

	return output
}

// GetAllConnectionProfile trả về mọi hồ sơ, dùng id làm khóa và lấy IsConnected từ các kết nối đang hoạt động.
// Hồ sơ có secret hoặc auth_config không đọc được vẫn được trả về, đồng thời báo PFE002/PFE009.
func (m *Module) GetAllConnectionProfile() models.Output[models.GetAllConnectionProfileOutput] {
	output := models.NewOutput[models.GetAllConnectionProfileOutput]()

	result, err := m.q.SelectAllConnectionProfile(m.app.Context())
	if err != nil {
		m.logger.Error("error get all profile", slog.Any("error", err))
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}

	profiles := make(map[string]models.ConnectionProfileOutput, len(result))
	for _, item := range result {
		profile, err := m.toProfileOutput(item)
		if err != nil {
			m.logger.Error("error while read profile", "connectionId", item.ID, "error", err)
			output.AddMessage(outputErrorMessage(err))
		}
		profiles[item.ID] = profile
	}

	output.Body = models.GetAllConnectionProfileOutput{ConnectionProfiles: profiles}

	return output
}
