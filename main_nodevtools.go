//go:build !devtools

package main

import "log/slog"

// benchBrowserArgs adds no browser args outside the bench build, so S3B_BENCH_CDP_PORT has no effect.
func benchBrowserArgs(*slog.Logger) []string { return nil }
