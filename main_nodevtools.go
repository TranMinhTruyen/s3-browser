//go:build !devtools

package main

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// applyBenchOptions changes nothing outside the bench build, so the S3B_BENCH_* env has no effect.
func applyBenchOptions(*slog.Logger, *application.WindowsOptions) {}
