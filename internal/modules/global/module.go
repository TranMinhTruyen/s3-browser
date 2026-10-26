package global

import (
	"sync"
)

type Module struct {
	mu            sync.RWMutex
	connContainer map[string]*S3Conn
	// transfers counts the running uploads/downloads per connection id; guarded by mu.
	transfers map[string]int
}

func NewModule() *Module {
	return &Module{
		connContainer: make(map[string]*S3Conn),
		transfers:     make(map[string]int),
	}
}
