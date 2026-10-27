package bucket

import (
	"S3Browser/internal/modules/global"
	"S3Browser/internal/modules/profile"
	"S3Browser/models"
	"context"
	"database/sql"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Message codes returned to the frontend by the bucket module.
// Naming convention: S3S = success, S3E = error, S3W = warning.
var (
	// Test connection profile {name} to S3 success.
	S3S001 = "S3S001"

	// Profile: {name} is connected.
	S3S002 = "S3S002"

	// Profile: {name} disconnect success.
	S3S003 = "S3S003"

	// Download file {object} success, destination {dest}
	S3S004 = "S3S004"

	// Delete file {object} success.
	S3S005 = "S3S005"

	// Upload file {name} success, key {key}.
	S3S006 = "S3S006"

	// Deleted {count} object(s) under folder {prefix}.
	S3S007 = "S3S007"

	// Access key or secret key is not valid for this endpoint.
	S3E001 = "S3E001"

	// The endpoint rejected.
	S3E002 = "S3E002"

	// Timed out reaching the endpoint, check the address and whether the server is running.
	S3E003 = "S3E003"

	// Error while connect to S3 bucket.
	S3E004 = "S3E004"

	// Error while disconnect S3 bucket.
	S3E005 = "S3E005"

	// Profile: {name} is not connected.
	S3E006 = "S3E006"

	// Get list bucket error, profile: {name}.
	S3E007 = "S3E007"

	// Get list object error, profile: {name}, bucket: {bucket}.
	S3E008 = "S3E008"

	// Destination {path} not exists.
	S3E009 = "S3E009"

	// Create download history of {object} error.
	S3E010 = "S3E010"

	// Get download history error.
	S3E011 = "S3E011"

	// Download object: {object} error.
	S3E012 = "S3E012"

	// Delete object: {object} error.
	S3E013 = "S3E013"

	// File {name} not exist.
	S3E014 = "S3E014"

	// File {name} can't access.
	S3E015 = "S3E015"

	// File {name} can't open.
	S3E016 = "S3E016"

	// Upload file {name} error.
	S3E017 = "S3E017"

	// Folder {folder} has more than {max} files to upload.
	S3E018 = "S3E018"

	// Invalid upload path for file {name}.
	S3E019 = "S3E019"

	// Invalid folder {prefix}, it can't be deleted.
	S3E020 = "S3E020"

	// Delete folder {prefix} error: {failed} object(s) failed, {deleted} deleted.
	S3E021 = "S3E021"

	// Folder {folder} has more than {max} files over {size} GiB to upload.
	S3E022 = "S3E022"

	// Upload at most {max} files at a time.
	S3E023 = "S3E023"

	// Get object {key} detail error, profile: {name}, bucket: {bucket}.
	S3E024 = "S3E024"

	// Invalid object key {key}.
	S3E025 = "S3E025"

	// Access bucket is limited.
	S3W001 = "S3W001"

	// Download object: {object} is canceled.
	S3W002 = "S3W002"

	// Update download history failed: {object} please reload!
	S3W003 = "S3W003"

	// Upload file {name} is canceled.
	S3W004 = "S3W004"

	// Another upload is running, please wait until it finishes.
	S3W005 = "S3W005"

	// Skipped {count} item(s) that can't be uploaded (unreadable, symbolic link or not a regular file).
	S3W006 = "S3W006"

	// The drop holds more than {max} files, the files after the first {max} are ignored.
	S3W007 = "S3W007"
)

type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	submoduleConnMng            *submoduleConnMng
	submoduleBucketMng          *submoduleBucketMng
	submoduleObjMng             *submoduleObjMng
	submoduleDownloaderMng      *submoduleDownloaderMng
	submoduleUploaderMng        *submoduleUploaderMng
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
	submoduleUploaderMng := newSubmoduleUploaderMng(app, logger, global)

	return &Module{
		logger:  logger.With("modules", "bucket"),
		app:     app,
		global:  global,
		profile: profileModule,

		submoduleDownloadHistoryMng: submoduleDownloadHistoryMng,
		submoduleConnMng:            submoduleConnMng,
		submoduleBucketMng:          submoduleBucketMng,
		submoduleObjMng:             submoduleObjMng,
		submoduleDownloaderMng:      submoduleDownloaderMng,
		submoduleUploaderMng:        submoduleUploaderMng,
	}
}

// Connect opens a connection to an S3-compatible endpoint using the given input.
// If isExistingProfile is true, input is an already saved profile (the user typed the
// secret key themselves): it connects with input.Id and creates no profile.
// If false, input is a new connection: a profile is created from it, and if that fails
// the connection is dropped.
// On success, the connection is kept for subsequent bucket/object operations.
func (m *Module) Connect(input models.ConnectionProfileInput, isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.connectAction(input, isExistingProfile)
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
func (m *Module) GetListBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	return m.submoduleBucketMng.listBucket(ctx, input)
}

// GetListObject returns the objects in the bucket specified in input,
// using an already-established connection.
func (m *Module) GetListObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	return m.submoduleObjMng.listObject(ctx, input)
}

// GetObjectDetail returns the content type, storage class and user metadata of the object
// input.Key (HeadObject). A folder key or an empty key is rejected. ctx is the call context.
func (m *Module) GetObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	return m.submoduleObjMng.getObjectDetail(ctx, input)
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

// CancelUploadOne cancels the running upload with the given ID.
// Unknown or already finished IDs are ignored.
func (m *Module) CancelUploadOne(id string) models.Output[any] {
	return m.submoduleUploaderMng.cancelUploadOne(id)
}

// CancelAllUploads cancels every running upload.
func (m *Module) CancelAllUploads() models.Output[any] {
	return m.submoduleUploaderMng.cancelAllUploads()
}

func (m *Module) DeleteObject(ctx context.Context, input models.DeleteObjInput) models.Output[any] {
	return m.submoduleObjMng.deleteObject(ctx, input)
}

// DeletePrefix deletes every object under input.Prefix (the folder, its sub folders
// and the folder marker). Only current versions are deleted. An empty prefix or "/"
// is rejected so a whole bucket can't be deleted. ctx is the call context.
func (m *Module) DeletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	return m.submoduleObjMng.deletePrefix(ctx, input)
}

func (m *Module) GetDownloadHistory(input models.DownloadHistoryInput) models.Output[models.DownloadHistoryOutput] {
	return m.submoduleDownloadHistoryMng.getDownloadHistory(input)
}

func (m *Module) OpenDownloadDest(fileName, path string) models.Output[any] {
	return m.submoduleDownloadHistoryMng.openDownloadDest(fileName, path)
}

func (m *Module) UploadObject(input models.UploadObjInput) models.Output[any] {
	return m.submoduleUploaderMng.uploadObject(input)
}

// HandleFilesDropped is the window's WindowFilesDropped listener. It forwards the
// dropped files to the frontend tab they were dropped on.
func (m *Module) HandleFilesDropped(event *application.WindowEvent) {
	m.submoduleUploaderMng.handleFilesDropped(event)
}
