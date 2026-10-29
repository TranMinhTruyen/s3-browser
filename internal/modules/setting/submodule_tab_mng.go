package setting

import (
	"S3Browser/internal/pkg/portable"
	"S3Browser/models"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

const (
	tabsFileName = "tabs.json"
	maxTabs      = 100
)

// submoduleTabMng reads and writes tabs.json in the app data dir.
type submoduleTabMng struct {
	logger  *slog.Logger
	appName string
	mu      sync.Mutex
}

func newSubmoduleTabMng(logger *slog.Logger, appName string) *submoduleTabMng {
	return &submoduleTabMng{logger: logger.With("submodules", "tab_mng"), appName: appName}
}

// emptyTabState is returned when nothing usable is saved.
func emptyTabState() models.TabState {
	return models.TabState{Tabs: []models.TabItem{}}
}

// validateTabState rejects too many tabs, empty or duplicate ids and an active tab outside the list.
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
	return nil
}

// get loads tabs.json. A missing, malformed or invalid file yields an empty state;
// only a real I/O error is returned.
func (m *submoduleTabMng) get() (models.TabState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	path, err := m.path()
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
	return state, nil
}

// save validates then writes tabs.json atomically. The error is invalid when the state itself is wrong.
func (m *submoduleTabMng) save(state models.TabState) (invalid, err error) {
	if invalid = validateTabState(state); invalid != nil {
		return invalid, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	path, err := m.path()
	if err != nil {
		return nil, err
	}
	return nil, writeJSONAtomic(path, state)
}

// path returns the tabs file path, creating the data dir when missing.
func (m *submoduleTabMng) path() (string, error) {
	dir, err := portable.DataDir(m.appName)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, tabsFileName), nil
}
