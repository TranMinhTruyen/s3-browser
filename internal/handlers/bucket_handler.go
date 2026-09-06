package handlers

import (
	"context"
	"log/slog"
	"minio-browser/internal/modules/bucket"
	models "minio-browser/models/bucket"
)

type BucketHandler struct {
	ctx    context.Context
	logger *slog.Logger
	bucket *bucket.Module
}

func NewHandler(logger *slog.Logger, bucket *bucket.Module) *BucketHandler {
	return &BucketHandler{
		logger: logger.With("component", "bucket_handler"),

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

func (a *BucketIPC) ConnectS3(input models.ConnectionInput, isTestConn bool) models.ConnectionOutput {
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
