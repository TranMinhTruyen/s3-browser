package db

import (
	"S3Browser/internal/pkg/cnst"
	"S3Browser/internal/pkg/db/sqlc"
	"S3Browser/models"
	"context"
	"errors"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// errNotConnected means the profile of a request has no main connection.
var errNotConnected = errors.New("profile is not connected")

// errTabClosed means the tab was closed while its connection was opening.
var errTabClosed = errors.New("tab was closed")

// mainConn is the connection of a connected profile, used for the object tree and table info. It keeps what
// the tab connections need to open the same file.
type mainConn struct {
	connId   uint64
	path     string
	readOnly bool
}

// tabConn is the connection of one tab; the first query of the tab opens it.
type tabConn struct {
	profileId string
	connId    uint64
}

// submoduleConnMng owns the connections: one main connection per connected profile and one per tab.
type submoduleConnMng struct {
	logger *slog.Logger
	app    *application.App
	native *submoduleNativeMng
	q      *sqlc.Queries

	mu    sync.RWMutex
	mains map[string]mainConn
	tabs  map[string]tabConn
	// opening holds the tab connections being opened, per tab; only in-flight opens, so it stays small.
	opening map[string]map[*pendingOpen]struct{}
}

// pendingOpen is one tab connection being opened; closeTab marks it so the open drops what it opened.
// closed is only read and written under submoduleConnMng.mu.
type pendingOpen struct{ closed bool }

// newSubmoduleConnMng creates an empty connection set.
func newSubmoduleConnMng(
	app *application.App,
	logger *slog.Logger,
	native *submoduleNativeMng,
	q *sqlc.Queries,
) *submoduleConnMng {
	return &submoduleConnMng{
		logger: logger.With("submodules", "conn"),
		app:    app,
		native: native,
		q:      q,
		mains:  make(map[string]mainConn),
		tabs:   make(map[string]tabConn),

		opening: make(map[string]map[*pendingOpen]struct{}),
	}
}

// openParams are the params of the native "open" method.
type openParams struct {
	Driver   string `json:"driver"`
	Path     string `json:"path"`
	ReadOnly bool   `json:"readOnly"`
}

// connIdResult is the result of the native "open" method.
type connIdResult struct {
	ConnId uint64 `json:"connId"`
}

// connParams are the params of the native methods that only need a connection.
type connParams struct {
	ConnId uint64 `json:"connId"`
}

// tableInfoParams are the params of the native "tableInfo" method.
type tableInfoParams struct {
	ConnId uint64 `json:"connId"`
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

// open opens a connection to the SQLite file.
func (m *submoduleConnMng) open(ctx context.Context, path string, readOnly bool) (uint64, error) {
	res, err := callNative[connIdResult](ctx, m.native, "open", openParams{"sqlite", path, readOnly})
	return res.ConnId, err
}

// closeConns closes connections that are already out of the maps. Errors are only logged: there is nothing
// to retry. It does not follow the app context, so it still runs at shutdown. Call it without the lock held.
func (m *submoduleConnMng) closeConns(connIds ...uint64) {
	for _, id := range connIds {
		ctx, cancel := context.WithTimeout(context.Background(), metaTimeout)
		if _, err := callNative[struct{}](ctx, m.native, "close", connParams{id}); err != nil {
			m.logger.Warn("close connection failed", "connId", id, "error", err)
		}
		cancel()
	}
}

// connect opens the main connection of the profile. A connected profile is left as it is.
func (m *submoduleConnMng) connect(ctx context.Context, profileId string) models.Output[bool] {
	output := models.NewOutput[bool]()

	if _, connected := m.mainOf(profileId); connected {
		output.Body = true
		return output
	}

	ctx, cancel := withCallContext(ctx, m.app.Context(), metaTimeout)
	defer cancel()

	profile, err := m.q.SelectDbProfileById(ctx, profileId)
	if err != nil {
		logCallFailure(ctx, m.logger, "load db profile failed", err, "profileId", profileId)
		if isCallCanceled(ctx) {
			return output.ThrowError()
		}
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE012, err.Error()))
	}
	// Only SQLite has a native driver so far.
	if profile.Provider != providerSqlite {
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE001, "unsupported provider"))
	}
	cfg, err := parseConfig(profile)
	if err != nil {
		m.logger.Error("read db profile config failed", "profileId", profileId, "error", err)
		return output.ThrowError(models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE012, err.Error()))
	}

	connId, err := m.open(ctx, cfg.FilePath, cfg.ReadOnly)
	if err != nil {
		logCallFailure(ctx, m.logger, "open db failed", err, "profileId", profileId)
		return failCall(ctx, output, err, metaTimeout, map[string]any{"path": cfg.FilePath})
	}

	m.mu.Lock()
	_, raced := m.mains[profileId]
	if !raced {
		m.mains[profileId] = mainConn{connId: connId, path: cfg.FilePath, readOnly: cfg.ReadOnly}
	}
	m.mu.Unlock()
	if raced {
		m.closeConns(connId)
	}

	output.Body = true
	return output
}

// disconnect closes the main connection and the tab connections of the profile.
func (m *submoduleConnMng) disconnect(profileId string) models.Output[bool] {
	output := models.NewOutput[bool]()
	m.closeConns(m.removeProfile(profileId)...)
	output.Body = true
	return output
}

