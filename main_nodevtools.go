//go:build !devtools

package main

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// applyBenchOptions không thay đổi gì ngoài bản dựng benchmark nên các biến S3B_BENCH_* không có tác dụng.
func applyBenchOptions(*slog.Logger, *application.WindowsOptions) {}
