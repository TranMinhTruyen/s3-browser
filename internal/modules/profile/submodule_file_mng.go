package profile

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// minExportPasswordLen là độ dài mật khẩu ngắn nhất được chấp nhận để bảo vệ secret khi xuất hồ sơ (tính bằng ký tự).
	minExportPasswordLen = 8
	// maxImportFileSize là kích thước tối đa của file hồ sơ được đọc khi nhập (tính bằng byte).
	maxImportFileSize = 1 << 20
	// maxProfileNameLen là độ dài tối đa của tên hồ sơ (tính bằng ký tự).
	maxProfileNameLen = 100
)

// submoduleFileMng xuất hồ sơ ra và nhập hồ sơ từ file JSON.
type submoduleFileMng struct {
	logger *slog.Logger
	app    *application.App
	q      *sqlc.Queries
	auth   *submoduleAuthMng
}

// newSubmoduleFileMng tạo submodule quản lý file hồ sơ.
func newSubmoduleFileMng(
	app *application.App,
	logger *slog.Logger,
	q *sqlc.Queries,
	auth *submoduleAuthMng,
) *submoduleFileMng {
	return &submoduleFileMng{logger: logger.With("submodules", "profile_file"), app: app, q: q, auth: auth}
}

// exportAction mở hộp thoại lưu của hệ điều hành để chọn file, sau đó ghi hồ sơ vào đó.
func (m *submoduleFileMng) exportAction(input models.ExportProfileInput) models.Output[string] {
	return m.exportTo(input, m.chooseSavePath)
}

// exportTo xuất hồ sơ vào đường dẫn choosePath trả về (kèm tên file gợi ý). Nếu đường dẫn rỗng hoặc hộp thoại bị hủy,
// hàm kết thúc im lặng với body rỗng. Mật khẩu và secret không bao giờ được ghi log hoặc đưa vào thông báo.
func (m *submoduleFileMng) exportTo(
	input models.ExportProfileInput,
	choosePath func(filename string) (string, error),
) models.Output[string] {
	output := models.NewOutput[string]()

	if input.IncludeSecret && len([]rune(input.Password)) < minExportPasswordLen {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE015, ""))
	}

	row, err := m.q.SelectConnectionProfileById(m.app.Context(), input.Id)
	if err != nil {
		m.logger.Error("export: get profile failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE003, err.Error()))
	}
	config, err := parseAuthConfig(row)
	if err != nil {
		m.logger.Error("export: read auth config failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(outputErrorMessage(err))
	}
	var secrets plainSecrets
	if input.IncludeSecret {
		if secrets, err = m.auth.open(row); err != nil {
			m.logger.Error("export: read secrets failed", "connectionId", input.Id, "error", err)
			return output.ThrowError(outputErrorMessage(err))
		}
	}

	path, err := choosePath(safeFileName(row.Name.String) + ".json")
	if utils.IsDialogCancelled(err) || (err == nil && path == "") {
		m.logger.Debug("export profile dialog cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("export: choose path failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(nameMessage(cnst.MessageTypeError, PFE010, row.Name.String, err.Error()))
	}
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		path += ".json"
	}

	data, err := buildProfileFile(row, config, secrets, input.Password)
	if err == nil {
		err = os.WriteFile(path, data, 0o600)
	}
	if err != nil {
		m.logger.Error("export: write file failed", "connectionId", input.Id, "error", err)
		return output.ThrowError(nameMessage(cnst.MessageTypeError, PFE010, row.Name.String, err.Error()))
	}

	output.Body = path
	output.AddMessage(nameMessage(cnst.MessageTypeSuccess, PFS004, row.Name.String, ""))
	return output
}

// chooseSavePath mở hộp thoại lưu của hệ điều hành; đường dẫn rỗng nếu người dùng hủy.
func (m *submoduleFileMng) chooseSavePath(filename string) (string, error) {
	dialog := m.app.Dialog.SaveFile().SetFilename(filename)
	dialog.AddFilter("JSON files", "*.json")
	// Ứng dụng chỉ có một cửa sổ; gắn hộp thoại vào cửa sổ này để hộp thoại ở chế độ modal (Current có thể là nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}
	return dialog.PromptForSingleSelection()
}

// buildProfileFile tạo JSON cho file hồ sơ. Chỉ thêm secret nếu có, sau khi mã hóa bằng password;
// file không bao giờ chứa secret ở dạng văn bản thuần.
func buildProfileFile(
	row sqlc.ConnectionProfile,
	config models.AuthConfig,
	secrets plainSecrets,
	password string,
) ([]byte, error) {
	file := profileFile{
		Format:  profileFileFormat,
		Version: profileFileVersion,
		Profile: &fileProfile{
			Name:        row.Name.String,
			Color:       row.Color.String,
			Provider:    row.Provider,
			Endpoint:    row.Endpoint,
			Region:      row.Region,
			AccessKey:   row.AccessKey.String,
			PathStyle:   row.PathStyle.Bool,
			AutoConnect: row.AutoConnect.Bool,
			AuthType:    row.AuthType,
			AuthConfig:  config,
		},
	}

	if len(secrets.names()) > 0 {
		plain, err := json.Marshal(fileSecret{SecretKey: secrets.secretKey, AuthSecret: secrets.AuthSecret})
		if err != nil {
			return nil, err
		}
		sealed, err := utils.SealWithPassword(plain, password, secretAAD(file.Profile))
		if err != nil {
			return nil, err
		}
		file.Secret = &sealed
	}

	return json.MarshalIndent(file, "", "  ")
}

// safeFileName chuyển tên hồ sơ thành tên file ASCII dạng snake_case (ví dụ "Kết nối thử" -> "ket_noi_thu").
// Chữ không có dạng ASCII bị bỏ qua; tên thiết bị Windows được thêm hậu tố "_". Hàm không bao giờ trả tên rỗng.
func safeFileName(name string) string {
	var sb strings.Builder
	lastSep := true // true at the start so no leading "_"
	for _, r := range strings.ToLower(name) {
		if base, ok := cnst.ASCIIFolds[r]; ok {
			r = base
		}
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			sb.WriteRune(r)
			lastSep = false
		case r > unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsMark(r)):
			// Không có dạng ASCII: bỏ qua.
		case !lastSep:
			sb.WriteByte('_')
			lastSep = true
		}
	}
	result := strings.TrimRight(sb.String(), "_")
	if result == "" {
		return "profile"
	}
	if cnst.WindowsReservedNames[result] {
		return result + "_" // e.g. "con" -> "con_"
	}
	return result
}

