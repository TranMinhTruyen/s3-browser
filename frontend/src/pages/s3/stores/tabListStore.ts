import { Bucket, type ObjectItem } from '@wails/S3Browser/models/bucket';
import type { TabState } from '@wails/S3Browser/models/setting';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';
import { buildTabState } from '@/pages/s3/utils/tabState';

type KeySet = Record<string, true>;

/** Trạng thái của một tab: hồ sơ, chế độ xem, thư mục, lựa chọn và drawer chi tiết. */
interface TabDetail {
  profileId?: string | null;
  currentView: 'bucketList' | 'objectList';
  // Bucket đang hiển thị trong danh sách object. Không đặt khi đang ở danh sách bucket.
  bucket?: string;
  // Thư mục đang hiển thị trong danh sách object, ví dụ "photos/2026/". Rỗng nghĩa là gốc bucket.
  prefix: string;
  // Các key được lưu dưới dạng set (key -> true): tra cứu mỗi hàng trong O(1).
  selectionItem: KeySet;
  deletingItems: KeySet;
  // Object đang hiển thị trong drawer chi tiết. Không đặt khi drawer đóng.
  detailItem?: ObjectItem;
  // Bucket đang hiển thị trong drawer chi tiết. Không đặt khi drawer đóng.
  detailBucket?: Bucket;
}

interface TabListState {
  activeTab: string;
  tabList: Record<string, TabDetail>;
  // Tab đang chạy lượt tải lên. Chỉ một lượt tải lên chạy tại một thời điểm trên mọi tab.
  uploadingTabId: string | null;
}

interface TabListAction {
  setActiveTab: (tabId: string | null) => void;
  addTab: () => void;
  updateTab: (tabId: string, patch: Partial<TabDetail>) => void;
  closeTab: (tabId: string) => void;
  // Di chuyển tab đến vị trí của `overId`. Không đổi tab đang hoạt động.
  moveTab: (activeId: string, overId: string) => void;

  // `bucket` là bucket cần mở khi chuyển sang danh sách object.
  changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList', bucket?: string) => void;
  changePrefix: (tabId: string, prefix: string) => void;
  resetViewByProfile: (profileId: string) => void;
  // Khi xóa hồ sơ: các tab đang dùng hồ sơ đó quay về danh sách bucket và bỏ hồ sơ.
  clearProfile: (profileId: string) => void;

  addSelectItem: (tabId: string, items: string[]) => void;
  removeSelectItem: (tabId: string, items: string[]) => void;
  clearSelectItem: (tabId: string) => void;

  openDetail: (tabId: string, item: ObjectItem) => void;
  closeDetail: (tabId: string) => void;
  openBucketDetail: (tabId: string, bucket: Bucket) => void;
  closeBucketDetail: (tabId: string) => void;
  // Sau khi lưu policy của bucket: đồng bộ drawer chi tiết đang mở.
  setBucketDetailPolicyMode: (tabId: string, bucket: string, mode: string) => void;
  // Khi xóa bucket: các tab của hồ sơ đang ở bucket đó quay về danh sách bucket và drawer chi tiết đóng lại.
  removeBucket: (profileId: string, bucket: string) => void;

  setDeleting: (tabId: string, items: string[], deleting: boolean) => void;
  setUploadingTab: (tabId: string | null) => void;

  // Thứ tự tab, tab đang hoạt động và hồ sơ của từng tab, theo cấu trúc được lưu xuống đĩa.
  serializeTabs: () => TabState;
  // Tạo lại tab từ bố cục đã lưu. Bố cục rỗng hoặc không hợp lệ sẽ giữ nguyên các tab hiện tại.
  restoreTabs: (saved: TabState) => void;

  reset: () => void;
}

const SCOPE = 'tabList';
const initialId = createUUID();

/** Quay về gốc danh sách bucket: không có bucket, thư mục, lựa chọn hoặc chi tiết. Gọi bên trong `set` của immer. */
const resetTabView = (tab: TabDetail) => {
  tab.currentView = 'bucketList';
  tab.bucket = undefined;
  tab.prefix = '';
  tab.selectionItem = {};
  tab.detailItem = undefined;
  tab.detailBucket = undefined;
};

/** Tab chưa có hồ sơ, đang hiển thị danh sách bucket. */
const newTab = (): TabDetail => ({ currentView: 'bucketList', prefix: '', selectionItem: {}, deletingItems: {} });

