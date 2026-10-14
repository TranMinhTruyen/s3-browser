import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';

interface TabDetail {
  profileId?: string | null;
  currentView: 'bucketList' | 'objectList';
  selectionItem: string[];
  nextCursor: string;
}

interface TabListState {
  activeTab: string;
  tabList: Record<string, TabDetail>;
}

interface TabListAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  updateTab: (tabId: string, patch: Partial<TabDetail>) => void;
  closeTab: (tabId: string) => void;

  changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList') => void;
  resetViewByProfile: (profileId: string) => void;

  addSelectItem: (tabId: string, items: string[]) => void;
  removeSelectItem: (tabId: string, items: string[]) => void;

  reset: () => void;
}

const SCOPE = 'tabList';
const initialId = createUUID();

export const useTabListStore = createAppStore<TabListState & TabListAction>(
  (set, get) => ({
    activeTab: initialId,
    tabList: {
      [initialId]: {
        currentView: 'bucketList',
        selectionItem: [],
        nextCursor: '',
      },
    },

    setActiveTab: (tabId: string | null) => {
      if (!tabId) return;
      set({ activeTab: tabId }, undefined, `${SCOPE}/setActiveTab`);
    },

    addTab: () => {
      const tabId = createUUID();
      set(
        state => ({
          tabList: {
            ...state.tabList,
            [tabId]: { currentView: 'bucketList', selectionItem: [], nextCursor: '' },
          },
          activeTab: tabId,
        }),
        undefined,
        `${SCOPE}/addTab`
      );
    },

    updateTab: (tabId: string, patch: Partial<TabDetail>) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) Object.assign(tab, patch);
        },
        undefined,
        `${SCOPE}/updateTab`
      );
    },

    closeTab: tabId => {
      const { tabList, activeTab } = get();

      const keys = Object.keys(tabList);
      if (keys.length <= 1 || !(tabId in tabList)) return;

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

    changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList') => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            tab.currentView = currentView;
            tab.selectionItem = [];
            tab.nextCursor = '';
          }
        },
        undefined,
        `${SCOPE}/changeCurrentView`
      );
    },

    resetViewByProfile: (profileId: string) => {
      set(
        state => {
          Object.values(state.tabList).forEach(tab => {
            if (tab.profileId === profileId) {
              tab.currentView = 'bucketList';
              tab.selectionItem = [];
              tab.nextCursor = '';
            }
          });
        },
        undefined,
        `${SCOPE}/resetViewByProfile`
      );
    },

    addSelectItem: (tabId: string, items: string[]) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            tab.selectionItem = [...new Set([...tab.selectionItem, ...items])];
          }
        },
        undefined,
        `${SCOPE}/addSelectItem`
      );
    },

    removeSelectItem: (tabId: string, items: string[]) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            const removing = new Set(items);
            tab.selectionItem = tab.selectionItem.filter(item => !removing.has(item));
          }
        },
        undefined,
        `${SCOPE}/removeSelectItem`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      const id = createUUID();
      set(
        { activeTab: id, tabList: { [id]: { currentView: 'bucketList', selectionItem: [], nextCursor: '' } } },
        undefined,
        `${SCOPE}/reset`
      );
    },
  }),
  SCOPE
);

export const selectActiveTab = (s: TabListState) => s.tabList[s.activeTab];
