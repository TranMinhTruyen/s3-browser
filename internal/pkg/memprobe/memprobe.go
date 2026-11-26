// Package memprobe ghi số liệu bộ nhớ của Go runtime vào file JSONL để đo RAM (test-env/mem-bench.ps1).
// Không làm gì nếu biến môi trường S3B_MEMPROBE chưa chỉ định file.
package memprobe

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"runtime/metrics"
	"time"
)

// envFile là tên file đầu ra; nếu rỗng thì không bật theo dõi.
const envFile = "S3B_MEMPROBE"

// interval là khoảng thời gian giữa hai dòng.
const interval = 2 * time.Second

// names là các metric runtime của một dòng, theo thứ tự trường trong line.
var names = []string{
	"/memory/classes/total:bytes",
	"/memory/classes/heap/objects:bytes",
	"/memory/classes/heap/released:bytes",
	"/memory/classes/heap/stacks:bytes",
	"/gc/heap/goal:bytes",
}

// line là một bản ghi JSONL.
type line struct {
	Time         int64  `json:"time"` // Unix milliseconds
	Total        uint64 `json:"total"`
	HeapObjects  uint64 `json:"heapObjects"`
	HeapReleased uint64 `json:"heapReleased"`
	HeapStacks   uint64 `json:"heapStacks"`
	GcGoal       uint64 `json:"gcGoal"`
	DllLoaded    bool   `json:"dllLoaded"`
}

// Start bắt đầu ghi một dòng mỗi 2 giây cho đến khi ctx kết thúc. dllLoaded cho biết thư viện native đã được nạp chưa.
// Hàm trả về ngay và không làm gì nếu chưa đặt S3B_MEMPROBE; nếu không ghi được file thì chỉ ghi log và ứng dụng vẫn chạy.
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

// value là số liệu theo byte hoặc 0 nếu phiên bản Go này không có metric đó.
func value(s metrics.Sample) uint64 {
	if s.Value.Kind() != metrics.KindUint64 {
		return 0
	}
	return s.Value.Uint64()
}
