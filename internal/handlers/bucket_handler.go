package handlers

import (
	"S3Browser/internal/modules/bucket"
	"S3Browser/models"
	"context"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// BucketHandler is the Wails service for connections, buckets, objects, uploads and downloads.
type BucketHandler struct {
	logger *slog.Logger
	app    *application.App
	bucket *bucket.Module
}

// NewBucketHandler creates the bucket handler.
func NewBucketHandler(app *application.App, logger *slog.Logger, bucket *bucket.Module) *BucketHandler {
	return &BucketHandler{
		logger: logger.With("component", "bucket_handler"),
		app:    app,
		bucket: bucket,
	}
}

// ConnectS3 tests the connection when isTestConn is set, otherwise connects and keeps it open.
func (h *BucketHandler) ConnectS3(
	ctx context.Context,
	input models.ConnectionProfileInput,
	isTestConn bool,
	isExistingProfile bool,
) models.Output[models.ConnectOutput] {
	if isTestConn {
		return h.bucket.TestConnection(ctx, input)
	}
	return h.bucket.Connect(ctx, input, isExistingProfile)
}

// ConnectS3ByProfile connects using a saved profile.
func (h *BucketHandler) ConnectS3ByProfile(
	ctx context.Context,
	connectionId string,
) models.Output[models.ConnectOutput] {
	return h.bucket.ConnectByProfile(ctx, connectionId)
}

// ReauthConnection renews the credentials of a live connection (new MFA code) without dropping it.
func (h *BucketHandler) ReauthConnection(
	ctx context.Context,
	connectionId string,
	input models.ConnectionProfileInput,
) models.Output[models.ConnectOutput] {
	return h.bucket.ReauthConnection(ctx, connectionId, input)
}

// LoginMinioOidc signs in with OpenID Connect in the system browser and returns the session id for the connect.
func (h *BucketHandler) LoginMinioOidc(
	ctx context.Context,
	cfg models.AuthConfig,
) models.Output[models.OidcLoginOutput] {
	return h.bucket.LoginMinioOidc(ctx, cfg)
}

// ChooseAuthFile opens the file dialog for a certificate, key or CA file (kind: cert, key, ca).
func (h *BucketHandler) ChooseAuthFile(kind string) models.Output[string] {
	return h.bucket.ChooseAuthFile(kind)
}

// ListAwsProfiles lists the profiles of the AWS CLI config files; empty paths mean the standard files.
func (h *BucketHandler) ListAwsProfiles(configFile, credentialsFile string) models.Output[[]models.AwsProfileOutput] {
	return h.bucket.ListAwsProfiles(configFile, credentialsFile)
}

// DisconnectAll closes every connection.
func (h *BucketHandler) DisconnectAll() {
	h.bucket.DisconnectAll()
}

// Disconnect closes one connection.
func (h *BucketHandler) Disconnect(connectionId string) models.Output[bool] {
	return h.bucket.Disconnect(connectionId)
}

// GetListBucket lists the buckets of a connection.
func (h *BucketHandler) GetListBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	return h.bucket.GetListBucket(ctx, input)
}

// GetListObject lists one page of objects under a prefix.
func (h *BucketHandler) GetListObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	return h.bucket.GetListObject(ctx, input)
}

// SearchObject searches objects of a bucket by keyword.
func (h *BucketHandler) SearchObject(
	ctx context.Context,
	input models.SearchObjectInput,
) models.Output[models.SearchObjectOutput] {
	return h.bucket.SearchObject(ctx, input)
}

// SearchBucket searches buckets by keyword.
func (h *BucketHandler) SearchBucket(
	ctx context.Context,
	input models.SearchBucketInput,
) models.Output[models.SearchBucketOutput] {
	return h.bucket.SearchBucket(ctx, input)
}

// GetObjectDetail returns the metadata of one object.
func (h *BucketHandler) GetObjectDetail(
	ctx context.Context,
	input models.ObjectDetailInput,
) models.Output[models.ObjectDetailOutput] {
	return h.bucket.GetObjectDetail(ctx, input)
}

// DownloadObject starts downloading objects.
func (h *BucketHandler) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return h.bucket.DownloadObject(input)
}

// CancelDownloadOne cancels one running download.
func (h *BucketHandler) CancelDownloadOne(id string) models.Output[any] {
	return h.bucket.CancelDownloadOne(id)
}

// CancelAllDownloads cancels every running download.
func (h *BucketHandler) CancelAllDownloads() models.Output[any] {
	return h.bucket.CancelAllDownloads()
}

// CancelUploadOne cancels one running upload.
func (h *BucketHandler) CancelUploadOne(id string) models.Output[any] {
	return h.bucket.CancelUploadOne(id)
}

// CancelAllUploads cancels every running upload.
func (h *BucketHandler) CancelAllUploads() models.Output[any] {
	return h.bucket.CancelAllUploads()
}

// DeleteObject deletes the given objects.
func (h *BucketHandler) DeleteObject(
	ctx context.Context,
	input models.DeleteObjInput,
) models.Output[models.DeleteObjOutput] {
	return h.bucket.DeleteObject(ctx, input)
}

// DeletePrefix deletes every object under a prefix.
func (h *BucketHandler) DeletePrefix(
	ctx context.Context,
	input models.DeletePrefixInput,
) models.Output[models.DeletePrefixOutput] {
	return h.bucket.DeletePrefix(ctx, input)
}

// GetDownloadHistory returns the download history.
func (h *BucketHandler) GetDownloadHistory(
	input models.DownloadHistoryInput,
) models.Output[models.DownloadHistoryOutput] {
	return h.bucket.GetDownloadHistory(input)
}

// OpenDownloadDest opens a downloaded file in the file manager.
func (h *BucketHandler) OpenDownloadDest(fileName, path string) models.Output[any] {
	return h.bucket.OpenDownloadDest(fileName, path)
}

// UploadObject starts uploading files.
func (h *BucketHandler) UploadObject(input models.UploadObjInput) models.Output[any] {
	return h.bucket.UploadObject(input)
}

// PickFiles opens the native dialog to choose files to upload and returns them as groups.
func (h *BucketHandler) PickFiles(ctx context.Context) models.Output[models.FilesDroppedOutput] {
	return h.bucket.PickFiles(ctx)
}

// FilesDropped is the main window's WindowFilesDropped listener, not a frontend API:
// wails:ignore keeps it out of the generated bindings.
//
//wails:ignore
func (h *BucketHandler) FilesDropped(event *application.WindowEvent) {
	h.bucket.HandleFilesDropped(event)
}