/** Các tab đang mở, tab hoạt động và tab đang tải lên. */
export const useTabListStore = createAppStore<TabListState & TabListAction>((set, get) => {
  // Chỉnh sửa một tab bên trong `set` của immer; không làm gì nếu tab không còn tồn tại.
  const editTab = (action: keyof TabListAction, tabId: string, edit: (tab: TabDetail) => void) =>
    set(
      state => {
        const tab = state.tabList[tabId];
        if (tab) edit(tab);
      },
      undefined,
      `${SCOPE}/${action}`
    );

  return {
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
      editTab('updateTab', tabId, tab => Object.assign(tab, patch));
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
      // Tạo lại object: thứ tự key cũng là thứ tự tab.
      set({ tabList: Object.fromEntries(keys.map(k => [k, tabList[k]])) }, undefined, `${SCOPE}/moveTab`);
    },

    changeCurrentView: (tabId: string, currentView: 'bucketList' | 'objectList', bucket?: string) => {
      editTab('changeCurrentView', tabId, tab => {
        // Mở hoặc rời bucket luôn bắt đầu từ thư mục gốc.
        resetTabView(tab);
        tab.currentView = currentView;
        if (currentView === 'objectList') tab.bucket = bucket;
      });
    },

    changePrefix: (tabId: string, prefix: string) => {
      editTab('changePrefix', tabId, tab => {
        tab.prefix = prefix;
        // Các key đã chọn thuộc thư mục trước và không còn hiển thị.
        tab.selectionItem = {};
        tab.detailItem = undefined;
      });
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
      editTab('addSelectItem', tabId, tab => {
        items.forEach(item => {
          tab.selectionItem[item] = true;
        });
      });
    },

    removeSelectItem: (tabId: string, items: string[]) => {
      editTab('removeSelectItem', tabId, tab => {
        items.forEach(item => {
          delete tab.selectionItem[item];
        });
      });
    },

    clearSelectItem: (tabId: string) => {
      editTab('clearSelectItem', tabId, tab => {
        tab.selectionItem = {};
      });
    },

    openDetail: (tabId: string, item: ObjectItem) => {
      editTab('openDetail', tabId, tab => {
        tab.detailItem = item;
      });
    },

    closeDetail: (tabId: string) => {
      editTab('closeDetail', tabId, tab => {
        tab.detailItem = undefined;
      });
    },

    openBucketDetail: (tabId: string, bucket: Bucket) => {
      editTab('openBucketDetail', tabId, tab => {
        tab.detailBucket = bucket;
      });
    },

    closeBucketDetail: (tabId: string) => {
      editTab('closeBucketDetail', tabId, tab => {
        tab.detailBucket = undefined;
      });
    },

    setBucketDetailPolicyMode: (tabId: string, bucket: string, mode: string) => {
      editTab('setBucketDetailPolicyMode', tabId, tab => {
        // Bucket là instance của class (immer không tạo draft): thay thế nó để subscriber nhận được tham chiếu mới.
        if (tab.detailBucket?.name === bucket) tab.detailBucket = new Bucket({ ...tab.detailBucket, policyMode: mode });
      });
    },

    removeBucket: (profileId: string, bucket: string) => {
      set(
        state => {
          Object.values(state.tabList).forEach(tab => {
            if (tab.profileId !== profileId) return;
            if (tab.currentView === 'objectList' && tab.bucket === bucket) resetTabView(tab);
            else if (tab.detailBucket?.name === bucket) tab.detailBucket = undefined;
          });
        },
        undefined,
        `${SCOPE}/removeBucket`
      );
    },

    setDeleting: (tabId: string, items: string[], deleting: boolean) => {
      editTab('setDeleting', tabId, tab => {
        items.forEach(item => {
          if (deleting) tab.deletingItems[item] = true;
          else delete tab.deletingItems[item];
        });
      });
    },

    setUploadingTab: (tabId: string | null) => {
      set({ uploadingTabId: tabId }, undefined, `${SCOPE}/setUploadingTab`);
    },

    serializeTabs: () => {
      const { tabList, activeTab } = get();
      return buildTabState(
        activeTab,
        Object.entries(tabList).map(([id, tab]) => [id, tab.profileId])
      );
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

    // Giữ uploadingTabId: lượt tải đã gửi đến backend vẫn tiếp tục chạy.
    reset: () => {
      invalidateLoads(SCOPE);
      const id = createUUID();
      set({ activeTab: id, tabList: { [id]: newTab() } }, undefined, `${SCOPE}/reset`);
    },
  };
}, SCOPE);
