// Package bucket is the S3 module: connections, buckets, objects, search, upload and download.
// Module is the public API called by the handlers; the work is done by the submodule_*.go files.
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
	// ---- Success ----

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

	// ---- Error ----

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

	// Search object error, profile: {name}, bucket: {bucket}.
	S3E026 = "S3E026"

	// Search bucket error, profile: {name}.
	S3E027 = "S3E027"

	// Search keyword must not be empty.
	S3E028 = "S3E028"

	// Choose files error.
	S3E029 = "S3E029"

	// Credentials of profile {name} expired, please connect again.
	S3E030 = "S3E030"

	// Assume role {roleArn} failed: role not found or not allowed (sts:AssumeRole).
	S3E031 = "S3E031"

	// MFA code is invalid or expired.
	S3E032 = "S3E032"

	// AWS CLI profile {profile} not found or invalid.
	S3E033 = "S3E033"

	// SSO session of profile {profile} expired, run: aws sso login --profile {profile}
	S3E034 = "S3E034"

	// No credentials found in the environment (default chain).
	S3E035 = "S3E035"

	// credential_process of profile {profile} failed.
	S3E036 = "S3E036"

	// MinIO STS request failed.
	S3E037 = "S3E037"

	// LDAP username or password is incorrect.
	S3E038 = "S3E038"

	// OIDC login was canceled or timed out.
	S3E039 = "S3E039"

	// Callback port {port} is in use, choose another port.
	S3E040 = "S3E040"

	// OIDC login failed: {detail}.
	S3E041 = "S3E041"

	// Certificate or key file {path} not found, please choose it again.
	S3E042 = "S3E042"

	// Certificate or key is invalid or does not match.
	S3E043 = "S3E043"

	// None of the entered buckets can be accessed anonymously.
	S3E044 = "S3E044"

	// Read AWS config files error.
	S3E045 = "S3E045"

	// {secret} is required to renew the credentials of profile {name} (it is not saved).
	// Param secret is a stable key: mfaCode, secretKey, ldapPassword, oidcSession or keyPassword.
	S3E046 = "S3E046"

	// OIDC sign-in session was not found or has expired, sign in again.
	S3E047 = "S3E047"

	// The private key {path} is password protected, enter its password.
	S3E048 = "S3E048"

	// CA certificate file {path} not found or has no valid certificate.
	S3E049 = "S3E049"

	// ---- Warning ----

	// Access bucket is limited.
	S3W001 = "S3W001"

	// Download object: {object} is canceled.
	S3W002 = "S3W002"

	// Upload file {name} is canceled.
	S3W004 = "S3W004"

	// Another upload is running, please wait until it finishes.
	S3W005 = "S3W005"

	// Used by the frontend only.
	// Skipped {count} item(s) that can't be uploaded (unreadable, symbolic link or not a regular file).
	S3W006 = "S3W006"

	// Used by the frontend only.
	// The drop holds more than {max} files, the files after the first {max} are ignored.
	S3W007 = "S3W007"

	// Credentials of profile {name} expire in {minutes} minute(s) and cannot be renewed automatically.
	S3W008 = "S3W008"

	// Bucket {bucket} cannot be accessed anonymously.
	S3W009 = "S3W009"

	// Used by the frontend only.
	// Credentials of profile {name} expire soon, enter a new MFA code to keep the connection.
	S3W010 = "S3W010"
)

// Module is the public API of the bucket module.
type Module struct {
	logger  *slog.Logger
	app     *application.App
	global  *global.Module
	profile *profile.Module

	submoduleDownloadHistoryMng *submoduleDownloadHistoryMng
	submoduleConnMng            *submoduleConnMng
	submoduleBucketMng          *submoduleBucketMng
	submoduleObjMng             *submoduleObjMng
	submoduleSearchMng          *submoduleSearchMng
	submoduleAwsProfilesMng     *submoduleAwsProfilesMng
	submoduleDownloaderMng      *submoduleDownloaderMng
	submoduleUploaderMng        *submoduleUploaderMng
	submoduleOidcMng            *submoduleOidcMng
	submoduleAuthFilesMng       *submoduleAuthFilesMng
}

