package bucket

import (
	"context"
	"minio-browser/internal/pkg/utils"
	"minio-browser/models"
	"sync"
)

type Module struct {
	ctx   context.Context
	mu    sync.RWMutex
	conns map[string]*S3Conn
}

func NewModule() *Module {
	return &Module{
		conns: make(map[string]*S3Conn),
	}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

func (m *Module) TestConnection(input models.ConnectionInput) models.ConnectionOutput {
	c := buildClient(input)
	status, err := probe(m.ctx, c)

	if err == nil {
		c.Transport.CloseIdleConnections()
	}

	status.IsConnected = err == nil
	status.Message = S3_SUCCES_001
	return status
}

func (m *Module) Connect(input models.ConnectionInput) models.ConnectionOutput {
	c := buildClient(input)
	status, err := probe(m.ctx, c)

	if err != nil {
		status.IsConnected = false
		return status
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	connectionId := utils.GenerateUUID()
	m.conns[connectionId] = c

	status.ConnectionId = connectionId
	status.IsConnected = true
	status.Message = S3_SUCCES_002

	return status
}

func (m *Module) Disconnect(connectionId string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if conn, ok := m.conns[connectionId]; ok {
		conn.Transport.CloseIdleConnections()
		delete(m.conns, connectionId)
	}
}

func (m *Module) DisconnectAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, conn := range m.conns {
		conn.Transport.CloseIdleConnections()
		delete(m.conns, id)
	}
}
