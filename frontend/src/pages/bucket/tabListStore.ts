import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';

interface TabListState {
  activeTab: string;
  tabList: Record<string, string | null | undefined>;
}

interface TabListAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  updateTab: (tabId: string, profileId?: string | null) => void;
  closeTab: (tabId: string) => void;
  reset: () => void;
}

const SCOPE = 'tabList';
const initialId = createUUID();

export const useTabListStore = createAppStore<TabListState & TabListAction>(
  (set, get) => ({
    activeTab: initialId,
    tabList: { [initialId]: '' },

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
            [tabId]: {} as ConnectionProfileOutput,
          },
          activeTab: tabId,
        }),
        undefined,
        `${SCOPE}/addTab`
      );
    },

    updateTab: (tabId: string, profileId?: string | null) => {
      set(
        state => {
          state.tabList[tabId] = profileId;
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

    reset: () => {
      invalidateLoads(SCOPE);
      const id = createUUID();
      set({ activeTab: id, tabList: { [id]: '' } }, undefined, `${SCOPE}/reset`);
    },
  }),
  SCOPE
);
