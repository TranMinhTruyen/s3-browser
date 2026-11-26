// Package global chứa trạng thái dùng chung giữa các module: registry các kết nối S3 đang hoạt động.
package global

import (
	"sync"
)

// Module là registry kết nối được module bucket và profile dùng chung.
type Module struct {
	mu            sync.RWMutex
	connContainer map[string]*S3Conn
	// transfers đếm số lượt tải lên/tải xuống đang chạy theo connection id; được bảo vệ bởi mu.
	transfers map[string]int
}

// NewModule tạo registry rỗng.
func NewModule() *Module {
	return &Module{
		connContainer: make(map[string]*S3Conn),
		transfers:     make(map[string]int),
	}
}
