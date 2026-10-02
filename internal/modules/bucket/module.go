package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Message codes returned to the frontend by the bucket module.
// Naming convention: S3S = success, S3E = error, S3W = warning.
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

	// Get list object error, profile: {name}, bucket: {bucket}
	S3E008 = "S3E008"

	// Destination {path} not exists
	S3E009 = "S3E009"

	// Access bucket is limited
	S3W001 = "S3W001"

	// Download object: {object} is canceled
	S3W002 = "S3W002"
)

type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleCfgMng     *submoduleCfgMng
	submoduleConnAction *submoduleConnAction
	submoduleBucketMng  *submoduleBucketMng
	submoduleObjMng     *submoduleObjMng
}

func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	profileModule *profile.Module,
) *Module {
	submoduleCfgMng := newSubmoduleCfgMng(logger)
	submoduleConnAction := newSubmoduleConnAction(app, logger, global, profileModule, submoduleCfgMng)
	submoduleBucketMng := newSubmoduleBucketMng(app, logger, global)
	submoduleObjMng := newSubmoduleObjMng(app, logger, global)

	return &Module{
		logger:  logger.With("modules", "bucket"),
		app:     app,
		global:  global,
		profile: profileModule,

		submoduleCfgMng:     submoduleCfgMng,
		submoduleConnAction: submoduleConnAction,
		submoduleObjMng:     submoduleObjMng,
		submoduleBucketMng:  submoduleBucketMng,
	}
}

// Connect opens a connection to an S3-compatible endpoint using the given input.
// isManualConnect indicates whether the connection was triggered directly by
// the user (true) or by an automatic flow (false).
// On success, the connection is kept for subsequent bucket/object operations.
func (m *Module) Connect(input models.ConnectionProfileInput, isManualConnect bool,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnAction.connectAction(input, isManualConnect)
}

// TestConnection checks whether the given credentials and endpoint are valid
// without keeping the connection open. Useful for validating a profile
// before saving it.
func (m *Module) TestConnection(input models.ConnectionProfileInput) models.Output[models.ConnectOutput] {
	return m.submoduleConnAction.testAction(input)
}

// ConnectByProfile connects using a saved profile identified by connectionId,
// loading its connection settings from the profile module.
func (m *Module) ConnectByProfile(connectionId string) models.Output[models.ConnectOutput] {
	return m.submoduleConnAction.profileConnectAction(connectionId)
}

// Disconnect closes the active connection identified by connectionId
// and removes it from the shared connection store.
// Returns true in if the disconnect succeeded.
func (m *Module) Disconnect(connectionId string) models.Output[bool] {
	return m.submoduleConnAction.disconnectAction(connectionId)
}

// DisconnectAll removes every active connection from the shared store and
// closes their idle HTTP connections. Intended to be called on application
// shutdown to release network resources.
func (m *Module) DisconnectAll() {
	for _, conn := range m.global.RemoveAllConn() {
		conn.Transport.CloseIdleConnections()
	}
}

// GetListBucket returns the buckets accessible from the connection
// specified in input. The connection must already be established.
func (m *Module) GetListBucket(input models.ListBucketInput) models.Output[models.ListBucketOutput] {
	return m.submoduleBucketMng.listBucket(input)
}

// GetListObject returns the objects in the bucket specified in input,
// using an already-established connection.
func (m *Module) GetListObject(input models.ListObjectInput) models.Output[models.ListObjectOutput] {
	return m.submoduleObjMng.listObject(input)
}
