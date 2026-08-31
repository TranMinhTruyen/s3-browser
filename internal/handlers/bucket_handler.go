package handlers

import (
	"context"
	"log/slog"
	"minio-browser/internal/modules/bucket"
	"minio-browser/models"
)

type BucketHandler struct {
	ctx    context.Context
	bucket *bucket.Module
	logger *slog.Logger
}

func NewHandler(logger *slog.Logger, bucket *bucket.Module) *BucketHandler {
	log := logger.With("component", "bucket_handler")

	return &BucketHandler{
		bucket: bucket,
		logger: log,
	}
}

func (h *BucketHandler) Startup(ctx context.Context) {
	h.ctx = ctx
	h.bucket.Startup(ctx)
}

type API struct{ h *BucketHandler }

func (h *BucketHandler) API() *API {
	return &API{h: h}
}

func (a *API) ConnectS3(input models.ConnectionInput, isTestConn bool) models.ConnectionOutput {
	if isTestConn {
		return a.h.bucket.TestConnection(input)
	}
	return a.h.bucket.Connect(input)
}

func (a *API) DisconnectAll() {
	a.h.bucket.DisconnectAll()
}

func (a *API) Disconnect(connectionId string) bool {
	return a.h.bucket.Disconnect(connectionId)
}
