// Package utils chứa các hàm tiện ích nhỏ dùng chung giữa các module: id, báo tiến độ theo lô và mã hóa thông tin bí mật.
package utils

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// GenerateUUID trả về UUID v7: có thứ tự theo thời gian nên id được sắp xếp theo lúc tạo (dùng cho phân trang keyset).
func GenerateUUID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// reportInterval là khoảng thời gian giữa các lần BatchReporter phát sự kiện.
const reportInterval = 200 * time.Millisecond

// BatchReporter gộp sự kiện tiến độ của nhiều job chạy đồng thời thành một sự kiện theo lô.
//
// Mỗi job đăng ký hàm đọc bằng Track. Khi còn ít nhất một job được theo dõi, một goroutine ticker gọi emit mỗi
// reportInterval để gửi tiến độ của mọi job; goroutine kết thúc khi không còn job hoặc context kết thúc.
// Bên gọi cập nhật bộ đếm sau mỗi chunk và không tự phát sự kiện.
type BatchReporter[T any] struct {
	mu      sync.Mutex
	jobs    map[string]func() (T, bool)
	running bool
	ctx     func() context.Context
	emit    func(items []T)
}

// NewBatchReporter tạo bộ báo cáo. ctx trả context dùng để dừng ticker (khi ứng dụng tắt);
// emit gửi một lô đến frontend.
func NewBatchReporter[T any](ctx func() context.Context, emit func(items []T)) *BatchReporter[T] {
	return &BatchReporter[T]{jobs: make(map[string]func() (T, bool)), ctx: ctx, emit: emit}
}

// Track thêm job và khởi chạy ticker nếu ticker chưa chạy. read trả về tiến độ hiện tại
// hoặc false nếu chưa có gì để báo cáo.
//
// done() được trả về sẽ phát lô cuối cùng (để UI hiển thị giá trị kết thúc) rồi gỡ job.
// Việc phát sự kiện được tuần tự hóa với ticker nên giá trị cuối không bị một tick cũ ghi đè.
// done có tính idempotent: các lần gọi sau lần đầu không làm gì.
func (r *BatchReporter[T]) Track(id string, read func() (T, bool)) (done func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jobs[id] = read
	if !r.running {
		r.running = true
		go r.run(r.ctx())
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.emitLocked()
			delete(r.jobs, id)
		})
	}
}

// run phát một lô mỗi reportInterval đến khi không còn job hoặc ctx kết thúc.
func (r *BatchReporter[T]) run(ctx context.Context) {
	t := time.NewTicker(reportInterval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
		case <-ctx.Done():
			r.mu.Lock()
			r.running = false
			r.mu.Unlock()
			return
		}
		r.mu.Lock()
		if len(r.jobs) == 0 {
			r.running = false
			r.mu.Unlock()
			return
		}
		r.emitLocked()
		r.mu.Unlock()
	}
}

// emitLocked phát tiến độ của mọi job nếu có nội dung cần báo cáo. Bên gọi phải giữ mu.
func (r *BatchReporter[T]) emitLocked() {
	items := make([]T, 0, len(r.jobs))
	for _, read := range r.jobs {
		if item, ok := read(); ok {
			items = append(items, item)
		}
	}
	if len(items) > 0 {
		r.emit(items)
	}
}
