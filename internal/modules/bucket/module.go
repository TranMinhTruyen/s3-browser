package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"database/sql"
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

	// Download file {object} success, destination {dest}
	S3S004 = "S3S004"

	// Access key or secret key is not valid for this endpoint
	S3E001 = "S3E001"

	// The endpoint rejected
	S3E002 = "S3E002"

	// Timed out reaching the endpoint, check the address and whether the server is running
	S3E003 = "S3E003"

	// Error while connect to S3 bucket
	S3E004 = "S3E004"

	// Error while disconnect S3 bucket
	S3E005 = "S3E005"

	// Profile: {name} is not connected
	S3E006 = "S3E006"

	// Get list bucket error, profile: {name}
	S3E007 = "S3E007"

	// Get list object error, profile: {name}, bucket: {bucket}
	S3E008 = "S3E008"

	// Destination {path} not exists
	S3E009 = "S3E009"

	// Create download history of {object} error
	S3E010 = "S3E010"

	// Get download history error
	S3E011 = "S3E011"

	// Download object: {object} error
	S3E012 = "S3E012"

	// Access bucket is limited
	S3W001 = "S3W001"

	// Download object: {object} is canceled
	S3W002 = "S3W002"

	// Update download history failed: {object} please reload!
	S3W003 = "S3W003"
)

type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleConnMng       *submoduleConnMng
	submoduleBucketMng     *submoduleBucketMng
	submoduleObjMng        *submoduleObjMng
	submoduleDownloaderMng *submoduleDownloaderMng
}

func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	profileModule *profile.Module,
) *Module {
	submoduleCfgMng := newSubmoduleCfgMng(logger)
	submoduleDownloadHistoryMng := newSubmoduleDownloadHistoryMng(app, logger, db)
	submoduleConnMng := newSubmoduleConnMng(app, logger, global, profileModule, submoduleCfgMng)
	submoduleBucketMng := newSubmoduleBucketMng(app, logger, global)
	submoduleObjMng := newSubmoduleObjMng(app, logger, global)
	submoduleDownloaderMng := newSubmoduleDownloaderMng(app, logger, global, submoduleDownloadHistoryMng)

	return &Module{
		logger:  logger.With("modules", "bucket"),
		app:     app,
		global:  global,
		profile: profileModule,

		submoduleConnMng:       submoduleConnMng,
		submoduleBucketMng:     submoduleBucketMng,
		submoduleObjMng:        submoduleObjMng,
		submoduleDownloaderMng: submoduleDownloaderMng,
	}
}

// Connect opens a connection to an S3-compatible endpoint using the given input.
// isManualConnect indicates whether the connection was triggered directly by
// the user (true) or by an automatic flow (false).
// On success, the connection is kept for subsequent bucket/object operations.
func (m *Module) Connect(input models.ConnectionProfileInput, isManualConnect bool,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.connectAction(input, isManualConnect)
}

// TestConnection checks whether the given credentials and endpoint are valid
// without keeping the connection open. Useful for validating a profile
// before saving it.
func (m *Module) TestConnection(input models.ConnectionProfileInput) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.testAction(input)
}

// ConnectByProfile connects using a saved profile identified by connectionId,
// loading its connection settings from the profile module.
func (m *Module) ConnectByProfile(connectionId string) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.profileConnectAction(connectionId)
}

// Disconnect closes the active connection identified by connectionId
// and removes it from the shared connection store.
// Returns true in if the disconnect succeeded.
func (m *Module) Disconnect(connectionId string) models.Output[bool] {
	return m.submoduleConnMng.disconnectAction(connectionId)
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

func (m *Module) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return m.submoduleDownloaderMng.downloadObject(input)
}

func (m *Module) CancelDownloadOne(id string) models.Output[any] {
	return m.submoduleDownloaderMng.cancelDownloadOne(id)
}

func (m *Module) CancelAllDownloads() models.Output[any] {
	return m.submoduleDownloaderMng.cancelAllDownloads()
}
