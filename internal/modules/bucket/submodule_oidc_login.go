package bucket

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models"
	"cmp"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/oauth2"
)

const (
	// oidcLoginTimeout là thời gian tối đa người dùng được phép đăng nhập tại nhà cung cấp danh tính.
	oidcLoginTimeout = 5 * time.Minute
	// oidcSessionTTL là thời gian tối đa có thể dùng lại phiên đã đăng nhập (cũng bị giới hạn bởi hạn của id_token).
	oidcSessionTTL = 10 * time.Minute
	// oidcRequestTimeout giới hạn thời gian của mỗi yêu cầu đến nhà cung cấp danh tính.
	oidcRequestTimeout = 30 * time.Second
	// oidcDefaultPort là cổng callback mặc định nếu hồ sơ chưa chỉ định.
	oidcDefaultPort = 48765
	// oidcMaxSessions giới hạn số phiên được giữ trong bộ nhớ.
	oidcMaxSessions = 8
	// oidcMaxBody giới hạn kích thước tài liệu discovery.
	oidcMaxBody = 1 << 20
)

// oidcCallbackPage được hiển thị trong tab trình duyệt sau khi chuyển hướng; trang này không chứa dữ liệu từ yêu cầu.
const oidcCallbackPage = `<!doctype html><meta charset="utf-8"><title>S3Browser</title>` +
	`<body style="font-family:sans-serif;text-align:center;margin-top:20vh">` +
	`<h2>Sign-in finished</h2><p>You can close this tab and return to S3Browser.</p></body>`

// errOidcLoginRequired cho biết phiên đăng nhập đã được dùng và cần đăng nhập lại. Lỗi này được báo bằng S3E030,
// giống token hết hạn.
var errOidcLoginRequired = errors.New("OIDC sign-in is required")

// oidcSession lưu token của một lần đăng nhập. Token chỉ tồn tại trong bộ nhớ và không bao giờ được gửi đến frontend.
type oidcSession struct {
	idToken     string
	accessToken string
	expiresAt   time.Time
}

// callbackResult chứa dữ liệu chuyển hướng gửi về: authorization code hoặc lý do thất bại.
type callbackResult struct {
	code string
	err  error
}

// submoduleOidcMng đăng nhập người dùng bằng OpenID Connect (authorization code + PKCE, public client) và giữ phiên
// cho đến khi một thao tác kết nối sử dụng phiên đó.
type submoduleOidcMng struct {
	logger *slog.Logger
	app    *application.App

	mu       sync.Mutex
	sessions map[string]oidcSession
}

// newSubmoduleOidcMng tạo submodule OIDC với kho phiên rỗng.
func newSubmoduleOidcMng(app *application.App, logger *slog.Logger) *submoduleOidcMng {
	return &submoduleOidcMng{
		logger:   logger.With("submodules", "oidc_login"),
		app:      app,
		sessions: map[string]oidcSession{},
	}
}

// login thực hiện đăng nhập bằng trình duyệt hệ thống rồi lưu phiên. Hàm chờ đến khi người dùng hoàn tất,
// lời gọi bị hủy (dừng im lặng) hoặc oidcLoginTimeout hết hạn (S3E039).
func (m *submoduleOidcMng) login(ctx context.Context, cfg models.AuthConfig) models.Output[models.OidcLoginOutput] {
	output := models.NewOutput[models.OidcLoginOutput]()
	port := cmp.Or(cfg.CallbackPort, oidcDefaultPort)
	if cfg.ClientId == "" || cfg.IssuerUrl == "" || port < 1024 || port > 65535 {
		return output.ThrowError(
			models.NewMessage(cnst.MessageTypeError, cnst.Profile, profile.PFE009, "invalid OIDC settings"),
		)
	}

	ctx, cancel := withCallContext(ctx, m.app.Context(), oidcLoginTimeout)
	defer cancel()

	session, err := m.authorize(ctx, cfg, port)
	if err != nil {
		return m.loginFailed(ctx, output, err)
	}

	id, err := randomToken(16)
	if err != nil {
		return m.loginFailed(ctx, output, err)
	}
	m.put(id, session)

	output.Body = models.OidcLoginOutput{SessionId: id, ExpiresAt: session.expiresAt}
	return output
}

