package handlers

import (
	"S3Browser/internal/modules/bucket"
	"S3Browser/models"
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
	input models.ConnectionInput,
	isTestConn bool,
	isManualConnect bool,
) models.Output[models.ConnectionOutput] {
	if isTestConn {
		return h.bucket.TestConnection(input)
	}
	return h.bucket.Connect(input, isManualConnect)
}

func (h *BucketHandler) ConnectS3ByProfile(connectionId string) models.Output[models.ConnectionOutput] {
	return h.bucket.ConnectByProfile(connectionId)
}

func (h *BucketHandler) DisconnectAll() {
	h.bucket.DisconnectAll()
}

func (h *BucketHandler) Disconnect(connectionId string) models.Output[bool] {
	return h.bucket.Disconnect(connectionId)
}

func (h *BucketHandler) GetListBucket(input models.ListBucketInput) models.Output[models.ListBucketOutput] {
	return h.bucket.GetListBucket(input)
}

func (h *BucketHandler) GetListObject(input models.ListObjectInput) models.Output[models.ListObjectOutput] {
	return h.bucket.GetListObject(input)
}
