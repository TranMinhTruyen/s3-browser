package setting

import (
	"S3Browser/models"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
)

const (
	tabsFileName = "tabs.json"
	maxTabs      = 100
)

// submoduleTabMng đọc và ghi tabs.json trong thư mục dữ liệu ứng dụng; mu tuần tự hóa thao tác get và save.
type submoduleTabMng struct {
	logger  *slog.Logger
	appName string
	mu      sync.Mutex
}

func newSubmoduleTabMng(logger *slog.Logger, appName string) *submoduleTabMng {
	return &submoduleTabMng{logger: logger.With("submodules", "tab_mng"), appName: appName}
}

// emptyTabState được trả về nếu không có trạng thái hợp lệ nào được lưu.
func emptyTabState() models.TabState {
	return models.TabState{
		Tabs:    []models.TabItem{},
		SqlTabs: []models.SqlTabItem{},
	}
}

// validateTabState từ chối trạng thái có quá nhiều tab, id rỗng hoặc trùng lặp, hay tab đang hoạt động không nằm trong danh sách.
func validateTabState(s models.TabState) error {
	if len(s.Tabs) > maxTabs {
		return fmt.Errorf("too many tabs: %d (max %d)", len(s.Tabs), maxTabs)
	}
	ids := make(map[string]struct{}, len(s.Tabs))
	for _, tab := range s.Tabs {
		if tab.ID == "" {
			return errors.New("tab id is empty")
		}
		if _, dup := ids[tab.ID]; dup {
			return fmt.Errorf("duplicate tab id %q", tab.ID)
		}
		ids[tab.ID] = struct{}{}
	}
	if _, ok := ids[s.ActiveTab]; len(s.Tabs) > 0 && !ok {
		return fmt.Errorf("active tab %q is not in the tab list", s.ActiveTab)
	}
	if len(s.SqlTabs) > maxTabs {
		return fmt.Errorf("too many SQL tabs: %d (max %d)", len(s.SqlTabs), maxTabs)
	}
	sqlIDs := make(map[string]struct{}, len(s.SqlTabs))
	for _, tab := range s.SqlTabs {
		if tab.ID == "" {
			return errors.New("SQL tab id is empty")
		}
		if _, dup := sqlIDs[tab.ID]; dup {
			return fmt.Errorf("duplicate SQL tab id %q", tab.ID)
		}
		if tab.Table != nil && tab.Table.Name == "" {
			return fmt.Errorf("SQL table tab %q has an empty table name", tab.ID)
		}
		sqlIDs[tab.ID] = struct{}{}
	}
	if _, ok := sqlIDs[s.ActiveSqlTab]; len(s.SqlTabs) > 0 && !ok {
		return fmt.Errorf("active SQL tab %q is not in the SQL tab list", s.ActiveSqlTab)
	}
	return nil
}

// get tải tabs.json. File không tồn tại, sai định dạng hoặc không hợp lệ sẽ trả trạng thái rỗng;
// chỉ lỗi I/O thật sự mới được trả về.
func (m *submoduleTabMng) get() (models.TabState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getLocked()
}

// getLocked đọc tabs.json khi đã giữ mu.
func (m *submoduleTabMng) getLocked() (models.TabState, error) {
	path, err := dataFilePath(m.appName, tabsFileName)
	if err != nil {
		return emptyTabState(), err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return emptyTabState(), nil
	}
	if err != nil {
		return emptyTabState(), err
	}

	var state models.TabState
	if err := json.Unmarshal(data, &state); err != nil {
		m.logger.Warn("tabs file is malformed, using empty state", "path", path, "error", err)
		return emptyTabState(), nil
	}
	if err := validateTabState(state); err != nil {
		m.logger.Warn("tabs file is invalid, using empty state", "path", path, "error", err)
		return emptyTabState(), nil
	}
	if state.Tabs == nil {
		state.Tabs = []models.TabItem{}
	}
	if state.SqlTabs == nil {
		state.SqlTabs = []models.SqlTabItem{}
	}
	return state, nil
}

// save cập nhật bố cục S3, giữ nguyên bố cục SQL rồi ghi tabs.json theo cách nguyên tử.
func (m *submoduleTabMng) save(state models.TabState) (invalid, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	current, err := m.getLocked()
	if err != nil {
		return nil, err
	}
	state.SqlTabs = current.SqlTabs
	state.ActiveSqlTab = current.ActiveSqlTab
	if invalid = validateTabState(state); invalid != nil {
		return invalid, nil
	}
	return nil, m.writeLocked(state)
}

// saveSql cập nhật bố cục SQL, giữ nguyên bố cục S3 rồi ghi tabs.json theo cách nguyên tử.
func (m *submoduleTabMng) saveSql(input models.SaveSqlTabStateInput) (invalid, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, err := m.getLocked()
	if err != nil {
		return nil, err
	}
	state.SqlTabs = input.Tabs
	state.ActiveSqlTab = input.ActiveTab
	if invalid = validateTabState(state); invalid != nil {
		return invalid, nil
	}
	return nil, m.writeLocked(state)
}

// writeLocked ghi trạng thái đã kiểm tra khi đã giữ mu.
func (m *submoduleTabMng) writeLocked(state models.TabState) error {
	path, err := dataFilePath(m.appName, tabsFileName)
	if err != nil {
		return err
	}
	return writeJSONAtomic(path, state)
}
