package global

import (
	"sync"
	"time"
)

// accessTTL là thời gian kết quả kiểm tra quyền truy cập bucket còn hiệu lực; sau đó bucket sẽ được kiểm tra lại.
const accessTTL = 5 * time.Minute

// AccessKind là loại quyền truy cập mà kết quả kiểm tra đề cập.
type AccessKind int

const (
	AccessRead AccessKind = iota
	AccessWrite
	AccessDelete
)

type accessEntry struct {
	denied bool
	at     time.Time
}

type policyEntry struct {
	mode string
	at   time.Time
}

// AccessCache lưu kết quả kiểm tra quyền bucket cho một kết nối, theo tên bucket. Kết quả đọc, ghi và xóa có thời hạn
// riêng vì thao tác liệt kê không phải lúc nào cũng kiểm tra quyền ghi. Giá trị zero có thể dùng ngay.
//
// Reset tăng generation. Bên gọi đọc Generation trước khi thăm dò rồi truyền giá trị đó cho Set / MarkAccount;
// các hàm này bỏ qua kết quả nếu Reset đã xảy ra trong lúc chờ (kết quả được tạo bằng thông tin xác thực cũ).
type AccessCache struct {
	mu         sync.Mutex
	entries    [3]map[string]accessEntry
	policies   map[string]policyEntry
	accountAt  time.Time
	generation uint64
}

// Generation trả về generation hiện tại; lấy giá trị này trước khi bắt đầu thăm dò.
func (a *AccessCache) Generation() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.generation
}

// Get cho biết lần kiểm tra gần nhất có xác nhận quyền truy cập bị từ chối hay không; ok là false nếu chưa có kết quả hoặc đã hết hạn.
func (a *AccessCache) Get(kind AccessKind, bucket string) (denied, ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.entries[kind][bucket]
	return e.denied, ok && time.Since(e.at) < accessTTL
}

// Set ghi nhận kết quả kiểm tra có phản hồi chắc chắn từ máy chủ; gen là Generation lấy trước khi kiểm tra.
func (a *AccessCache) Set(kind AccessKind, bucket string, denied bool, gen uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if gen != a.generation {
		return
	}
	if a.entries[kind] == nil {
		a.entries[kind] = map[string]accessEntry{}
	}
	a.entries[kind][bucket] = accessEntry{denied: denied, at: time.Now()}
}

// GetPolicy trả chế độ policy đọc được gần nhất của bucket; ok là false nếu chưa có kết quả hoặc đã hết hạn.
func (a *AccessCache) GetPolicy(bucket string) (mode string, ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.policies[bucket]
	return e.mode, ok && time.Since(e.at) < accessTTL
}

// SetPolicy ghi nhận chế độ policy đọc được của bucket; gen là Generation lấy trước khi đọc.
func (a *AccessCache) SetPolicy(bucket, mode string, gen uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if gen != a.generation {
		return
	}
	if a.policies == nil {
		a.policies = map[string]policyEntry{}
	}
	a.policies[bucket] = policyEntry{mode: mode, at: time.Now()}
}

// AccountFresh cho biết MinIO AccountInfo đã được gọi đủ gần đây (xem MarkAccount) để không cần gọi lại hay chưa.
func (a *AccessCache) AccountFresh() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return time.Since(a.accountAt) < accessTTL
}

// MarkAccount ghi nhận MinIO AccountInfo vừa được gọi, bất kể thành công hay thất bại; gen là Generation lấy trước khi gọi.
func (a *AccessCache) MarkAccount(gen uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if gen == a.generation {
		a.accountAt = time.Now()
	}
}

// Reset xóa mọi kết quả, ví dụ khi thông tin xác thực thay đổi.
func (a *AccessCache) Reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.entries = [3]map[string]accessEntry{}
	a.policies = nil
	a.accountAt = time.Time{}
	a.generation++
}
