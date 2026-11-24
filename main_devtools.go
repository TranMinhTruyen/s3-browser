//go:build devtools

package main

import (
	"log/slog"
	"os"
	"strconv"
)

// benchBrowserArgs opens the WebView2 remote debugging port named by S3B_BENCH_CDP_PORT (1024-65535) so the
// memory benchmark can attach CDP. It is compiled only into the bench build (tag devtools); no env means no args.
func benchBrowserArgs(logger *slog.Logger) []string {
	value := os.Getenv("S3B_BENCH_CDP_PORT")
	if value == "" {
		return nil
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1024 || port > 65535 {
		logger.Warn("S3B_BENCH_CDP_PORT ignored: want a number in 1024-65535", "value", value)
		return nil
	}
	logger.Info("bench: remote debugging port enabled", "port", port)
	return []string{"--remote-debugging-port=" + strconv.Itoa(port)}
}