// importedProfile là file hồ sơ đã sẵn sàng để tạo thành hồ sơ mới.
type importedProfile struct {
	input models.ConnectionProfileInput
	// clearedFields chứa tên các đường dẫn file không tồn tại trên máy này và đã bị xóa.
	clearedFields []string
	// allowMissingCertKey được bật nếu file chứng chỉ hoặc khóa của hồ sơ minioCert vừa bị xóa.
	allowMissingCertKey bool
}

// chooseImportAction mở hộp thoại của hệ điều hành để chọn và kiểm tra file hồ sơ. Hủy thao tác sẽ trả body rỗng.
func (m *submoduleFileMng) chooseImportAction() models.Output[models.ImportFileOutput] {
	output := models.NewOutput[models.ImportFileOutput]()

	dialog := m.app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false)
	dialog.AddFilter("JSON files", "*.json")
	// Ứng dụng chỉ có một cửa sổ; gắn hộp thoại vào cửa sổ này để hộp thoại ở chế độ modal (Current có thể là nil).
	if window := m.app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if utils.IsDialogCancelled(err) || (err == nil && path == "") {
		m.logger.Debug("import profile dialog cancelled")
		return output
	}
	if err != nil {
		m.logger.Error("import: choose file failed", "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Profile, PFE011, err.Error()))
	}

	file, failure := m.readFile(path)
	if failure != nil {
		return output.ThrowError(*failure)
	}
	output.Body = models.ImportFileOutput{Path: path, Name: filepath.Base(path), Encrypted: file.Secret != nil}
	return output
}

// importAction đọc và kiểm tra lại file hồ sơ, giải mã secret bằng mật khẩu rồi tạo dữ liệu đầu vào để lưu.
// Secret và mật khẩu không bao giờ được ghi log hoặc đưa vào thông báo.
func (m *submoduleFileMng) importAction(input models.ImportProfileInput) (importedProfile, *models.Message) {
	file, failure := m.readFile(input.Path)
	if failure != nil {
		return importedProfile{}, failure
	}

	var secret fileSecret
	if file.Secret != nil {
		if len([]rune(input.Password)) < minExportPasswordLen {
			return importedProfile{}, errMessage(PFE015, errors.New("password needed"))
		}
		plain, err := utils.OpenWithPassword(*file.Secret, input.Password, secretAAD(file.Profile))
		if err == nil {
			err = json.Unmarshal(plain, &secret)
		}
		if err != nil {
			code := PFE014
			if errors.Is(err, utils.ErrInvalidSealed) {
				code = PFE012
			}
			m.logger.Warn("import: open secrets failed", "code", code)
			return importedProfile{}, errMessage(code, err)
		}
	}

	rows, err := m.q.SelectAllConnectionProfile(m.app.Context())
	if err != nil {
		m.logger.Error("import: get profiles failed", "error", err)
		return importedProfile{}, errMessage(PFE003, err)
	}
	taken := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		taken[row.Name.String] = struct{}{}
	}

	p := file.Profile
	cleared := clearMissingPaths(&p.AuthConfig)
	certCleared, keyCleared := slices.Contains(cleared, "certFile"), slices.Contains(cleared, "keyFile")
	return importedProfile{
		input: models.ConnectionProfileInput{
			Name:         uniqueName(p.Name, taken),
			Color:        p.Color,
			Provider:     p.Provider,
			Endpoint:     p.Endpoint,
			Region:       p.Region,
			AccessKey:    p.AccessKey,
			SecretKey:    secret.SecretKey,
			PathStyle:    p.PathStyle,
			SavePassword: file.Secret != nil,
			AutoConnect:  p.AutoConnect,
			AuthType:     p.AuthType,
			AuthConfig:   p.AuthConfig,
			AuthSecret:   secret.AuthSecret,
		},
		clearedFields: cleared,
		allowMissingCertKey: (certCleared || keyCleared) &&
			(p.AuthConfig.CertFile != "" || certCleared) && (p.AuthConfig.KeyFile != "" || keyCleared),
	}, nil
}

