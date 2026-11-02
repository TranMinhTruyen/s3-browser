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
	// oidcLoginTimeout is how long the user has to sign in at the identity provider.
	oidcLoginTimeout = 5 * time.Minute
	// oidcSessionTTL is the longest a signed-in session can be reused (also capped by the id_token expiry).
	oidcSessionTTL = 10 * time.Minute
	// oidcRequestTimeout bounds each request to the identity provider.
	oidcRequestTimeout = 30 * time.Second
	// oidcDefaultPort is the callback port when the profile has none.
	oidcDefaultPort = 48765
	// oidcMaxSessions bounds the sessions kept in memory.
	oidcMaxSessions = 8
	// oidcMaxBody bounds a discovery document.
	oidcMaxBody = 1 << 20
)

// oidcCallbackPage is shown in the browser tab after the redirect; it holds no data from the request.
const oidcCallbackPage = `<!doctype html><meta charset="utf-8"><title>S3Browser</title>` +
	`<body style="font-family:sans-serif;text-align:center;margin-top:20vh">` +
	`<h2>Sign-in finished</h2><p>You can close this tab and return to S3Browser.</p></body>`

// errOidcLoginRequired means the signed-in session was already used and a new sign-in is needed. It is reported
// as S3E030, like an expired token.
var errOidcLoginRequired = errors.New("OIDC sign-in is required")

// oidcSession holds the tokens of one sign-in. They live in memory only and never reach the frontend.
type oidcSession struct {
	idToken     string
	accessToken string
	expiresAt   time.Time
}

// callbackResult is what the redirect delivers: the authorization code, or the reason it failed.
type callbackResult struct {
	code string
	err  error
}

// submoduleOidcMng signs the user in with OpenID Connect (authorization code + PKCE, public client) and keeps
// the resulting session until a connect uses it.
type submoduleOidcMng struct {
	logger *slog.Logger
	app    *application.App

	mu       sync.Mutex
	sessions map[string]oidcSession
}

// newSubmoduleOidcMng creates the OIDC submodule with an empty session store.
func newSubmoduleOidcMng(app *application.App, logger *slog.Logger) *submoduleOidcMng {
	return &submoduleOidcMng{
		logger:   logger.With("submodules", "oidc_login"),
		app:      app,
		sessions: map[string]oidcSession{},
	}
}

// login runs the sign-in in the system browser and stores the session. It blocks until the user finishes,
// the call is canceled (silent failure) or oidcLoginTimeout passes (S3E039).
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

// loginFailed turns err into the message of a failed sign-in: nothing when the frontend canceled, S3E039 on
// timeout, S3E040 for a busy port, S3E041 for anything else.
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

// authorize walks the authorization code flow: discovery, local callback server, browser, token exchange.
// The local server listens on 127.0.0.1 only and is shut down before returning.
func (m *submoduleOidcMng) authorize(ctx context.Context, cfg models.AuthConfig, port int) (oidcSession, error) {
	// Older profiles may not have passed the profile validation.
	if !utils.IsSecureUrl(cfg.IssuerUrl) {
		return oidcSession{}, errors.New("the issuer URL is not secure: it must be https (http only for localhost)")
	}
	// The identity provider is checked against the CA store of the OS: the profile CA only applies to MinIO.
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

// newOidcSession checks the id_token (expiry and nonce, the signature is MinIO's job) and builds the session.
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

// idTokenClaims reads exp and nonce from the payload of a JWT without verifying it.
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

// callbackHandler serves only /callback. A request with a wrong state is rejected and ignored, so a stray local
// request can't end the sign-in.
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

// discoverOidc reads the authorization and token endpoints from the issuer's discovery document.
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
	// The document is remote input: the browser opens the first URL and the code is exchanged at the second.
	if !utils.IsSecureUrl(doc.AuthorizationEndpoint) || !utils.IsSecureUrl(doc.TokenEndpoint) {
		return oauth2.Endpoint{}, errors.New("discovery document has an endpoint that is not secure (needs https)")
	}
	// A public client sends its client id in the body and has no secret.
	return oauth2.Endpoint{
		AuthURL:   doc.AuthorizationEndpoint,
		TokenURL:  doc.TokenEndpoint,
		AuthStyle: oauth2.AuthStyleInParams,
	}, nil
}

// oidcScopes returns the requested scopes, always including openid (without it there is no id_token).
func oidcScopes(scope string) []string {
	scopes := strings.Fields(scope)
	if !slices.Contains(scopes, "openid") {
		scopes = append([]string{"openid"}, scopes...)
	}
	return scopes
}

// randomToken returns n random bytes, URL-safe base64 encoded.
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// put stores a session under id, dropping the expired ones and, past oidcMaxSessions, the oldest.
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

// session returns the unexpired session id; an expired one is dropped.
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

// remove forgets the session id; call it after a connect used it.
func (m *submoduleOidcMng) remove(id string) {
	if id == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
}

// clear forgets every session; call it when the app shuts down.
func (m *submoduleOidcMng) clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	clear(m.sessions)
}