// loginFailed chuyển err thành thông báo đăng nhập thất bại: không gửi gì nếu frontend đã hủy, S3E039 nếu timeout,
// S3E040 nếu cổng đang được sử dụng và S3E041 cho các lỗi khác.
func (m *submoduleOidcMng) loginFailed(
	ctx context.Context,
	output models.Output[models.OidcLoginOutput],
	err error,
) models.Output[models.OidcLoginOutput] {
	if isCallCanceled(ctx) {
		return output.ThrowError()
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E039, ""))
	}

	m.logger.Error("oidc login failed", slog.Any("error", err.Error()))
	var credErr *credError
	if errors.As(err, &credErr) {
		return output.ThrowError(
			models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, credErr.code, credErr.Error(), credErr.params),
		)
	}
	return output.ThrowError(
		models.NewParamsMessage(cnst.MessageTypeError, cnst.Bucket, S3E041, err.Error(), map[string]any{
			"detail": err.Error(),
		}),
	)
}

// authorize thực hiện luồng authorization code: discovery, máy chủ callback cục bộ, trình duyệt, đổi token.
// Máy chủ cục bộ chỉ lắng nghe trên 127.0.0.1 và được tắt trước khi hàm trả về.
func (m *submoduleOidcMng) authorize(ctx context.Context, cfg models.AuthConfig, port int) (oidcSession, error) {
	// Hồ sơ cũ có thể chưa được kiểm tra tính hợp lệ.
	if !utils.IsSecureUrl(cfg.IssuerUrl) {
		return oidcSession{}, errors.New("the issuer URL is not secure: it must be https (http only for localhost)")
	}
	// Nhà cung cấp danh tính được xác thực bằng kho CA của hệ điều hành: CA trong hồ sơ chỉ áp dụng cho MinIO.
	endpoint, err := discoverOidc(ctx, cfg.IssuerUrl)
	if err != nil {
		return oidcSession{}, err
	}

	state, err := randomToken(32)
	if err != nil {
		return oidcSession{}, err
	}
	nonce, err := randomToken(32)
	if err != nil {
		return oidcSession{}, err
	}
	verifier := oauth2.GenerateVerifier()
	oauthCfg := &oauth2.Config{
		ClientID:    cfg.ClientId,
		Endpoint:    endpoint,
		RedirectURL: fmt.Sprintf("http://127.0.0.1:%d/callback", port),
		Scopes:      oidcScopes(cfg.Scope),
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return oidcSession{}, &credError{code: S3E040, params: map[string]any{"port": port}, err: err}
	}
	results := make(chan callbackResult, 1)
	server := &http.Server{Handler: callbackHandler(state, results), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	authURL := oauthCfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("nonce", nonce))
	if err := m.app.Browser.OpenURL(authURL); err != nil {
		return oidcSession{}, fmt.Errorf("open the browser: %w", err)
	}

	var result callbackResult
	select {
	case <-ctx.Done():
		return oidcSession{}, ctx.Err()
	case result = <-results:
	}
	if result.err != nil {
		return oidcSession{}, result.err
	}

	exchangeCtx, cancel := context.WithTimeout(ctx, oidcRequestTimeout)
	defer cancel()
	token, err := oauthCfg.Exchange(exchangeCtx, result.code, oauth2.VerifierOption(verifier))
	if err != nil {
		return oidcSession{}, err
	}
	idToken, _ := token.Extra("id_token").(string)
	return newOidcSession(idToken, token.AccessToken, nonce)
}

// newOidcSession kiểm tra id_token (thời hạn và nonce; MinIO chịu trách nhiệm kiểm tra chữ ký) rồi tạo phiên.
func newOidcSession(idToken, accessToken, nonce string) (oidcSession, error) {
	if idToken == "" {
		return oidcSession{}, errors.New("the identity provider returned no id_token")
	}
	expiresAt, gotNonce, err := idTokenClaims(idToken)
	if err != nil {
		return oidcSession{}, err
	}
	if subtle.ConstantTimeCompare([]byte(gotNonce), []byte(nonce)) != 1 {
		return oidcSession{}, errors.New("id_token nonce does not match")
	}

	limit := time.Now().Add(oidcSessionTTL)
	if expiresAt.IsZero() || expiresAt.After(limit) {
		expiresAt = limit
	}
	if !expiresAt.After(time.Now()) {
		return oidcSession{}, errors.New("id_token has already expired")
	}
	return oidcSession{idToken: idToken, accessToken: accessToken, expiresAt: expiresAt}, nil
}

