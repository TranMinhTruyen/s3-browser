import { CloseDbTab } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { SaveSqlTabStateInput, TabState } from '@wails/S3Browser/models/setting';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { isTableDirty } from '@/pages/sql/utils/dirtyTables';

/** Bảng được hiển thị trong tab `TableStructure`. */
type TabTable = { schema: string; name: string };

/** Metadata của một tab SQL hoặc tab `TableStructure` khi có `table`. */
type SqlTab = {
  profileId: string | null;
  table?: TabTable;
};

interface SqlTabState {
  activeTab: string;
  tabList: Record<string, SqlTab>;
  queryByTab: Record<string, string>;
}

interface SqlTabAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  setQuery: (tabId: string, query: string) => void;
  /** Đóng tab và yêu cầu backend đóng kết nối cơ sở dữ liệu; hỏi xác nhận trước nếu còn thay đổi hàng chưa commit. */
  closeTab: (tabId: string) => void;
  // Di chuyển tab đến vị trí của `overId`. Không thay đổi tab đang hoạt động.
  moveTab: (activeId: string, overId: string) => void;
  /** Mở tab `TableStructure` của một bảng, hoặc chuyển sang tab đó nếu đã mở. */
  openTableTab: (profileId: string, schema: string, name: string) => void;
  /** Đóng các tab `TableStructure` của profile; thêm tab SQL nếu không còn tab nào. */
  closeProfileTables: (profileId: string) => void;
  setTabProfile: (tabId: string, profileId: string | null) => void;
  // Profile đã bị xóa: mọi tab đang dùng profile đó trở về trạng thái "không có profile".
  clearProfile: (profileId: string) => void;
  serializeTabs: () => SaveSqlTabStateInput;
  restoreTabs: (saved: TabState) => void;
  reset: () => void;
}

const SCOPE = 'sqlTab';

/** Không đóng tab cuối cùng; tab không xác định thì không có gì để đóng. */
const canClose = (tabList: Record<string, SqlTab>, tabId: string) =>
  Object.keys(tabList).length > 1 && Object.hasOwn(tabList, tabId);

const newTab = (): SqlTab => ({ profileId: null });

const initialState = (): SqlTabState => {
  const id = createUUID();
  return { activeTab: id, tabList: { [id]: newTab() }, queryByTab: { [id]: '' } };
};

/** Các tab SQL theo thứ tự hiển thị (thứ tự key của object), tab đang hoạt động và profile mỗi tab sử dụng. */
export const useSqlTabStore = createAppStore<SqlTabState & SqlTabAction>((set, get) => {
  /** Xóa tab, kích hoạt tab bên cạnh và đóng kết nối backend của tab đó. */
  const removeTab = (tabId: string) => {
    // Store có thể đã thay đổi trong lúc hộp thoại xác nhận đang mở.
    const { tabList, activeTab } = get();
    if (!canClose(tabList, tabId)) return;
    const keys = Object.keys(tabList);
    const index = keys.indexOf(tabId);
    const nextActiveTab = tabId === activeTab ? (keys[index + 1] ?? keys[index - 1]) : activeTab;
    set(
      state => {
        delete state.tabList[tabId];
        delete state.queryByTab[tabId];
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
        state => ({
          tabList: { ...state.tabList, [tabId]: newTab() },
          queryByTab: { ...state.queryByTab, [tabId]: '' },
          activeTab: tabId,
        }),
        undefined,
        `${SCOPE}/addTab`
      );
    },

    setQuery: (tabId, query) => {
      const { tabList, queryByTab } = get();
      if (!tabList[tabId] || tabList[tabId].table || queryByTab[tabId] === query) return;
      set(
        state => {
          if (state.tabList[tabId] && !state.tabList[tabId].table) state.queryByTab[tabId] = query;
        },
        undefined,
        `${SCOPE}/setQuery`
      );
    },

    closeTab: tabId => {
      if (!canClose(get().tabList, tabId)) return;
      if (!isTableDirty(tabId)) {
        removeTab(tabId);
        return;
      }
      // Còn thay đổi hàng chưa commit thì hỏi trước. Hàm này không tự bất đồng bộ nên tab không có thay đổi vẫn đóng đồng bộ.
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
      // Tạo lại object vì thứ tự key chính là thứ tự tab.
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
        state => ({
          tabList: { ...state.tabList, [tabId]: { profileId, table: { schema, name } } },
          queryByTab: { ...state.queryByTab, [tabId]: '' },
          activeTab: tabId,
        }),
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
      // Tab đang hoạt động chuyển sang tab còn lại gần nhất; tab SQL mới chỉ được kích hoạt nếu không còn tab nào.
      const index = keys.indexOf(activeTab);
      const nextActiveTab = closed.has(activeTab)
        ? (keys.slice(index + 1).find(key => !closed.has(key)) ??
          keys.slice(0, index).findLast(key => !closed.has(key)) ??
          (sqlTabId as string))
        : activeTab;
      set(
        state => {
          for (const key of closed) {
            delete state.tabList[key];
            delete state.queryByTab[key];
          }
          if (sqlTabId) {
            state.tabList[sqlTabId] = newTab();
            state.queryByTab[sqlTabId] = '';
          }
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
      // Kết nối backend thuộc profile cũ; xóa nó để tab mở kết nối mới.
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

    serializeTabs: () => {
      const { tabList, activeTab, queryByTab } = get();
      return {
        tabs: Object.entries(tabList).map(([id, tab]) => ({
          id,
          profileId: tab.profileId,
          query: queryByTab[id] ?? '',
          ...(tab.table ? { table: { ...tab.table } } : {}),
        })),
        activeTab,
      };
    },

    restoreTabs: saved => {
      const tabs = (saved.sqlTabs ?? []).filter(tab => tab.id);
      if (tabs.length === 0 || new Set(tabs.map(tab => tab.id)).size !== tabs.length) return;

      const tabList: Record<string, SqlTab> = {};
      const queryByTab: Record<string, string> = {};
      tabs.forEach(tab => {
        tabList[tab.id] = {
          profileId: tab.profileId ?? null,
          ...(tab.table ? { table: { ...tab.table } } : {}),
        };
        queryByTab[tab.id] = tab.query ?? '';
      });
      const activeTab =
        saved.activeSqlTab && Object.hasOwn(tabList, saved.activeSqlTab) ? saved.activeSqlTab : tabs[0].id;
      set({ tabList, activeTab, queryByTab }, undefined, `${SCOPE}/restoreTabs`);
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(initialState(), undefined, `${SCOPE}/reset`);
    },
  };
}, 'SqlTab');
