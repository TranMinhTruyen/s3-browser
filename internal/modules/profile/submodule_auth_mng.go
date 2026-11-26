package profile

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"cmp"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Khoảng cổng callback OIDC (0 nghĩa là dùng cổng mặc định).
const (
	minCallbackPort = 1024
	maxCallbackPort = 65535
)

// errInvalidAuthConfig đánh dấu auth_config đã lưu nhưng không phân tích được (PFE009).
var errInvalidAuthConfig = errors.New("auth config invalid")

// plainSecrets chứa mọi secret của hồ sơ ở dạng văn bản thuần. Chỉ giữ trong bộ nhớ, không ghi log hay đưa vào đầu ra.
type plainSecrets struct {
	secretKey string
	models.AuthSecret
}

// names liệt kê các secret có giá trị để báo cho frontend trong SavedSecrets.
func (s plainSecrets) names() []string {
	names := make([]string, 0, 4)
	for _, f := range []struct{ name, value string }{
		{"secretKey", s.secretKey},
		{"sessionToken", s.SessionToken},
		{"ldapPassword", s.LdapPassword},
		{"keyPassword", s.KeyPassword},
	} {
		if f.value != "" {
			names = append(names, f.name)
		}
	}
	return names
}

// fillEmpty chép secret từ old vào các trường rỗng của s: input để trống nghĩa là "giữ nguyên giá trị đã lưu".
func (s plainSecrets) fillEmpty(old plainSecrets) plainSecrets {
	s.secretKey = cmp.Or(s.secretKey, old.secretKey)
	s.SessionToken = cmp.Or(s.SessionToken, old.SessionToken)
	s.LdapPassword = cmp.Or(s.LdapPassword, old.LdapPassword)
	s.KeyPassword = cmp.Or(s.KeyPassword, old.KeyPassword)
	return s
}

// authColumns chứa các cột xác thực của một hàng hồ sơ, đã sẵn sàng để lưu.
type authColumns struct {
	authType    string
	accessKey   sql.NullString
	config      sql.NullString
	secretKey   sql.NullString
	secret      sql.NullString
	autoConnect bool
}

// submoduleAuthMng kiểm tra cấu hình xác thực của hồ sơ và mã hóa/giải mã các secret.
type submoduleAuthMng struct {
	km *utils.KeyManager
}

// newSubmoduleAuthMng tạo submodule xác thực.
func newSubmoduleAuthMng(km *utils.KeyManager) *submoduleAuthMng {
	return &submoduleAuthMng{km: km}
}

// prepare kiểm tra input và tạo các cột xác thực để lưu; nếu message khác nil thì dữ liệu bị từ chối.
// stored là hàng hiện tại khi cập nhật (nil khi tạo mới). Chỉ lưu secret nếu bật SavePassword (nếu không,
// xóa mọi secret đã lưu); secret để trống trong input sẽ giữ giá trị cũ nếu authType không đổi.
// allowMissingCertKey (chỉ dùng khi nhập) chấp nhận hồ sơ minioCert không có file chứng chỉ hoặc khóa.
func (m *submoduleAuthMng) prepare(
	input models.ConnectionProfileInput,
	stored *sqlc.ConnectionProfile,
	allowMissingCertKey bool,
) (authColumns, *models.Message) {
	if input.AuthType == "" {
		input.AuthType = cnst.AuthStatic
	}
	if !cnst.IsAuthTypeValid(input.Provider, input.AuthType) {
		msg := models.NewParamsMessage(cnst.MessageTypeError, cnst.Profile, PFE008, "", map[string]any{
			"authType": input.AuthType,
			"provider": input.Provider,
		})
		return authColumns{}, &msg
	}

	if input.AuthType == cnst.AuthAnonymous {
			// Client ẩn danh không thể liệt kê bucket nên người dùng phải nhập bucket cần duyệt.
		input.AuthConfig.Buckets = input.AuthConfig.BucketNames()
		if len(input.AuthConfig.Buckets) == 0 {
			return authColumns{}, errMessage(PFE009, errors.New("anonymous access needs at least one bucket"))
		}
	}

	if err := validateAuthConfig(input, allowMissingCertKey); err != nil {
		return authColumns{}, errMessage(PFE009, err)
	}
	if input.Provider != cnst.ProviderMinio {
		input.AuthConfig.CaFile = "" // the extra CA only applies to MinIO connections
	}

	config, err := json.Marshal(input.AuthConfig)
	if err != nil {
		return authColumns{}, errMessage(PFE009, err)
	}
	cols := authColumns{
		authType:    input.AuthType,
		accessKey:   sql.NullString{String: input.AccessKey, Valid: input.AccessKey != "" && usesKeys(input)},
		config:      sql.NullString{String: string(config), Valid: true},
		autoConnect: input.AutoConnect && cnst.IsAutoConnectAllowed(input.AuthType, input.AuthConfig.MfaSerial),
	}
	if !input.SavePassword {
		return cols, nil
	}

	secrets := plainSecrets{secretKey: input.SecretKey, AuthSecret: input.AuthSecret}
	if stored != nil && stored.AuthType == input.AuthType {
		old, err := m.open(*stored)
		if err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
		secrets = secrets.fillEmpty(old)
	}
	secrets = keepNeeded(secrets, input)

	if cols.secretKey, err = m.seal(secrets.secretKey); err != nil {
		return authColumns{}, errMessage(PFE002, err)
	}
	if secrets.AuthSecret != (models.AuthSecret{}) {
		raw, err := json.Marshal(secrets.AuthSecret)
		if err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
		if cols.secret, err = m.seal(string(raw)); err != nil {
			return authColumns{}, errMessage(PFE002, err)
		}
	}
	return cols, nil
}

