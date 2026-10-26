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

// ReportEvery calls fn every d in a separate goroutine.
//
// The returned stop() function:
//  1. stops the ticker,
//  2. calls fn one last time (so the UI shows the final value),
//  3. waits for the goroutine to exit, so fn is never called after stop() returns.
func ReportEvery(d time.Duration, fn func()) (stop func()) {
	t := time.NewTicker(d)
	quit := make(chan struct{})

	go func() {
		defer t.Stop()
		for {
			select {
			case <-t.C:
				fn()
			case <-quit:
				return
			}
		}
	}()

	return func() {
		quit <- struct{}{}
		fn()
	}
}