// idTokenClaims đọc exp và nonce từ payload của JWT mà không xác minh JWT.
func idTokenClaims(idToken string) (expiresAt time.Time, nonce string, err error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return time.Time{}, "", errors.New("id_token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, "", errors.New("id_token payload is not valid")
	}
	var claims struct {
		Exp   int64  `json:"exp"`
		Nonce string `json:"nonce"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return time.Time{}, "", errors.New("id_token payload is not valid")
	}
	if claims.Exp > 0 {
		expiresAt = time.Unix(claims.Exp, 0)
	}
	return expiresAt, claims.Nonce, nil
}

// callbackHandler chỉ xử lý /callback. Yêu cầu có state sai sẽ bị từ chối và bỏ qua để một yêu cầu cục bộ bất kỳ
// không thể kết thúc quá trình đăng nhập.
func callbackHandler(state string, results chan<- callbackResult) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(state)) != 1 {
			http.Error(w, "invalid state", http.StatusBadRequest)
			return
		}

		result := callbackResult{code: query.Get("code")}
		if idpErr := query.Get("error"); idpErr != "" {
			result.err = fmt.Errorf("%s %s", idpErr, query.Get("error_description"))
		} else if result.code == "" {
			result.err = errors.New("the identity provider returned no authorization code")
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, oidcCallbackPage)
		select {
		case results <- result:
		default: // only the first answer counts
		}
	})
	return mux
}

// discoverOidc đọc endpoint xác thực và endpoint token từ tài liệu discovery của issuer.
func discoverOidc(ctx context.Context, issuer string) (oauth2.Endpoint, error) {
	ctx, cancel := context.WithTimeout(ctx, oidcRequestTimeout)
	defer cancel()

	url := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return oauth2.Endpoint{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return oauth2.Endpoint{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return oauth2.Endpoint{}, fmt.Errorf("discovery returned HTTP %d", resp.StatusCode)
	}

	var doc struct {
		AuthorizationEndpoint string `json:"authorization_endpoint"`
		TokenEndpoint         string `json:"token_endpoint"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, oidcMaxBody)).Decode(&doc); err != nil {
		return oauth2.Endpoint{}, fmt.Errorf("discovery document is not valid: %w", err)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" {
		return oauth2.Endpoint{}, errors.New("discovery document has no authorization or token endpoint")
	}
	// Tài liệu đến từ nguồn bên ngoài: trình duyệt mở URL thứ nhất và authorization code được đổi tại URL thứ hai.
	if !utils.IsSecureUrl(doc.AuthorizationEndpoint) || !utils.IsSecureUrl(doc.TokenEndpoint) {
		return oauth2.Endpoint{}, errors.New("discovery document has an endpoint that is not secure (needs https)")
	}
	// Public client gửi client id trong phần body và không có secret.
	return oauth2.Endpoint{
		AuthURL:   doc.AuthorizationEndpoint,
		TokenURL:  doc.TokenEndpoint,
		AuthStyle: oauth2.AuthStyleInParams,
	}, nil
}

// oidcScopes trả về các scope được yêu cầu, luôn có openid (nếu thiếu sẽ không có id_token).
func oidcScopes(scope string) []string {
	scopes := strings.Fields(scope)
	if !slices.Contains(scopes, "openid") {
		scopes = append([]string{"openid"}, scopes...)
	}
	return scopes
}

// randomToken trả về n byte ngẫu nhiên được mã hóa base64 an toàn cho URL.
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// put lưu phiên dưới id, xóa các phiên hết hạn và, nếu vượt oidcMaxSessions, xóa phiên cũ nhất.
func (m *submoduleOidcMng) put(id string, session oidcSession) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for key, s := range m.sessions {
		if !s.expiresAt.After(now) {
			delete(m.sessions, key)
		}
	}
	for len(m.sessions) >= oidcMaxSessions {
		oldest := ""
		for key, s := range m.sessions {
			if oldest == "" || s.expiresAt.Before(m.sessions[oldest].expiresAt) {
				oldest = key
			}
		}
		delete(m.sessions, oldest)
	}
	m.sessions[id] = session
}

// session trả về id của phiên chưa hết hạn; phiên hết hạn sẽ bị xóa.
func (m *submoduleOidcMng) session(id string) (oidcSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[id]
	if ok && !s.expiresAt.After(time.Now()) {
		delete(m.sessions, id)
		ok = false
	}
	return s, ok
}

// remove xóa phiên mang id đã cho; gọi hàm sau khi thao tác kết nối sử dụng phiên.
func (m *submoduleOidcMng) remove(id string) {
	if id == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
}

// clear xóa mọi phiên; gọi hàm khi ứng dụng tắt.
func (m *submoduleOidcMng) clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	clear(m.sessions)
}
