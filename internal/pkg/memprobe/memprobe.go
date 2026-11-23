// Package memprobe writes the Go runtime memory numbers to a JSONL file for the RAM benchmark
// (test-env/mem-bench.ps1). It does nothing unless the S3B_MEMPROBE env names the file.
package memprobe

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"runtime/metrics"
	"time"
)

// envFile names the output file; the probe is off when it is empty.
const envFile = "S3B_MEMPROBE"

// interval is the time between two lines.
const interval = 2 * time.Second

// names are the runtime metrics of one line, in the order of the fields of line.
var names = []string{
	"/memory/classes/total:bytes",
	"/memory/classes/heap/objects:bytes",
	"/memory/classes/heap/released:bytes",
	"/memory/classes/heap/stacks:bytes",
	"/gc/heap/goal:bytes",
}

// line is one JSONL record.
type line struct {
	Time         int64  `json:"time"` // Unix milliseconds
	Total        uint64 `json:"total"`
	HeapObjects  uint64 `json:"heapObjects"`
	HeapReleased uint64 `json:"heapReleased"`
	HeapStacks   uint64 `json:"heapStacks"`
	GcGoal       uint64 `json:"gcGoal"`
	DllLoaded    bool   `json:"dllLoaded"`
}

// Start begins writing one line every 2 seconds until ctx ends. dllLoaded tells whether the native library is
// loaded. It returns at once and does nothing when S3B_MEMPROBE is unset; an unwritable file is logged and the
// app keeps running.
func Start(ctx context.Context, logger *slog.Logger, dllLoaded func() bool) {
	path := os.Getenv(envFile)
	if path == "" {
		return
	}
	log := logger.With("component", "memprobe")

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		log.Error("open memprobe file failed", "error", err)
		return
	}

	go func() {
		defer func() { _ = f.Close() }()

		samples := make([]metrics.Sample, len(names))
		for i, name := range names {
			samples[i].Name = name
		}
		enc := json.NewEncoder(f)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			metrics.Read(samples)
			rec := line{
				Time:         time.Now().UnixMilli(),
				Total:        value(samples[0]),
				HeapObjects:  value(samples[1]),
				HeapReleased: value(samples[2]),
				HeapStacks:   value(samples[3]),
				GcGoal:       value(samples[4]),
				DllLoaded:    dllLoaded(),
			}
			if err := enc.Encode(rec); err != nil {
				log.Error("write memprobe line failed", "error", err)
				return
			}

			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// value is the sample as bytes, or 0 when this Go version does not have the metric.
func value(s metrics.Sample) uint64 {
	if s.Value.Kind() != metrics.KindUint64 {
		return 0
	}
	return s.Value.Uint64()
}