// NewModule creates the bucket module and its submodules.
func NewModule(
	app *application.App,
	logger *slog.Logger,
	global *global.Module,
	db *sql.DB,
	profileModule *profile.Module,
) *Module {
	submoduleOidcMng := newSubmoduleOidcMng(app, logger)
	submoduleCfgMng := newSubmoduleCfgMng(logger, submoduleOidcMng)
	submoduleDownloadHistoryMng := newSubmoduleDownloadHistoryMng(app, logger, db)
	submoduleConnMng := newSubmoduleConnMng(app, logger, global, profileModule, submoduleCfgMng)
	submoduleBucketMng := newSubmoduleBucketMng(app, logger, global)
	submoduleObjMng := newSubmoduleObjMng(app, logger, global)
	submoduleSearchMng := newSubmoduleSearchMng(app, logger, global)
	submoduleAwsProfilesMng := newSubmoduleAwsProfilesMng(logger)
	submoduleDownloaderMng := newSubmoduleDownloaderMng(app, logger, global, submoduleDownloadHistoryMng)
	submoduleUploaderMng := newSubmoduleUploaderMng(app, logger, global)
	submoduleAuthFilesMng := newSubmoduleAuthFilesMng(app, logger)

	return &Module{
		logger:  logger.With("modules", "bucket"),
		app:     app,
		global:  global,
		profile: profileModule,

		submoduleDownloadHistoryMng: submoduleDownloadHistoryMng,
		submoduleConnMng:            submoduleConnMng,
		submoduleBucketMng:          submoduleBucketMng,
		submoduleObjMng:             submoduleObjMng,
		submoduleSearchMng:          submoduleSearchMng,
		submoduleAwsProfilesMng:     submoduleAwsProfilesMng,
		submoduleDownloaderMng:      submoduleDownloaderMng,
		submoduleUploaderMng:        submoduleUploaderMng,
		submoduleOidcMng:            submoduleOidcMng,
		submoduleAuthFilesMng:       submoduleAuthFilesMng,
	}
}

// Connect opens a connection to an S3-compatible endpoint using the given input.
// If isExistingProfile is true, input is an already saved profile (the user typed the
// secret key themselves): it connects with input.Id and creates no profile.
// If false, input is a new connection: a profile is created from it, and if that fails
// the connection is dropped.
// On success, the connection is kept for subsequent bucket/object operations.
// ctx is the call context: canceling it aborts the connect without a message.
func (m *Module) Connect(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.connectAction(ctx, input, isExistingProfile)
}

// TestConnection checks whether the given credentials and endpoint are valid
// without keeping the connection open. Useful for validating a profile
// before saving it. ctx is the call context: canceling it aborts the test without a message.
func (m *Module) TestConnection(
	ctx context.Context,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.testAction(ctx, input)
}

// ConnectByProfile connects using a saved profile identified by connectionId,
// loading its connection settings from the profile module. ctx is the call context: canceling it aborts the
// connect without a message.
func (m *Module) ConnectByProfile(ctx context.Context, connectionId string) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.profileConnectAction(ctx, connectionId)
}

// ReauthConnection renews the credentials of the live connection connectionId without dropping it: running
// transfers continue. The settings and saved secrets come from the saved profile (every connection has one), and
// no secret is kept in memory. input must carry what the profile does not save: mfaCode (assumeRole with MFA),
// secretKey (assumeRole with key source, minioAssumeRole) and authSecret.ldapPassword (minioLdap). A missing one
// fails with S3E046 (params name, secret). sso needs nothing: run aws sso login first. Anonymous: nothing to renew.
// ctx is the call context.
func (m *Module) ReauthConnection(
	ctx context.Context,
	connectionId string,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return m.submoduleConnMng.reauthAction(ctx, connectionId, input)
}

// LoginMinioOidc signs the user in with the OpenID Connect settings in cfg: it opens the system browser, waits for
// the redirect on 127.0.0.1:cfg.CallbackPort (48765 when 0) and returns the id of a session that holds the tokens in
// memory. Pass that id as OidcSessionId to Connect, TestConnection or ReauthConnection. A session lasts until the
// id_token expires or 10 minutes, and is dropped when a connect used it. Fails with S3E039 (timeout), S3E040
// (port in use) or S3E041; canceling ctx aborts the sign-in without a message.
func (m *Module) LoginMinioOidc(ctx context.Context, cfg models.AuthConfig) models.Output[models.OidcLoginOutput] {
	return m.submoduleOidcMng.login(ctx, cfg)
}

