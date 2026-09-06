package bucket

import (
	"context"
	"log/slog"
	"minio-browser/internal/modules/profile"
	"minio-browser/internal/pkg/utils"
	"minio-browser/models/bucket"
	"sync"
)

type Module struct {
	ctx     context.Context
	mu      sync.RWMutex
	conns   map[string]*S3Conn
	logger  *slog.Logger
	profile *profile.Module
}

func NewModule(logger *slog.Logger, profileModule *profile.Module) *Module {
	return &Module{
		logger: logger.With("component", "bucket_module"),
		conns:  make(map[string]*S3Conn),

		profile: profileModule,
	}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

func (m *Module) TestConnection(input bucket.ConnectionInput) bucket.ConnectionOutput {
	c := buildClient(input)
	status, err := probe(m.ctx, c)

	if err == nil {
		c.Transport.CloseIdleConnections()
	}

	status.IsConnected = err == nil
	status.Message = S3_SUCCES_001
	return status
}

func (m *Module) Connect(input bucket.ConnectionInput) bucket.ConnectionOutput {
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

	if err := m.profile.CreateProfile(connectionId, input); err != nil {
		m.logger.Error("save connection profile failed", "connectionId", connectionId, "error", err)
	}

	return status
}

func (m *Module) Disconnect(connectionId string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if conn, ok := m.conns[connectionId]; ok {
		conn.Transport.CloseIdleConnections()
		delete(m.conns, connectionId)
		return true
	}
	return false
}

func (m *Module) DisconnectAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, conn := range m.conns {
		conn.Transport.CloseIdleConnections()
		delete(m.conns, id)
	}
}
