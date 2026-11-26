package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"cmp"
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// connectTimeout giới hạn thời gian thăm dò khi kết nối hoặc kiểm tra kết nối.
	connectTimeout = 30 * time.Second

	// credentialWarnWindow là khoảng thời gian trước lúc hết hạn để gửi EventCredentialExpiring.
	credentialWarnWindow = 5 * time.Minute
)

// submoduleConnMng kết nối, kiểm tra và ngắt kết nối S3, đồng thời lưu các kết nối trong kho toàn cục.
type submoduleConnMng struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleCfgMng *submoduleCfgMng
}

// newSubmoduleConnMng kết nối submodule connection với ứng dụng, kho dữ liệu, hồ sơ và bộ tạo client.
func newSubmoduleConnMng(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	profile *profile.Module,
	submoduleCfgMng *submoduleCfgMng,
) *submoduleConnMng {
	return &submoduleConnMng{
		logger:  logger.With("submodules", "connection_action"),
		app:     app,
		global:  global,
		profile: profile,

		submoduleCfgMng: submoduleCfgMng,
	}
}

// probe tạo client cho input rồi kiểm tra bằng ListBuckets (HeadBucket nếu là kết nối ẩn danh). Bên gọi sở hữu c:
// khi thành công phải giữ lại (replaceConn) hoặc gọi Close; khi thất bại, probe đã đóng kết nối.
// ctx là context của lời gọi để frontend có thể hủy thao tác kết nối chậm.
func (m *submoduleConnMng) probe(
	ctx context.Context,
	input models.ConnectionProfileInput,
) (*global.S3Conn, models.Output[models.ConnectOutput], error) {
	// Context của lời gọi chỉ kết thúc khi frontend hủy, vì vậy luôn giới hạn I/O bằng timeout.
	ctx, cancel := withCallContext(ctx, m.app.Context(), connectTimeout)
	defer cancel()

	c, err := m.submoduleCfgMng.buildClient(ctx, input)
	if err != nil {
		status := models.NewOutput[models.ConnectOutput]()
		_ = describeConnectStatus(err, input.Name, &status) // fills the message; err already fails the connect
		m.logger.Error("build credentials failed", "authType", input.AuthType, "error", err.Error())
		return nil, status, err
	}

	status, err := m.submoduleCfgMng.probe(ctx, c)
	return c, status, err
}

// connectFailed kết thúc lần kết nối thất bại bằng các thông báo trong status. Nếu frontend đã hủy lời gọi (ctx),
// không còn bên nào chờ kết quả nên hàm trả lỗi mà không gửi thông báo.
func connectFailed(
	ctx context.Context,
	status models.Output[models.ConnectOutput],
) models.Output[models.ConnectOutput] {
	status.Body.IsConnected = false
	if isCallCanceled(ctx) {
		status.MessageList = nil
	}
	return status.ThrowError()
}

// testAction kiểm tra thông tin xác thực và endpoint trong input (S3S001) nhưng không giữ kết nối.
func (m *submoduleConnMng) testAction(
	ctx context.Context,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	c, status, err := m.probe(ctx, input)

	if err != nil {
		return connectFailed(ctx, status)
	}

	// Không bao giờ giữ lại kết nối dùng để kiểm tra.
	c.Close()
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S001, "", map[string]any{
			"name": input.Name,
		}),
	)
	return status
}

// connectAction kết nối bằng input và giữ kết nối; xem Module.Connect.
func (m *submoduleConnMng) connectAction(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	c, status, err := m.probe(ctx, input)

	if err != nil {
		return connectFailed(ctx, status)
	}

	// Hồ sơ có sẵn giữ nguyên id; kết nối mới tạo hồ sơ rồi dùng id của hồ sơ đó.
	connectionId := input.Id
	if !isExistingProfile {
		createResult := m.profile.CreateProfile(input)
		if !createResult.Result {
			c.Close()
			status.Body.IsConnected = false
			return status.ThrowError(createResult.MessageList...)
		}
		status.AddMessage(createResult.MessageList...)
		connectionId = createResult.Body.ID
		m.app.Event.Emit(EventConnectSaveProfile, createResult.Body)
	}

	m.replaceConn(connectionId, c)
	m.submoduleCfgMng.oidc.remove(input.OidcSessionId)
	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": input.Name,
		}),
	)

	return status
}

