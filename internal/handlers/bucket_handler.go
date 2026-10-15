package handlers

import (
	"S3Browser/internal/modules/bucket"
	"S3Browser/models"
	"context"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type BucketHandler struct {
	logger *slog.Logger
	app    *application.App
	bucket *bucket.Module
}

func NewBucketHandler(app *application.App, logger *slog.Logger, bucket *bucket.Module) *BucketHandler {
	return &BucketHandler{
		logger: logger.With("component", "bucket_handler"),
		app:    app,
		bucket: bucket,
	}
}

func (h *BucketHandler) ConnectS3(
	input models.ConnectionProfileInput,
	isTestConn bool,
	isManualConnect bool,
) models.Output[models.ConnectOutput] {
	if isTestConn {
		return h.bucket.TestConnection(input)
	}
	return h.bucket.Connect(input, isManualConnect)
}

func (h *BucketHandler) ConnectS3ByProfile(connectionId string) models.Output[models.ConnectOutput] {
	return h.bucket.ConnectByProfile(connectionId)
}

func (h *BucketHandler) DisconnectAll() {
	h.bucket.DisconnectAll()
}

func (h *BucketHandler) Disconnect(connectionId string) models.Output[bool] {
	return h.bucket.Disconnect(connectionId)
}

func (h *BucketHandler) GetListBucket(
	ctx context.Context,
	input models.ListBucketInput,
) models.Output[models.ListBucketOutput] {
	return h.bucket.GetListBucket(ctx, input)
}

func (h *BucketHandler) GetListObject(
	ctx context.Context,
	input models.ListObjectInput,
) models.Output[models.ListObjectOutput] {
	return h.bucket.GetListObject(ctx, input)
}

func (h *BucketHandler) DownloadObject(input models.DownloadObjInput) models.Output[any] {
	return h.bucket.DownloadObject(input)
}

func (m *BucketHandler) CancelDownloadOne(id string) models.Output[any] {
	return m.bucket.CancelDownloadOne(id)
}

func (m *BucketHandler) CancelAllDownloads() models.Output[any] {
	return m.bucket.CancelAllDownloads()
}

func (m *BucketHandler) DeleteObject(ctx context.Context, input models.DeleteObjInput) models.Output[any] {
	return m.bucket.DeleteObject(ctx, input)
}