// ChooseAuthFile opens the native dialog to choose a certificate (kind "cert"), private key ("key") or CA
// certificate ("ca") file and returns its path. The body is empty if the user cancels.
func (m *Module) ChooseAuthFile(kind string) models.Output[string] {
	return m.submoduleAuthFilesMng.chooseAuthFile(kind)
}

// ListAwsProfiles returns the profiles of the AWS CLI config and credentials files (empty paths mean the standard
// files). It only parses the files, so it never runs a credential_process. Missing files give an empty list;
// an unreadable file gives S3E045.
func (m *Module) ListAwsProfiles(configFile, credentialsFile string) models.Output[[]models.AwsProfileOutput] {
	return m.submoduleAwsProfilesMng.list(configFile, credentialsFile)
}

// Disconnect closes the active connection identified by connectionId
// and removes it from the shared connection store.
// Returns true if the disconnect succeeded.
func (m *Module) Disconnect(connectionId string) models.Output[bool] {
	return m.submoduleConnMng.disconnectAction(connectionId)
}

// DisconnectAll removes every active connection from the shared store and
// closes their idle HTTP connections. Intended to be called on application
// shutdown to release network resources.
func (m *Module) DisconnectAll() {
	m.submoduleOidcMng.clear()
	for _, conn := range m.global.RemoveAllConn() {
		conn.Close()
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

// SearchObject scans the folder input.Prefix (no recursion) for keys containing input.Keyword
// (case-insensitive) and returns at most 100 matches per call, scanning at most 20 pages.
// Pass the returned NextCursor back in input.NextCursor to continue; an empty NextCursor means
// nothing is left to scan. An empty keyword is rejected. ctx is the call context.
func (m *Module) SearchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	return m.submoduleSearchMng.searchObject(ctx, input)
}

// SearchBucket scans the buckets of the connection for names containing input.Keyword
// (case-insensitive) and returns at most 100 matches per call, scanning at most 20 pages.
// Pass the returned NextCursor (opaque) back in input.NextCursor to continue; an empty NextCursor
// means nothing is left to scan. An empty keyword or an invalid cursor is rejected. ctx is the call context.
func (m *Module) SearchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	return m.submoduleSearchMng.searchBucket(ctx, input)
}

// GetObjectDetail returns the content type, storage class and user metadata of the object
// input.Key (HeadObject). A folder key or an empty key is rejected. ctx is the call context.
func (m *Module) GetObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	return m.submoduleObjMng.getObjectDetail(ctx, input)
}

// DownloadObject starts downloading input.Objects from input.Bucket; progress is reported
// by EventDownloadObjectProgress and each file is saved to the download history.
func (m *Module) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return m.submoduleDownloaderMng.downloadObject(input)
}

// CancelDownloadOne cancels the running download with the given ID.
func (m *Module) CancelDownloadOne(id string) models.Output[any] {
	return m.submoduleDownloaderMng.cancelDownloadOne(id)
}

// CancelAllDownloads cancels every running download.
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

// DeleteObject deletes the objects in input.Objects. ctx is the call context.
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

// GetDownloadHistory returns the saved download history for input.
func (m *Module) GetDownloadHistory(input models.DownloadHistoryInput) models.Output[models.DownloadHistoryOutput] {
	return m.submoduleDownloadHistoryMng.getDownloadHistory(input)
}

// OpenDownloadDest reveals the downloaded file at path in the system file manager.
func (m *Module) OpenDownloadDest(fileName, path string) models.Output[any] {
	return m.submoduleDownloadHistoryMng.openDownloadDest(fileName, path)
}

// UploadObject starts uploading input.ObjList into input.Prefix; progress is reported by
// EventUploadObjectProgress.
func (m *Module) UploadObject(input models.UploadObjInput) models.Output[any] {
	return m.submoduleUploaderMng.uploadObject(input)
}

// PickFiles opens the native dialog to choose files to upload and returns them as groups
// with the upload limits. If the user cancels, the body has no groups.
func (m *Module) PickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	return m.submoduleUploaderMng.pickFiles(ctx)
}

// HandleFilesDropped is the window's WindowFilesDropped listener. It forwards the
// dropped files to the frontend tab they were dropped on.
func (m *Module) HandleFilesDropped(event *application.WindowEvent) {
	m.submoduleUploaderMng.handleFilesDropped(event)
}
