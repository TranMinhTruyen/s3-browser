import type { ObjectItem } from '@wails/S3Browser/models/bucket';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';

/** State of one tab: profile, current view, folder, selection and detail drawer. */
interface TabDetail {
  profileId?: string | null;
  currentView: 'bucketList' | 'objectList';
  // Bucket shown in the object list. Unset while in the bucket list.
  bucket?: string;
  // Folder shown in the object list, e.g. "photos/2026/". Empty is the bucket root.
  prefix: string;
  selectionItem: string[];
  deletingItems: string[];
  // Object shown in the detail drawer. Unset when the drawer is closed.
  detailItem?: ObjectItem;
}

interface TabListState {
  activeTab: string;
  tabList: Record<string, TabDetail>;
  // Tab whose upload is running. Only one upload runs at a time, across all tabs.
  uploadingTabId: string | null;
}

interface TabListAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  updateTab: (tabId: string, patch: Partial<TabDetail>) => void;
  closeTab: (tabId: string) => void;

  // `bucket` is the bucket to open when switching to the object list.
  changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList', bucket?: string) => void;
  changePrefix: (tabId: string, prefix: string) => void;
  resetViewByProfile: (profileId: string) => void;
  // For a deleted profile: tabs using it go back to the bucket list with no profile.
  clearProfile: (profileId: string) => void;

  addSelectItem: (tabId: string, items: string[]) => void;
  removeSelectItem: (tabId: string, items: string[]) => void;
  clearSelectItem: (tabId: string) => void;

  openDetail: (tabId: string, item: ObjectItem) => void;
  closeDetail: (tabId: string) => void;

  setDeleting: (tabId: string, items: string[], deleting: boolean) => void;
  setUploadingTab: (tabId: string | null) => void;

  reset: () => void;
}

const SCOPE = 'tabList';
const initialId = createUUID();

const newTab = (): TabDetail => ({ currentView: 'bucketList', prefix: '', selectionItem: [], deletingItems: [] });

/** Open tabs, the active one and which tab is uploading. */
export const useTabListStore = createAppStore<TabListState & TabListAction>(
  (set, get) => ({
    activeTab: initialId,
    tabList: {
      [initialId]: newTab(),
    },
    uploadingTabId: null,

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
            [tabId]: newTab(),
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

    changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList', bucket?: string) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            tab.currentView = currentView;
            tab.bucket = currentView === 'objectList' ? bucket : undefined;
            // Opening or leaving a bucket always starts from its root.
            tab.prefix = '';
            tab.selectionItem = [];
            tab.detailItem = undefined;
          }
        },
        undefined,
        `${SCOPE}/changeCurrentView`
      );
    },

    changePrefix: (tabId: string, prefix: string) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            tab.prefix = prefix;
            // Selected keys belong to the previous folder and are no longer visible.
            tab.selectionItem = [];
            tab.detailItem = undefined;
          }
        },
        undefined,
        `${SCOPE}/changePrefix`
      );
    },

    resetViewByProfile: (profileId: string) => {
      set(
        state => {
          Object.values(state.tabList).forEach(tab => {
            if (tab.profileId === profileId) {
              tab.currentView = 'bucketList';
              tab.bucket = undefined;
              tab.prefix = '';
              tab.selectionItem = [];
              tab.detailItem = undefined;
            }
          });
        },
        undefined,
        `${SCOPE}/resetViewByProfile`
      );
    },

    clearProfile: (profileId: string) => {
      set(
        state => {
          Object.values(state.tabList).forEach(tab => {
            if (tab.profileId === profileId) {
              tab.profileId = null;
              tab.currentView = 'bucketList';
              tab.bucket = undefined;
              tab.prefix = '';
              tab.selectionItem = [];
              tab.detailItem = undefined;
            }
          });
        },
        undefined,
        `${SCOPE}/clearProfile`
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

    clearSelectItem: (tabId: string) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) tab.selectionItem = [];
        },
        undefined,
        `${SCOPE}/clearSelectItem`
      );
    },

    openDetail: (tabId: string, item: ObjectItem) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) tab.detailItem = item;
        },
        undefined,
        `${SCOPE}/openDetail`
      );
    },

    closeDetail: (tabId: string) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) tab.detailItem = undefined;
        },
        undefined,
        `${SCOPE}/closeDetail`
      );
    },

    setDeleting: (tabId: string, items: string[], deleting: boolean) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (!tab) return;
          if (deleting) {
            tab.deletingItems = [...new Set([...tab.deletingItems, ...items])];
          } else {
            const removing = new Set(items);
            tab.deletingItems = tab.deletingItems.filter(item => !removing.has(item));
          }
        },
        undefined,
        `${SCOPE}/setDeleting`
      );
    },

    setUploadingTab: (tabId: string | null) => {
      set({ uploadingTabId: tabId }, undefined, `${SCOPE}/setUploadingTab`);
    },

    // uploadingTabId is kept: an upload already sent to the backend keeps running.
    reset: () => {
      invalidateLoads(SCOPE);
      const id = createUUID();
      set({ activeTab: id, tabList: { [id]: newTab() } }, undefined, `${SCOPE}/reset`);
    },
  }),
  SCOPE
);
