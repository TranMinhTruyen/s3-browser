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
	// connectTimeout bounds the probe of a connect or test call.
	connectTimeout = 30 * time.Second

	// credentialWarnWindow is how long before expiry EventCredentialExpiring is sent.
	credentialWarnWindow = 5 * time.Minute
)

// submoduleConnMng connects, tests and disconnects S3 connections and keeps them in the global store.
type submoduleConnMng struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleCfgMng *submoduleCfgMng
}

// newSubmoduleConnMng wires the connection submodule to the app, store, profiles and client builder.
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

// probe builds a client for input and checks it with ListBuckets (HeadBucket when anonymous). The caller owns c:
// on success it must keep it (replaceConn) or Close it; on failure probe already closed it.
// ctx is the call context, so the frontend can cancel a slow connect.
func (m *submoduleConnMng) probe(
	ctx context.Context,
	input models.ConnectionProfileInput,
) (*global.S3Conn, models.Output[models.ConnectOutput], error) {
	// A call context only ends when the frontend cancels, so always bound the I/O with a timeout.
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

// connectFailed ends a failed connect with the messages in status. When the frontend canceled the call (ctx),
// nobody waits for the result, so it fails without a message.
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

// testAction checks the credentials and endpoint of input (S3S001) without keeping the connection.
func (m *submoduleConnMng) testAction(
	ctx context.Context,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	c, status, err := m.probe(ctx, input)

	if err != nil {
		return connectFailed(ctx, status)
	}

	// A test connection is never kept.
	c.Close()
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S001, "", map[string]any{
			"name": input.Name,
		}),
	)
	return status
}

// connectAction connects with input and keeps the connection; see Module.Connect.
func (m *submoduleConnMng) connectAction(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	c, status, err := m.probe(ctx, input)

	if err != nil {
		return connectFailed(ctx, status)
	}

	// An existing profile keeps its id; a new connection creates a profile and uses its id.
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
	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": input.Name,
		}),
	)

	return status
}

// replaceConn stores the connection, closes any previous one with the same id and starts watching the expiry
// of the new one.
func (m *submoduleConnMng) replaceConn(id string, c *global.S3Conn) {
	if old := m.global.ReplaceConn(id, c); old != nil {
		old.Close()
	}
	m.watchExpiry(id, c)
}

// watchExpiry sends EventCredentialExpiring once, credentialWarnWindow before credentials that can't be
// renewed automatically expire. The timer belongs to c: Close (disconnect or replace) stops it.
// The expiry is known after the first request, which the probe made.
func (m *submoduleConnMng) watchExpiry(id string, c *global.S3Conn) {
	if c.CredInfo.Refreshable || c.CredInfo.Expiry == nil {
		return
	}
	if expiresAt, ok := c.CredInfo.Expiry(); ok {
		m.armExpiry(id, c, expiresAt)
	}
}

// armExpiry starts the timer for expiresAt. When it fires the expiry is read again: an SSO token renewed by the
// SDK moves it, and then the timer is re-armed instead of warning.
func (m *submoduleConnMng) armExpiry(id string, c *global.S3Conn, expiresAt time.Time) {
	timer := time.AfterFunc(max(time.Until(expiresAt)-credentialWarnWindow, 0), func() {
		// Skip if the connection was dropped or replaced meanwhile.
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

// profileConnectAction connects with a saved profile and keeps the connection (S3S002).
func (m *submoduleConnMng) profileConnectAction(
	ctx context.Context,
	connectionId string,
) models.Output[models.ConnectOutput] {
	output := models.NewOutput[models.ConnectOutput]()
	// The saved secrets are decrypted here only; the frontend never sees them.
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

// reauthAction renews the credentials of a live connection. The saved profile gives the settings and secrets;
// input only adds what is not saved: the new MFA code, and secrets the user typed again. The S3 client is
// kept (SwapCreds), so running transfers go on.
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

	creds, err := buildCredentials(ctx, fresh, &http.Client{Transport: conn.Transport})
	if err != nil {
		if isCallCanceled(ctx) {
			return output.ThrowError()
		}
		_ = describeConnectStatus(err, fresh.Name, &output) // fills the message; err already fails the call
		m.logger.Error("renew credentials failed", "authType", fresh.AuthType, "error", err.Error())
		return output.ThrowError()
	}

	conn.Creds.Store(creds.AWS)
	// The new credentials are cached by buildCredentials: this only reads their expiry into conn.Creds.
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

// missingSecret returns the first secret the method needs to renew credentials that is empty, or "".
// Secrets are only kept when the profile saves them, so the user may have to type them again.
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
	}
	return ""
}

// withTypedSecrets returns saved with the one-time codes of typed and any secret the user typed again.
func withTypedSecrets(saved, typed models.ConnectionProfileInput) models.ConnectionProfileInput {
	saved.MfaCode = typed.MfaCode
	saved.OidcSessionId = typed.OidcSessionId
	saved.SecretKey = cmp.Or(typed.SecretKey, saved.SecretKey)
	saved.AuthSecret.SessionToken = cmp.Or(typed.AuthSecret.SessionToken, saved.AuthSecret.SessionToken)
	saved.AuthSecret.LdapPassword = cmp.Or(typed.AuthSecret.LdapPassword, saved.AuthSecret.LdapPassword)
	saved.AuthSecret.KeyPassword = cmp.Or(typed.AuthSecret.KeyPassword, saved.AuthSecret.KeyPassword)
	return saved
}

// disconnectAction removes a connection from the store and closes its idle HTTP connections.
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