// readFile đọc file hồ sơ có kích thước tối đa maxImportFileSize byte rồi kiểm tra định dạng và phiên bản.
func (m *submoduleFileMng) readFile(path string) (profileFile, *models.Message) {
	f, err := os.Open(path)
	if err != nil {
		m.logger.Error("import: open file failed", "error", err)
		return profileFile{}, errMessage(PFE011, err)
	}
	defer func() { _ = f.Close() }()

	data, err := io.ReadAll(io.LimitReader(f, maxImportFileSize+1))
	if err != nil || len(data) > maxImportFileSize {
		if err == nil {
			err = errors.New("file is larger than 1 MiB")
		}
		m.logger.Error("import: read file failed", "error", err)
		return profileFile{}, errMessage(PFE011, err)
	}

	file, err := parseProfileFile(data)
	var unsupported unsupportedVersionError
	switch {
	case errors.As(err, &unsupported):
		msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE013, "", map[string]any{
			"version": unsupported.version,
		})
		return profileFile{}, &msg
	case err != nil:
		return profileFile{}, errMessage(PFE012, err)
	}
	return file, nil
}

// uniqueName trả name hoặc name + " (n)" với n nhỏ nhất từ 2 không có trong taken. Tên được cắt theo ký tự
// để kết quả không dài quá maxProfileNameLen.
func uniqueName(name string, taken map[string]struct{}) string {
	if _, ok := taken[name]; !ok {
		return name
	}
	runes := []rune(name)
	for n := 2; ; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		base := runes[:min(len(runes), maxProfileNameLen-len(suffix))]
		if candidate := string(base) + suffix; !isTaken(taken, candidate) {
			return candidate
		}
	}
}

// isTaken cho biết name có nằm trong taken hay không.
func isTaken(taken map[string]struct{}, name string) bool {
	_, ok := taken[name]
	return ok
}

// clearMissingPaths xóa các đường dẫn file trong cfg không tồn tại trên máy này rồi trả về tên các trường đó.
func clearMissingPaths(cfg *models.AuthConfig) []string {
	var cleared []string
	for _, f := range []struct {
		name string
		path *string
	}{
		{"certFile", &cfg.CertFile},
		{"keyFile", &cfg.KeyFile},
		{"caFile", &cfg.CaFile},
		{"configFile", &cfg.ConfigFile},
		{"credentialsFile", &cfg.CredentialsFile},
	} {
		if *f.path == "" {
			continue
		}
		path := expandHome(*f.path)
		if isUnsafePath(path) {
			*f.path = ""
			cleared = append(cleared, f.name)
			continue
		}
		if _, err := os.Stat(path); err != nil {
			*f.path = ""
			cleared = append(cleared, f.name)
		}
	}
	return cleared
}

// isUnsafePath cho biết path có thể trỏ đến máy khác hoặc thiết bị hay không. Chỉ đường dẫn tương đối và đường dẫn ổ đĩa
// thông thường (X:\...) được xem là an toàn: không bao giờ stat đường dẫn UNC (\\host\share, //host/share), \\?\, \\.\ hoặc dạng NT \??\.
func isUnsafePath(path string) bool {
	isSep := func(c byte) bool { return c == '\\' || c == '/' }
	if len(path) >= 2 && isSep(path[0]) && isSep(path[1]) ||
		strings.HasPrefix(path, `\??\`) || strings.HasPrefix(path, `/??/`) {
		return true
	}
	vol := filepath.VolumeName(path)
	return vol != "" && (len(vol) != 2 || vol[1] != ':')
}

// expandHome thay dấu "~" ở đầu bằng thư mục home của người dùng, giống bộ nạp thông tin xác thực AWS.
func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}
