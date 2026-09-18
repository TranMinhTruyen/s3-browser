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

var (
	// Test connection profile {name} to S3 success
	S3S001 = "S3S001"

	// Profile: {name} is connected
	S3S002 = "S3S002"

	// Profile: {name} disconnect success
	S3S003 = "S3S003"

	// access key or secret key is not valid for this endpoint
	S3E001 = "S3E001"

	// the endpoint rejected
	S3E002 = "S3E002"

	// timed out reaching the endpoint, check the address and whether the server is running
	S3E003 = "S3E003"

	// error while connect to S3 bucket
	S3E004 = "S3E004"

	// error while disconnect S3 bucket
	S3E005 = "S3E005"

	// Profile: {name} is not connected
	S3E006 = "S3E006"

	// Get list bucket error, profile: {name}
	S3E007 = "S3E007"

	// Access bucket is limited
	S3W001 = "S3W001"
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

func (m *Module) TestConnection(input models.ConnectionInput) models.Output[models.ConnectionOutput] {
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
		models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3S001, "", map[string]any{
			"name": input.Name,
		}),
	)
	return status
}

func (m *Module) Connect(
	input models.ConnectionInput,
	isSaveProfile bool,
	isManualConnect bool,
) models.Output[models.ConnectionOutput] {
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

	if isManualConnect == true {
		connectionId = input.Id
	}

	if isSaveProfile == true && isManualConnect == false {
		createResult := m.profile.CreateProfile(input)
		if createResult.MessageList != nil {
			*status.MessageList = append(*status.MessageList, *createResult.MessageList...)
		}
		if createResult.Body != nil {
			connectionId = createResult.Body.ID
			m.app.Event.Emit(EventConnectSaveProfile, *createResult.Body)
		}
	}

	m.global.PutConnContainer(connectionId, c)
	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.Body.IsTemp = isSaveProfile != true
	status.AddMessage(
		models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": input.Name,
		}),
	)

	return status
}

func (m *Module) ConnectByProfile(connectionId string) models.Output[models.ConnectionOutput] {
	profile := m.profile.GetConnectionProfileById(connectionId)

	// The profile lookup owns the reason it failed, so pass its messages through
	// instead of letting an empty endpoint fail later as a generic S3 error.
	if profile.Body == nil {
		output := models.Output[models.ConnectionOutput]{}
		output.New()
		output.Body = &models.ConnectionOutput{}
		if profile.MessageList != nil {
			output.AddMessage(*profile.MessageList...)
		}
		return output
	}

	connectInput := models.ConnectionInput{
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
		models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3S002, "", map[string]any{
			"name": profile.Body.Name,
		}),
	)

	return status
}

func (m *Module) Disconnect(connectionId string) models.Output[bool] {
	output := models.Output[bool]{}
	output.New()

	if conn, ok := m.global.RemoveConn(connectionId); ok {
		conn.Transport.CloseIdleConnections()
		output.Body = utils.ToPtr(true)
		output.AddMessage(
			models.CreateMessageWithParams(cnst.MessageTypeSuccess, cnst.Bucket, S3S003, "", map[string]any{
				"name": conn.ProfileName,
			}),
		)
		return output
	} else {
		output.AddMessage(
			models.CreateMessage(cnst.MessageTypeError, cnst.Bucket, S3E005, "Connection not found"),
		)
	}

	return output
}

func (m *Module) DisconnectAll() {
	for _, conn := range m.global.RemoveAllConn() {
		conn.Transport.CloseIdleConnections()
	}
}
