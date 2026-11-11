import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';

/** Metadata of one SQL tab. The editor content lives in the editor itself, not here. */
type SqlTab = {
  profileId: string | null;
};

interface SqlTabState {
  activeTab: string;
  tabList: Record<string, SqlTab>;
}

interface SqlTabAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  // Move a tab to the position of `overId`. Does not change the active tab.
  moveTab: (activeId: string, overId: string) => void;
  setTabProfile: (tabId: string, profileId: string | null) => void;
  // A profile was deleted: every tab using it goes back to "no profile".
  clearProfile: (profileId: string) => void;
  reset: () => void;
}

const SCOPE = 'sqlTab';

const newTab = (): SqlTab => ({ profileId: null });

const initialState = (): SqlTabState => {
  const id = createUUID();
  return { activeTab: id, tabList: { [id]: newTab() } };
};

/** SQL tabs in display order (object key order), the active tab and the profile each tab uses. */
export const useSqlTabStore = createAppStore<SqlTabState & SqlTabAction>(
  (set, get) => ({
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
      const { tabList, activeTab } = get();
      const keys = Object.keys(tabList);
      if (keys.length <= 1 || !Object.hasOwn(tabList, tabId)) return;

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

    setTabProfile: (tabId, profileId) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) tab.profileId = profileId;
        },
        undefined,
        `${SCOPE}/setTabProfile`
      );
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
  }),
  'SqlTab'
);
