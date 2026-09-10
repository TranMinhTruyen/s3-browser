package global

import (
	"sync"
)

type Module struct {
	mu            sync.RWMutex
	connContainer map[string]*S3Conn
}

func NewModule() *Module {
	return &Module{
		connContainer: make(map[string]*S3Conn),
	}
}
