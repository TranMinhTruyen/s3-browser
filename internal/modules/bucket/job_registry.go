package bucket

import (
	"context"
	"sync"
)

// jobRegistry lưu hàm cancel của các lượt truyền đang chạy, dùng transfer ID làm khóa. Dùng sync.Map vì handler hủy
// đọc map trong khi goroutine truyền dữ liệu thêm và xóa mục.
type jobRegistry struct {
	jobs sync.Map
}

// start trả context cho job id, được hủy bởi cancel, cancelAll hoặc parent. Phải defer hàm trả về để giải phóng context
// và xóa job khỏi registry.
func (r *jobRegistry) start(parent context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	r.jobs.Store(id, cancel)
	return ctx, func() { cancel(); r.jobs.Delete(id) }
}

// cancel hủy job id rồi cho biết job có đang chạy hay không. Bỏ qua ID không xác định hoặc đã hoàn tất.
func (r *jobRegistry) cancel(id string) bool {
	v, ok := r.jobs.LoadAndDelete(id)
	if ok {
		v.(context.CancelFunc)()
	}
	return ok
}

// cancelAll hủy mọi job đang chạy rồi gọi onCancel với ID của từng job.
func (r *jobRegistry) cancelAll(onCancel func(id string)) {
	r.jobs.Range(func(k, v any) bool {
		v.(context.CancelFunc)()
		onCancel(k.(string))
		return true
	})
}
