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

// errNotConnected cho biết hồ sơ trong yêu cầu chưa có kết nối chính.
var errNotConnected = errors.New("profile is not connected")

// errTabClosed cho biết tab đã đóng trong lúc kết nối đang được mở.
var errTabClosed = errors.New("tab was closed")

// mainConn là kết nối của hồ sơ đã kết nối, dùng cho cây đối tượng và thông tin bảng. Giá trị này lưu dữ liệu cần thiết
// để các kết nối tab mở cùng một file.
type mainConn struct {
	connId   uint64
	path     string
	readOnly bool
}

// tabConn là kết nối của một tab; truy vấn đầu tiên trong tab sẽ mở kết nối này.
type tabConn struct {
	profileId string
	connId    uint64
}

// submoduleConnMng quản lý các kết nối: mỗi hồ sơ đã kết nối có một kết nối chính và mỗi tab có một kết nối riêng.
type submoduleConnMng struct {
	logger *slog.Logger
	app    *application.App
	native *submoduleNativeMng
	q      *sqlc.Queries

	mu    sync.RWMutex
	mains map[string]mainConn
	tabs  map[string]tabConn
	// opening lưu các kết nối tab đang được mở, theo từng tab; chỉ lưu thao tác đang chạy nên danh sách luôn nhỏ.
	opening map[string]map[*pendingOpen]struct{}
}

// pendingOpen là một kết nối tab đang được mở; closeTab đánh dấu để thao tác mở tự đóng kết nối vừa tạo.
// Chỉ đọc và ghi closed khi đang giữ submoduleConnMng.mu.
type pendingOpen struct{ closed bool }

// newSubmoduleConnMng tạo kho kết nối rỗng.
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

// openParams là tham số của phương thức native "open".
type openParams struct {
	Driver   string `json:"driver"`
	Path     string `json:"path"`
	ReadOnly bool   `json:"readOnly"`
}

// connIdResult là kết quả của phương thức native "open".
type connIdResult struct {
	ConnId uint64 `json:"connId"`
}

// connParams là tham số của các phương thức native chỉ cần kết nối.
type connParams struct {
	ConnId uint64 `json:"connId"`
}

// tableInfoParams là tham số của phương thức native "tableInfo".
type tableInfoParams struct {
	ConnId uint64 `json:"connId"`
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

// open mở kết nối đến file SQLite.
func (m *submoduleConnMng) open(ctx context.Context, path string, readOnly bool) (uint64, error) {
	res, err := callNative[connIdResult](ctx, m.native, "open", openParams{"sqlite", path, readOnly})
	return res.ConnId, err
}

// closeConns đóng các kết nối đã được gỡ khỏi map. Lỗi chỉ được ghi log vì không có thao tác nào để thử lại.
// Hàm không phụ thuộc context ứng dụng nên vẫn chạy khi tắt ứng dụng. Gọi hàm khi không giữ khóa.
func (m *submoduleConnMng) closeConns(connIds ...uint64) {
	for _, id := range connIds {
		ctx, cancel := context.WithTimeout(context.Background(), metaTimeout)
		if _, err := callNative[struct{}](ctx, m.native, "close", connParams{id}); err != nil {
			m.logger.Warn("close connection failed", "connId", id, "error", err)
		}
		cancel()
	}
}

// connect mở kết nối chính của hồ sơ. Nếu hồ sơ đã kết nối thì giữ nguyên trạng thái hiện tại.
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
	// Hiện tại chỉ SQLite có native driver.
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

// disconnect đóng kết nối chính và các kết nối tab của hồ sơ.
func (m *submoduleConnMng) disconnect(profileId string) models.Output[bool] {
	output := models.NewOutput[bool]()
	m.closeConns(m.removeProfile(profileId)...)
	output.Body = true
	return output
}

// removeProfile gỡ các kết nối của hồ sơ khỏi map và trả về id của chúng để đóng.
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

// closeTab đóng kết nối của tab.
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

// closeAll đóng mọi kết nối.
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

// notConnectedMessage tạo thông báo DBE014 cho hồ sơ, dùng tên đã lưu (hoặc id nếu không đọc được tên).
func (m *submoduleConnMng) notConnectedMessage(profileId string) models.Message {
	name := profileId
	if profile, err := m.q.SelectDbProfileById(m.app.Context(), profileId); err == nil {
		name = profile.Name
	}
	return models.NewParamsMessage(cnst.MessageTypeError, cnst.Db, DBE014, "", map[string]any{"name": name})
}

// closedMessage tạo thông báo DBE004.
func closedMessage() models.Message {
	return models.NewMessage(cnst.MessageTypeError, cnst.Db, DBE004, "")
}

// mainOf trả về kết nối chính của hồ sơ.
func (m *submoduleConnMng) mainOf(profileId string) (mainConn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	main, ok := m.mains[profileId]
	return main, ok
}

// tabOf trả về kết nối của tab.
func (m *submoduleConnMng) tabOf(tabId string) (tabConn, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tab, ok := m.tabs[tabId]
	return tab, ok
}

// tabConnOf trả id kết nối của tab và mở kết nối ở lần dùng đầu tiên. Nếu tab chuyển sang hồ sơ khác, kết nối cũ bị đóng.
// errNotConnected nghĩa là hồ sơ chưa có kết nối chính; errTabClosed nghĩa là tab đã đóng trong lúc chờ
// (bên gọi trả Result=false mà không gửi thông báo).
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

// schemaTree đọc cây đối tượng qua kết nối chính.
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

// tableInfo đọc cấu trúc bảng qua kết nối chính.
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
