package handlers

import (
	"S3Browser/internal/modules/bucket"
	models "S3Browser/models/bucket"
	"S3Browser/models/common"
	"context"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type BucketHandler struct {
	ctx    context.Context
	logger *slog.Logger
	app    *application.App

	bucket *bucket.Module
}

func NewHandler(app *application.App, logger *slog.Logger, bucket *bucket.Module) *BucketHandler {
	return &BucketHandler{
		logger: logger.With("component", "bucket_handler"),
		app:    app,

		bucket: bucket,
	}
}

func (h *BucketHandler) Startup(ctx context.Context) {
	h.ctx = ctx
}

type BucketIPC struct{ h *BucketHandler }

func (h *BucketHandler) BucketIPC() *BucketIPC {
	return &BucketIPC{h: h}
}

func (a *BucketIPC) ConnectS3(input models.ConnectionInput, isTestConn bool) common.Output[models.ConnectionOutput] {
	if isTestConn {
		return a.h.bucket.TestConnection(input)
	}
	return a.h.bucket.Connect(input)
}

func (a *BucketIPC) DisconnectAll() {
	a.h.bucket.DisconnectAll()
}

func (a *BucketIPC) Disconnect(connectionId string) bool {
	return a.h.bucket.Disconnect(connectionId)
}
