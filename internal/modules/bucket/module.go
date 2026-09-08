package bucket

import (
	"S3Browser/internal/modules/profile"
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/utils"
	"S3Browser/models/bucket"
	"S3Browser/models/common"
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Module struct {
	logger  *slog.Logger
	app     *application.App
	mu      sync.RWMutex
	conns   map[string]*S3Conn
	profile *profile.Module
}

func NewModule(app *application.App, logger *slog.Logger, profileModule *profile.Module) *Module {
	return &Module{
		logger:  logger.With("component", "bucket_module"),
		app:     app,
		conns:   make(map[string]*S3Conn),
		profile: profileModule,
	}
}

func (m *Module) TestConnection(input bucket.ConnectionInput) common.Output[bucket.ConnectionOutput] {
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.buildClient(input)
	status, err := m.probe(ctx, c)

	if err != nil {
		status.Body.IsConnected = false
		return status
	}

	status.Body.IsConnected = true
	status.AddMessage(common.SuccessMessage(cnst.Bucket, S3_SUCCES_001))
	return status
}

func (m *Module) Connect(input bucket.ConnectionInput) common.Output[bucket.ConnectionOutput] {
	// Don't use app.Context for I/O because this context is cancelled only when the app shuts down.
	ctx, cancel := context.WithTimeout(m.app.Context(), 30*time.Second)
	defer cancel()

	c := m.buildClient(input)
	status, err := m.probe(ctx, c)

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
	status.AddMessage(common.SuccessMessage(cnst.Bucket, S3_SUCCES_002))

	if err := m.profile.CreateProfile(connectionId, input); err != nil {
		status.AddMessage(common.ErrorMessage(cnst.Profile, err.Error()))
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
