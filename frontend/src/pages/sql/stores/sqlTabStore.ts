import { CloseDbTab } from '@wails/S3Browser/internal/handlers/dbhandler';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { isTableDirty } from '@/pages/sql/utils/dirtyTables';

/** The table shown by a `TableStructure` tab. */
type TabTable = { schema: string; name: string };

/** Metadata of one tab: a SQL tab, or a `TableStructure` tab when `table` is set. The editor content lives in the editor. */
type SqlTab = {
  profileId: string | null;
  table?: TabTable;
};

interface SqlTabState {
  activeTab: string;
  tabList: Record<string, SqlTab>;
}

interface SqlTabAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  /** Closes the tab and tells the backend to close its database connection; asks first when it has uncommitted row changes. */
  closeTab: (tabId: string) => void;
  // Move a tab to the position of `overId`. Does not change the active tab.
  moveTab: (activeId: string, overId: string) => void;
  /** Opens the `TableStructure` tab of a table, or switches to it when it is already open. */
  openTableTab: (profileId: string, schema: string, name: string) => void;
  /** Closes the `TableStructure` tabs of a profile; a SQL tab is added when none is left. */
  closeProfileTables: (profileId: string) => void;
  setTabProfile: (tabId: string, profileId: string | null) => void;
  // A profile was deleted: every tab using it goes back to "no profile".
  clearProfile: (profileId: string) => void;
  reset: () => void;
}

const SCOPE = 'sqlTab';

/** The last tab never closes, and an unknown tab has nothing to close. */
const canClose = (tabList: Record<string, SqlTab>, tabId: string) =>
  Object.keys(tabList).length > 1 && Object.hasOwn(tabList, tabId);

const newTab = (): SqlTab => ({ profileId: null });

const initialState = (): SqlTabState => {
  const id = createUUID();
  return { activeTab: id, tabList: { [id]: newTab() } };
};

/** SQL tabs in display order (object key order), the active tab and the profile each tab uses. */
export const useSqlTabStore = createAppStore<SqlTabState & SqlTabAction>((set, get) => {
  /** Removes the tab, activates its neighbour and closes its backend connection. */
  const removeTab = (tabId: string) => {
    // The store may have changed while a question was open.
    const { tabList, activeTab } = get();
    if (!canClose(tabList, tabId)) return;
    const keys = Object.keys(tabList);
    const index = keys.indexOf(tabId);
    const nextActiveTab = tabId === activeTab ? (keys[index + 1] ?? keys[index - 1]) : activeTab;
    set(
      state => {
        delete state.tabList[tabId];
        state.activeTab = nextActiveTab;
      },
      undefined,
      `${SCOPE}/closeTab`
    );
    void callIPC(CloseDbTab, [{ tabId }]);
  };

  return {
    ...initialState(),

    setActiveTab: tabId => {
      if (!tabId) return;
      set({ activeTab: tabId }, undefined, `${SCOPE}/setActiveTab`);
    },

    addTab: () => {
      const tabId = createUUID();
      set(
        state => ({ tabList: { ...state.tabList, [tabId]: newTab() }, activeTab: tabId }),
        undefined,
        `${SCOPE}/addTab`
      );
    },

    closeTab: tabId => {
      if (!canClose(get().tabList, tabId)) return;
      if (!isTableDirty(tabId)) {
        removeTab(tabId);
        return;
      }
      // Uncommitted row changes: ask first. Not async itself, so a tab without changes still closes synchronously.
      const name = get().tabList[tabId].table?.name;
      void ConfirmModal.show({ type: 'warning', confirmCode: 'C000012', params: { table: name } }).then(confirmed => {
        if (confirmed) removeTab(tabId);
      });
    },

    moveTab: (activeId, overId) => {
      const { tabList } = get();
      const keys = Object.keys(tabList);
      const from = keys.indexOf(activeId);
      const to = keys.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;

      keys.splice(to, 0, ...keys.splice(from, 1));
      // Rebuild the object: key order is the tab order.
      set({ tabList: Object.fromEntries(keys.map(k => [k, tabList[k]])) }, undefined, `${SCOPE}/moveTab`);
    },

    openTableTab: (profileId, schema, name) => {
      const { tabList } = get();
      const existing = Object.keys(tabList).find(key => {
        const tab = tabList[key];
        return tab.profileId === profileId && tab.table?.schema === schema && tab.table.name === name;
      });
      if (existing) {
        set({ activeTab: existing }, undefined, `${SCOPE}/openTableTab`);
        return;
      }
      const tabId = createUUID();
      set(
        state => ({ tabList: { ...state.tabList, [tabId]: { profileId, table: { schema, name } } }, activeTab: tabId }),
        undefined,
        `${SCOPE}/openTableTab`
      );
    },

    closeProfileTables: profileId => {
      const { tabList, activeTab } = get();
      const keys = Object.keys(tabList);
      const closed = new Set(keys.filter(key => tabList[key].profileId === profileId && tabList[key].table));
      if (closed.size === 0) return;

      const kept = keys.filter(key => !closed.has(key));
      const sqlTabId = kept.some(key => !tabList[key].table) ? null : createUUID();
      // The active tab goes to its nearest neighbour that stays; the new SQL tab only takes over when none stays.
      const index = keys.indexOf(activeTab);
      const nextActiveTab = closed.has(activeTab)
        ? (keys.slice(index + 1).find(key => !closed.has(key)) ??
          keys.slice(0, index).findLast(key => !closed.has(key)) ??
          (sqlTabId as string))
        : activeTab;
      set(
        state => {
          for (const key of closed) delete state.tabList[key];
          if (sqlTabId) state.tabList[sqlTabId] = newTab();
          state.activeTab = nextActiveTab;
        },
        undefined,
        `${SCOPE}/closeProfileTables`
      );
      for (const tabId of closed) void callIPC(CloseDbTab, [{ tabId }]);
    },

    setTabProfile: (tabId, profileId) => {
      const previous = get().tabList[tabId]?.profileId;
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) tab.profileId = profileId;
        },
        undefined,
        `${SCOPE}/setTabProfile`
      );
      // The backend connection belongs to the old profile; drop it so the tab opens a new one.
      if (previous && previous !== profileId) void callIPC(CloseDbTab, [{ tabId }]);
    },

    clearProfile: profileId => {
      set(
        state => {
          for (const tab of Object.values(state.tabList)) {
            if (tab.profileId === profileId) tab.profileId = null;
          }
        },
        undefined,
        `${SCOPE}/clearProfile`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(initialState(), undefined, `${SCOPE}/reset`);
    },
  };
}, 'SqlTab');
