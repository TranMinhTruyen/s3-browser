// Package global holds state shared by all modules: the registry of live S3 connections.
package global

import (
	"sync"
)

// Module is the connection registry shared by the bucket and profile modules.
type Module struct {
	mu            sync.RWMutex
	connContainer map[string]*S3Conn
	// transfers counts the running uploads/downloads per connection id; guarded by mu.
	transfers map[string]int
}

// NewModule creates an empty registry.
func NewModule() *Module {
	return &Module{
		connContainer: make(map[string]*S3Conn),
		transfers:     make(map[string]int),
	}
}
