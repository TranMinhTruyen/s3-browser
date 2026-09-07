package bucket

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"context"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Module struct {
	ctx     context.Context
	logger  *slog.Logger
	app     *application.App
	mu      sync.RWMutex
	conns   map[string]*S3Conn
	profile *profile.Module
}

func NewModule(app *application.App, logger *slog.Logger, profileModule *profile.Module) *Module {
	return &Module{
		logger: logger.With("component", "bucket_module"),
		app:    app,
		conns:  make(map[string]*S3Conn),

		profile: profileModule,
	}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

func (m *Module) TestConnection(input bucket.ConnectionInput) common.Output[bucket.ConnectionOutput] {
	c := m.buildClient(input)
	status, err := m.probe(m.ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	status.Body.IsConnected = true
	status.AddMessage(common.SuccessMessage(S3_SUCCES_001))
	return status
}

func (m *Module) Connect(input bucket.ConnectionInput) common.Output[bucket.ConnectionOutput] {
	c := m.buildClient(input)
	status, err := m.probe(m.ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	connectionId := utils.GenerateUUID()
	m.conns[connectionId] = c

	status.Body.ConnectionId = connectionId
	status.Body.IsConnected = true
	status.AddMessage(common.SuccessMessage(S3_SUCCES_002))

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