// validateAuthConfig kiểm tra các trường bắt buộc để kết nối bằng OIDC hoặc chứng chỉ.
// Khi bật allowMissingCertKey, hồ sơ minioCert có thể thiếu file chứng chỉ và khóa.
func validateAuthConfig(input models.ConnectionProfileInput, allowMissingCertKey bool) error {
	cfg := input.AuthConfig
	switch input.AuthType {
	case cnst.AuthMinioOidc:
		if cfg.ClientId == "" || cfg.IssuerUrl == "" {
			return errors.New("OIDC needs a client id and an issuer URL")
		}
		if !utils.IsSecureUrl(cfg.IssuerUrl) {
			return errors.New("OIDC issuer URL must be https (http only for localhost)")
		}
		if cfg.CallbackPort != 0 && (cfg.CallbackPort < minCallbackPort || cfg.CallbackPort > maxCallbackPort) {
			return fmt.Errorf("OIDC callback port must be between %d and %d", minCallbackPort, maxCallbackPort)
		}
	case cnst.AuthMinioCert:
		if !allowMissingCertKey && (cfg.CertFile == "" || cfg.KeyFile == "") {
			return errors.New("certificate authentication needs a certificate file and a key file")
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(input.Endpoint)), "http://") {
			return errors.New("certificate authentication needs an https endpoint")
		}
	}
	return nil
}

// seal mã hóa v; nếu v rỗng thì lưu thành NULL.
func (m *submoduleAuthMng) seal(v string) (sql.NullString, error) {
	if v == "" {
		return sql.NullString{}, nil
	}
	cipher, err := m.km.Encrypt(v)
	return sql.NullString{String: cipher, Valid: err == nil}, err
}

// open giải mã các secret đã lưu trong p.
func (m *submoduleAuthMng) open(p sqlc.ConnectionProfile) (plainSecrets, error) {
	var secrets plainSecrets
	var err error

	if p.SecretKey.String != "" {
		if secrets.secretKey, err = m.km.Decrypt(p.SecretKey.String); err != nil {
			return plainSecrets{}, err
		}
	}
	if p.AuthSecret.String != "" {
		raw, err := m.km.Decrypt(p.AuthSecret.String)
		if err != nil {
			return plainSecrets{}, err
		}
		if err := json.Unmarshal([]byte(raw), &secrets.AuthSecret); err != nil {
			return plainSecrets{}, utils.ErrInvalidCiphertext
		}
	}
	return secrets, nil
}

// parseAuthConfig đọc JSON auth_config của p; cột rỗng tạo cấu hình rỗng.
func parseAuthConfig(p sqlc.ConnectionProfile) (models.AuthConfig, error) {
	var cfg models.AuthConfig
	if p.AuthConfig.String == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(p.AuthConfig.String), &cfg); err != nil {
		return models.AuthConfig{}, fmt.Errorf("%w: %w", errInvalidAuthConfig, err)
	}
	return cfg, nil
}

// errMessage tạo thông báo lỗi theo code, dùng err làm nội dung chi tiết.
func errMessage(code string, err error) *models.Message {
	msg := models.NewMessage(cnst.MessageTypeError, cnst.Profile, code, err.Error())
	return &msg
}

// usesKeys cho biết phương thức có ký bằng access key và secret key hay không: static, MinIO AssumeRole và
// AWS AssumeRole có nguồn không phải hồ sơ CLI.
func usesKeys(input models.ConnectionProfileInput) bool {
	switch input.AuthType {
	case "", cnst.AuthStatic, cnst.AuthMinioAssumeRole:
		return true
	case cnst.AuthAssumeRole:
		return input.AuthConfig.SourceType != "profile"
	}
	return false
}

// keepNeeded xóa các secret mà phương thức không dùng để khi đổi phương thức không giữ lại secret cũ.
func keepNeeded(s plainSecrets, input models.ConnectionProfileInput) plainSecrets {
	keys := usesKeys(input)
	if !keys {
		s.secretKey = ""
		s.SessionToken = ""
	}
	if input.AuthType == cnst.AuthMinioAssumeRole {
		s.SessionToken = "" // the session token only goes with static keys and AssumeRole source keys
	}
	if input.AuthType != cnst.AuthMinioLdap {
		s.LdapPassword = ""
	}
	if input.AuthType != cnst.AuthMinioCert || !input.AuthConfig.KeyEncrypted {
		s.KeyPassword = ""
	}
	return s
}
