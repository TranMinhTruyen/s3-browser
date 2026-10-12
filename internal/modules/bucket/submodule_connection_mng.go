package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
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
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(input)
	status, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

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
	isManualConnect bool,
) models.Output[models.ConnectOutput] {
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(input)
	status, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	connectionId := utils.GenerateUUID()

	if isManualConnect == true {
		connectionId = input.Id
	}

	if isManualConnect == false {
		createResult := m.profile.CreateProfile(input)
		status.AddMessage(createResult.MessageList...)
		if createResult.Result {
			connectionId = createResult.Body.ID
			m.app.Event.Emit(EventConnectSaveProfile, createResult.Body)
		}
	}

	m.global.PutConnContainer(connectionId, c)
	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(
		models.NewParamsMessage(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": input.Name,
		}),
	)

	return status
}

func (m *submoduleConnMng) profileConnectAction(connectionId string) models.Output[models.ConnectOutput] {
	output := models.NewOutput[models.ConnectOutput]()
	profile := m.profile.GetConnectionProfileById(connectionId)

	// The profile lookup owns the reason it failed, so pass its messages through
	// instead of letting an empty endpoint fail later as a generic S3 error.
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
	}

	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.submoduleCfgMng.buildClient(connectInput)
	_, err := m.submoduleCfgMng.probe(ctx, c)

	if err != nil {
		output.Body.IsConnected = false
		return output
	}

	m.global.PutConnContainer(connectionId, c)

	output.Body.ConnectionId = connectionId
	output.Body.IsConnected = true
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