// replaceConn lưu kết nối, đóng kết nối trước đó có cùng id và bắt đầu theo dõi thời hạn của kết nối mới.
func (m *submoduleConnMng) replaceConn(id string, c *global.S3Conn) {
	if old := m.global.ReplaceConn(id, c); old != nil {
		old.Close()
	}
	m.watchExpiry(id, c)
}

// watchExpiry gửi EventCredentialExpiring một lần, trước credentialWarnWindow khi thông tin xác thực không thể tự
// gia hạn sắp hết hạn. Bộ hẹn giờ thuộc về c: Close (ngắt kết nối hoặc thay thế) sẽ dừng bộ hẹn giờ này.
// Thời hạn được xác định sau yêu cầu đầu tiên do probe gửi đi.
func (m *submoduleConnMng) watchExpiry(id string, c *global.S3Conn) {
	if c.CredInfo.Refreshable || c.CredInfo.Expiry == nil {
		return
	}
	if expiresAt, ok := c.CredInfo.Expiry(); ok {
		m.armExpiry(id, c, expiresAt)
	}
}

// armExpiry khởi động bộ hẹn giờ đến expiresAt. Khi hết giờ, hàm đọc lại thời hạn: nếu SDK đã gia hạn token SSO
// thì đặt lại bộ hẹn giờ thay vì gửi cảnh báo.
func (m *submoduleConnMng) armExpiry(id string, c *global.S3Conn, expiresAt time.Time) {
	timer := time.AfterFunc(max(time.Until(expiresAt)-credentialWarnWindow, 0), func() {
		// Bỏ qua nếu kết nối đã bị gỡ hoặc thay thế trong lúc chờ.
		if current, ok := m.global.GetConnContainer(id); !ok || current != c {
			return
		}
		at, ok := c.CredInfo.Expiry()
		if !ok {
			return
		}
		if time.Until(at) > credentialWarnWindow {
			m.armExpiry(id, c, at)
			return
		}
		m.app.Event.Emit(EventCredentialExpiring, models.CredentialExpiringOutput{
			ConnectionId: id,
			ProfileName:  c.ProfileName,
			AuthType:     c.AuthType,
			AwsProfile:   c.AwsProfile,
			ExpiresAt:    at,
		})
	})
	c.SetExpiryTimer(timer)
}

// profileConnectAction kết nối bằng hồ sơ đã lưu rồi giữ kết nối (S3S002).
func (m *submoduleConnMng) profileConnectAction(
	ctx context.Context,
	connectionId string,
) models.Output[models.ConnectOutput] {
	output := models.NewOutput[models.ConnectOutput]()
	// Secret đã lưu chỉ được giải mã tại đây; frontend không bao giờ nhận được chúng.
	profile := m.profile.GetConnectInput(connectionId)

	if !profile.Result {
		return output.ThrowError(profile.MessageList...)
	}

	c, status, err := m.probe(ctx, profile.Body)

	if err != nil {
		return connectFailed(ctx, status)
	}

	m.replaceConn(connectionId, c)

	output.Body.ConnectionId = connectionId
	output.Body.IsConnected = true
	output.AddMessage(status.MessageList...)
	output.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": profile.Body.Name,
		}),
	)

	return output
}

