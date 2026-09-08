package handlers

import (
	"S3Browser/internal/modules/bucket"
	models "S3Browser/models/bucket"
	"S3Browser/models/common"
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

func (a *BucketHandler) ConnectS3(
	input models.ConnectionInput,
	isTestConn bool,
) common.Output[models.ConnectionOutput] {
	if isTestConn {
		return a.bucket.TestConnection(input)
	}
	return a.bucket.Connect(input)
}

func (a *BucketHandler) DisconnectAll() {
	a.bucket.DisconnectAll()
}

func (a *BucketHandler) Disconnect(connectionId string) bool {
	return a.bucket.Disconnect(connectionId)
}
