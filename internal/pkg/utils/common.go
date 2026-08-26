package utils

import (
	"context"
	"log/slog"
	"runtime"
	"time"

	"github.com/google/uuid"
)

func ToPtr[T any](v T) *T {
	return &v
}

func ToVal[T any](p *T) T {
	if p == nil {
		return *new(T)
	}
	return *p
}

func GenerateUUID() string {
	return uuid.Must(uuid.NewV7()).String()
}

func Logger(ctx context.Context, level slog.Level, msg string, detail any) {
	if ctx == nil {
		ctx = context.Background()
	}
	l := slog.Default()
	if !l.Enabled(ctx, level) {
		return
	}

	var pcs [1]uintptr
	runtime.Callers(3, pcs[:])

	r := slog.NewRecord(time.Now(), level, msg, pcs[0])
	if detail != nil {
		r.AddAttrs(slog.Any("detail", detail))
	}
	_ = l.Handler().Handle(ctx, r)
}