// removeProfile takes the connections of the profile out of the maps and returns their ids to close.
func (m *submoduleConnMng) removeProfile(profileId string) []uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()

	var ids []uint64
	if main, ok := m.mains[profileId]; ok {
		ids = append(ids, main.connId)
		delete(m.mains, profileId)
	}
	for tabId, tab := range m.tabs {
		if tab.profileId == profileId {
			ids = append(ids, tab.connId)
			delete(m.tabs, tabId)
		}
	}
	return ids
}

// closeTab closes the connection of the tab.
func (m *submoduleConnMng) closeTab(tabId string) models.Output[bool] {
	output := models.NewOutput[bool]()

	m.mu.Lock()
	tab, ok := m.tabs[tabId]
	delete(m.tabs, tabId)
	for p := range m.opening[tabId] {
		p.closed = true
	}
	m.mu.Unlock()
	if ok {
		m.closeConns(tab.connId)
	}

	output.Body = true
	return output
}

// closeAll closes every connection.
func (m *submoduleConnMng) closeAll() {
	m.mu.Lock()
	ids := make([]uint64, 0, len(m.mains)+len(m.tabs))
	for _, main := range m.mains {
		ids = append(ids, main.connId)
	}
	for _, tab := range m.tabs {
		ids = append(ids, tab.connId)
	}
	m.mains = make(map[string]mainConn)
	m.tabs = make(map[string]tabConn)
	m.mu.Unlock()

	m.closeConns(ids...)
}

// notConnectedMessage is the DBE014 message of the profile, named by its saved name (the id if unreadable).
func (m *submoduleConnMng) notConnectedMessage(profileId string) models.Message {
	name := profileId
	if profile, err := m.q.SelectDbProfileById(m.app.Context(), profileId); err == nil {
		name = profile.Name
	}
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Db, DBE014, "", map[string]any{"name": name})
}

// closedMessage is the DBE004 message.
func closedMessage() models.Message {
	return models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE004, "")
}

// mainOf returns the main connection of the profile.
func (m *submoduleConnMng) mainOf(profileId string) (mainConn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	main, ok := m.mains[profileId]
	return main, ok
}

// tabOf returns the connection of the tab.
func (m *submoduleConnMng) tabOf(tabId string) (tabConn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tab, ok := m.tabs[tabId]
	return tab, ok
}

// tabConnOf returns the connection id of the tab, opening it on the first use. A tab that moved to another
// profile closes its old connection. errNotConnected means the profile has no main connection; errTabClosed
// means the tab was closed meanwhile (the caller returns Result=false silently).
func (m *submoduleConnMng) tabConnOf(ctx context.Context, profileId, tabId string) (uint64, error) {
	main, connected := m.mainOf(profileId)
	if !connected {
		return 0, errNotConnected
	}
	if tab, ok := m.tabOf(tabId); ok && tab.profileId == profileId {
		return tab.connId, nil
	}

	p := &pendingOpen{}
	m.mu.Lock()
	if m.opening[tabId] == nil {
		m.opening[tabId] = make(map[*pendingOpen]struct{})
	}
	m.opening[tabId][p] = struct{}{}
	m.mu.Unlock()

	connId, err := m.open(ctx, main.path, main.readOnly)

	m.mu.Lock()
	closed := p.closed // set by closeTab while this open was running
	delete(m.opening[tabId], p)
	if len(m.opening[tabId]) == 0 {
		delete(m.opening, tabId)
	}
	if err != nil {
		m.mu.Unlock()
		return 0, err
	}
	_, stillConnected := m.mains[profileId]
	old, hadOld := m.tabs[tabId]
	if stillConnected && !closed {
		m.tabs[tabId] = tabConn{profileId: profileId, connId: connId}
	}
	m.mu.Unlock()

	if closed {
		m.closeConns(connId)
		return 0, errTabClosed
	}
	if !stillConnected {
		m.closeConns(connId)
		return 0, errNotConnected
	}
	if hadOld {
		m.closeConns(old.connId)
	}
	return connId, nil
}

// schemaTree reads the object tree on the main connection.
func (m *submoduleConnMng) schemaTree(ctx context.Context, profileId string) models.Output[models.SchemaTreeOutput] {
	output := models.NewOutput[models.SchemaTreeOutput]()

	main, ok := m.mainOf(profileId)
	if !ok {
		return output.ThrowError(m.notConnectedMessage(profileId))
	}

	ctx, cancel := withCallContext(ctx, m.app.Context(), metaTimeout)
	defer cancel()

	res, err := callNative[models.SchemaTreeOutput](ctx, m.native, "schemaTree", connParams{main.connId})
	if err != nil {
		logCallFailure(ctx, m.logger, "read schema tree failed", err, "profileId", profileId)
		return failCall(ctx, output, err, metaTimeout, nil)
	}
	output.Body = res
	return output
}

// tableInfo reads the structure of a table on the main connection.
func (m *submoduleConnMng) tableInfo(
	ctx context.Context,
	input models.TableInfoInput,
) models.Output[models.TableInfoOutput] {
	output := models.NewOutput[models.TableInfoOutput]()

	main, ok := m.mainOf(input.ProfileId)
	if !ok {
		return output.ThrowError(m.notConnectedMessage(input.ProfileId))
	}

	ctx, cancel := withCallContext(ctx, m.app.Context(), metaTimeout)
	defer cancel()

	res, err := callNative[models.TableInfoOutput](ctx, m.native, "tableInfo",
		tableInfoParams{main.connId, input.Schema, input.Table})
	if err != nil {
		logCallFailure(ctx, m.logger, "read table info failed", err, "profileId", input.ProfileId)
		return failCall(ctx, output, err, metaTimeout, map[string]any{"name": input.Table})
	}
	output.Body = res
	return output
}
