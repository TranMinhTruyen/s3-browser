import type { ObjectItem } from '@wails/S3Browser/models/bucket';
import type { TabState } from '@wails/S3Browser/models/setting';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';

type KeySet = Record<string, true>;

/** State of one tab: profile, current view, folder, selection and detail drawer. */
interface TabDetail {
  profileId?: string | null;
  currentView: 'bucketList' | 'objectList';
  // Bucket shown in the object list. Unset while in the bucket list.
  bucket?: string;
  // Folder shown in the object list, e.g. "photos/2026/". Empty is the bucket root.
  prefix: string;
  // Keys as a set (key -> true): O(1) lookup per row.
  selectionItem: KeySet;
  deletingItems: KeySet;
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
  // Move a tab to the position of `overId`. Does not change the active tab.
  moveTab: (activeId: string, overId: string) => void;

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

  // Tab order, active tab and profile of each tab, in the shape saved to disk.
  serializeTabs: () => TabState;
  // Rebuilds the tabs from the saved layout. Empty or invalid layout keeps the current tabs.
  restoreTabs: (saved: TabState) => void;

  reset: () => void;
}

const SCOPE = 'tabList';
const initialId = createUUID();

/** Back to the bucket list root: no bucket, folder, selection or detail. Call inside an immer `set`. */
const resetTabView = (tab: TabDetail) => {
  tab.currentView = 'bucketList';
  tab.bucket = undefined;
  tab.prefix = '';
  tab.selectionItem = {};
  tab.detailItem = undefined;
};

/** A tab with no profile, showing the bucket list. */
const newTab = (): TabDetail => ({ currentView: 'bucketList', prefix: '', selectionItem: {}, deletingItems: {} });

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

    changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList', bucket?: string) => {
      set(
        state => {
          const tab = state.tabList[tabId];
          if (tab) {
            // Opening or leaving a bucket always starts from its root.
            resetTabView(tab);
            tab.currentView = currentView;
            if (currentView === 'objectList') tab.bucket = bucket;
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
            tab.selectionItem = {};
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
              resetTabView(tab);
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
              resetTabView(tab);
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
            items.forEach(item => {
              tab.selectionItem[item] = true;
            });
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
            items.forEach(item => {
              delete tab.selectionItem[item];
            });
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
          if (tab) tab.selectionItem = {};
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
          items.forEach(item => {
            if (deleting) tab.deletingItems[item] = true;
            else delete tab.deletingItems[item];
          });
        },
        undefined,
        `${SCOPE}/setDeleting`
      );
    },

    setUploadingTab: (tabId: string | null) => {
      set({ uploadingTabId: tabId }, undefined, `${SCOPE}/setUploadingTab`);
    },

    serializeTabs: () => {
      const { tabList, activeTab } = get();
      return {
        tabs: Object.entries(tabList).map(([id, tab]) => ({ id, profileId: tab.profileId ?? null })),
        activeTab,
      };
    },

    restoreTabs: saved => {
      const tabs = (saved.tabs ?? []).filter(tab => tab.id);
      if (tabs.length === 0 || new Set(tabs.map(tab => tab.id)).size !== tabs.length) return;

      const tabList: Record<string, TabDetail> = {};
      tabs.forEach(tab => {
        tabList[tab.id] = { ...newTab(), profileId: tab.profileId };
      });
      const activeTab = Object.hasOwn(tabList, saved.activeTab) ? saved.activeTab : tabs[0].id;
      set({ tabList, activeTab }, undefined, `${SCOPE}/restoreTabs`);
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