// reauthAction gia hạn thông tin xác thực của kết nối đang hoạt động. Hồ sơ đã lưu cung cấp cấu hình và secret;
// input chỉ bổ sung những giá trị không được lưu: mã MFA mới và các secret người dùng nhập lại. Client S3 được
// giữ nguyên (SwapCreds) nên các lượt truyền đang chạy vẫn tiếp tục.
func (m *submoduleConnMng) reauthAction(
	ctx context.Context,
	connectionId string,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	output := models.NewOutput[models.ConnectOutput]()
	ctx, cancel := withCallContext(ctx, m.app.Context(), connectTimeout)
	defer cancel()

	conn, ok := m.global.GetConnContainer(connectionId)
	if !ok {
		return output.ThrowError(notConnectedMessage(input.Name))
	}
	if conn.Creds == nil {
		return output.ThrowError(
			models.NewMessage(
				cnst.MessageTypeError,
				cnst.Bucket,
				S3E004,
				"this connection has no credentials to renew",
			),
		)
	}

	saved := m.profile.GetConnectInput(connectionId)
	if !saved.Result {
		return output.ThrowError(saved.MessageList...)
	}
	fresh := withTypedSecrets(saved.Body, input)
	if secret := missingSecret(fresh); secret != "" {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E046, "", map[string]any{
				"name":   fresh.Name,
				"secret": secret,
			}),
		)
	}

	creds, err := buildCredentials(ctx, fresh, &http.Client{Transport: conn.Transport}, m.submoduleCfgMng.oidc)
	if err != nil {
		if isCallCanceled(ctx) {
			return output.ThrowError()
		}
		_ = describeConnectStatus(err, fresh.Name, &output) // fills the message; err already fails the call
		m.logger.Error("renew credentials failed", "authType", fresh.AuthType, "error", err.Error())
		return output.ThrowError()
	}

	conn.Creds.Store(creds.AWS)
	conn.Access.Reset() // the new credentials may have other permissions
	m.submoduleCfgMng.oidc.remove(fresh.OidcSessionId)
	// buildCredentials đã cache thông tin xác thực mới; tại đây chỉ đọc thời hạn của chúng vào conn.Creds.
	_, _ = conn.Creds.Retrieve(ctx)
	m.watchExpiry(connectionId, conn)

	output.Body.ConnectionId = connectionId
	output.Body.IsConnected = true
	output.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": fresh.Name,
		}),
	)
	return output
}

// missingSecret trả về secret đầu tiên cần để phương thức gia hạn thông tin xác thực nhưng đang để trống, hoặc "".
// Secret chỉ được giữ khi hồ sơ lưu chúng, nên người dùng có thể phải nhập lại.
func missingSecret(in models.ConnectionProfileInput) string {
	switch in.AuthType {
	case cnst.AuthAssumeRole:
		if in.AuthConfig.MfaSerial != "" && in.MfaCode == "" {
			return "mfaCode"
		}
		if in.AuthConfig.SourceType != "profile" && in.SecretKey == "" {
			return "secretKey"
		}
	case cnst.AuthMinioAssumeRole:
		if in.SecretKey == "" {
			return "secretKey"
		}
	case cnst.AuthMinioLdap:
		if in.AuthSecret.LdapPassword == "" {
			return "ldapPassword"
		}
	case cnst.AuthMinioOidc:
		if in.OidcSessionId == "" {
			return "oidcSession"
		}
	case cnst.AuthMinioCert:
		if in.AuthConfig.KeyEncrypted && in.AuthSecret.KeyPassword == "" {
			return "keyPassword"
		}
	}
	return ""
}

// withTypedSecrets trả về saved cùng mã dùng một lần từ typed và mọi secret người dùng đã nhập lại.
func withTypedSecrets(saved, typed models.ConnectionProfileInput) models.ConnectionProfileInput {
	saved.MfaCode = typed.MfaCode
	saved.OidcSessionId = typed.OidcSessionId
	saved.SecretKey = cmp.Or(typed.SecretKey, saved.SecretKey)
	saved.AuthSecret.SessionToken = cmp.Or(typed.AuthSecret.SessionToken, saved.AuthSecret.SessionToken)
	saved.AuthSecret.LdapPassword = cmp.Or(typed.AuthSecret.LdapPassword, saved.AuthSecret.LdapPassword)
	saved.AuthSecret.KeyPassword = cmp.Or(typed.AuthSecret.KeyPassword, saved.AuthSecret.KeyPassword)
	return saved
}

// disconnectAction gỡ kết nối khỏi kho và đóng các kết nối HTTP đang nhàn rỗi.
func (m *submoduleConnMng) disconnectAction(connectionId string) models.Output[bool] {
	output := models.NewOutput[bool]()

	if conn, ok := m.global.RemoveConn(connectionId); ok {
		conn.Close()
		output.Body = true
		output.AddMessage(
			models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S003, "", map[string]any{
				"name": conn.ProfileName,
			}),
		)
		return output
	}

	output.AddMessage(
		models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E005, "Connection not found"),
	)
	return output
}
