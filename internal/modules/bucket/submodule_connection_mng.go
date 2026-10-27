package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/models"
	"context"
	"log/slog"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type submoduleConnMng struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleCfgMng *submoduleCfgMng
}

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

func (m *submoduleConnMng) testAction(input models.ConnectionProfileInput) models.Output[models.ConnectOutput] {
	// The app context is canceled only when the app shuts down, so always bound the I/O with a timeout.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(input)
	status, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status.ThrowError()
	}

	// A test connection is never kept.
	c.Transport.CloseIdleConnections()
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S001, "", map[string]any{
			"name": input.Name,
		}),
	)
	return status
}

func (m *submoduleConnMng) connectAction(
	input models.ConnectionProfileInput,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	// The app context is canceled only when the app shuts down, so always bound the I/O with a timeout.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(input)
	status, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status.ThrowError()
	}

	// An existing profile keeps its id; a new connection creates a profile and uses its id.
	connectionId := input.Id
	if !isExistingProfile {
		createResult := m.profile.CreateProfile(input)
		if !createResult.Result {
			c.Transport.CloseIdleConnections()
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

// replaceConn stores the connection and closes the idle transport of any previous one with the same id.
func (m *submoduleConnMng) replaceConn(id string, c *global.S3Conn) {
	if old := m.global.ReplaceConn(id, c); old != nil && old.Transport != nil {
		old.Transport.CloseIdleConnections()
	}
}

func (m *submoduleConnMng) profileConnectAction(connectionId string) models.Output[models.ConnectOutput] {
	output := models.NewOutput[models.ConnectOutput]()
	profile := m.profile.GetConnectionProfileById(connectionId)

	if !profile.Result {
		return output.ThrowError(profile.MessageList...)
	}

	connectInput := models.ConnectionProfileInput{
		Name:      profile.Body.Name,
		Endpoint:  profile.Body.Endpoint,
		AccessKey: profile.Body.AccessKey,
		SecretKey: profile.Body.SecretKey,
		Region:    profile.Body.Region,
		PathStyle: profile.Body.PathStyle,
		Provider:  profile.Body.Provider,
	}

	// The app context is canceled only when the app shuts down, so always bound the I/O with a timeout.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(connectInput)
	status, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		output.Body.IsConnected = false
		return output.ThrowError(status.MessageList...)
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

func (m *submoduleConnMng) disconnectAction(connectionId string) models.Output[bool] {
	output := models.NewOutput[bool]()

	if conn, ok := m.global.RemoveConn(connectionId); ok {
		conn.Transport.CloseIdleConnections()
		output.Body = true
		output.AddMessage(
			models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S003, "", map[string]any{
				"name": conn.ProfileName,
			}),
		)
		return output
	} else {
		output.AddMessage(
			models.NewMessage(cnst.MessageTypeError, cnst.Bucket, S3E005, "Connection not found"),
		)
	}

	return output
}
