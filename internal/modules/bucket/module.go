package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"context"
	"log/slog"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	// Test connection profile {name} to S3 success
	S3_SUCCES_001 = "S3S001"

	// Profile: {name} is connected
	S3_SUCCES_002 = "S3S002"

	// Profile: {name} disconnect success
	S3_SUCCES_003 = "S3S003"

	// access key or secret key is not valid for this endpoint
	S3_ERROR_001 = "S3E001"

	// the endpoint rejected
	S3_ERROR_002 = "S3E002"

	// timed out reaching the endpoint, check the address and whether the server is running
	S3_ERROR_003 = "S3E003"

	// error while connect to S3 bucket
	S3_ERROR_004 = "S3E004"

	// error while disconnect S3 bucket
	S3_ERROR_005 = "S3E005"

	// Access bucket is limited
	S3_WARN_001 = "S3W001"
)

type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module
}

func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	profileModule *profile.Module,
) *Module {
	return &Module{
		logger:  logger.With("component", "bucket_module"),
		app:     app,
		global:  global,
		profile: profileModule,
	}
}

func (m *Module) TestConnection(input bucket.ConnectionInput) common.Output[bucket.ConnectionOutput] {
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.buildClient(input)
	status, err := m.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	status.Body.IsConnected = true
	status.AddMessage(
		common.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3_SUCCES_001, map[string]any{
			"name": input.Name,
		}),
	)
	return status
}

func (m *Module) Connect(input bucket.ConnectionInput, isNewConnection bool) common.Output[bucket.ConnectionOutput] {
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.buildClient(input)
	status, err := m.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	connectionId := utils.GenerateUUID()
	m.global.PutConnContainer(connectionId, c)

	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(
		common.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3_SUCCES_002, map[string]any{
			"name": input.Name,
		}),
	)

	if isNewConnection {
		if err := m.profile.CreateProfile(connectionId, input); err != nil {
			status.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Profile, err.Error()))
		}
	} else {
		if err := m.profile.UpdateProfile(input); err != nil {
			status.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Profile, err.Error()))
		}
	}

	return status
}

func (m *Module) ConnectByProfile(connectionId string) common.Output[bucket.ConnectionOutput] {
	profile := m.profile.GetConnectionProfileById(connectionId)

	// The profile lookup owns the reason it failed, so pass its messages through
	// instead of letting an empty endpoint fail later as a generic S3 error.
	if profile.Body == nil {
		output := common.Output[bucket.ConnectionOutput]{}
		output.New()
		output.Body = &bucket.ConnectionOutput{}
		if profile.MessageList != nil {
			output.AddMessage(*profile.MessageList...)
		}
		return output
	}

	connectInput := bucket.ConnectionInput{
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

	c := m.buildClient(connectInput)
	status, err := m.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	m.global.PutConnContainer(connectionId, c)

	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(
		common.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3_SUCCES_002, map[string]any{
			"name": profile.Body.Name,
		}),
	)

	return status
}

func (m *Module) Disconnect(connectionId string) common.Output[bool] {
	output := common.Output[bool]{}
	output.New()

	if conn, ok := m.global.RemoveConn(connectionId); ok {
		conn.Transport.CloseIdleConnections()
		output.Body = utils.ToPtr(true)
		output.AddMessage(
			common.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3_SUCCES_003, map[string]any{
				"name": conn.ProfileName,
			}),
		)
		return output
	} else {
		output.AddMessage(common.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3_ERROR_005))
	}

	return output
}

func (m *Module) DisconnectAll() {
	for _, conn := range m.global.RemoveAllConn() {
		conn.Transport.CloseIdleConnections()
	}
}
