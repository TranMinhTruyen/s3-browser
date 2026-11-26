import type { TreeNodeData } from '@mantine/core';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { buildTreeNodes, isNodeOf, listTableNames, loadSchemas } from '@/pages/sql/utils/dbObjectSource';

/** Cây đối tượng của một profile. `nodes` rỗng cho đến khi `ready`; `tableNames` cung cấp dữ liệu gợi ý SQL. */
type DbTree = {
  status: 'loading' | 'ready' | 'error';
  nodes: TreeNodeData[];
  tableNames: string[];
};

interface DbTreeState {
  /** Các profile đang mở Accordion. */
  opened: Partial<Record<string, true>>;
  trees: Partial<Record<string, DbTree>>;
  /** Các node đang mở rộng, được lập chỉ mục theo giá trị node. Node cấp cao nhất mặc định được mở rộng. */
  expanded: Record<string, boolean>;
  /** Node đang được tô sáng (mỗi lần chỉ có một node trong tất cả profile). */
  selected: string | null;
}

interface DbTreeAction {
  /** Mở Accordion của profile đã kết nối và tải cây một lần (nếu lần trước thất bại thì thử lại). */
  openProfile: (profileId: string) => Promise<void>;
  /** Tải lại cây của profile đã kết nối (dừng lượt tải đang chạy); giữ các node đang mở rộng/chọn nếu chúng vẫn tồn tại. */
  refreshProfile: (profileId: string) => Promise<void>;
  closeProfile: (profileId: string) => void;
  toggleProfile: (profileId: string) => void;
  toggleNode: (value: string) => void;
  selectNode: (value: string) => void;
  /** Profile đã ngắt kết nối hoặc bị xóa: đóng Accordion, bỏ cây đối tượng và dừng lượt tải. */
  dropProfile: (profileId: string) => void;
  reset: () => void;
}

const SCOPE = 'dbTree';

/** Các lượt tải cây đang chạy để thao tác xóa có thể dừng chúng. */
const loads = new Map<string, AbortController>();

/** Cây đối tượng của các profile database đã kết nối (state Accordion, node đã tải, node mở rộng và node được chọn). */
export const useDbTreeStore = createAppStore<DbTreeState & DbTreeAction>((set, get) => {
  /** Tải cây của profile đã kết nối vào `trees`; lượt tải mới hơn hoặc thao tác xóa sẽ hủy lượt tải này. */
  const loadTree = async (profile: DbProfile) => {
    const profileId = profile.id;
    const controller = new AbortController();
    loads.set(profileId, controller);
    const schemas = await loadSchemas(profile.provider, profileId, controller.signal, `${SCOPE}/load/${profileId}`);
    if (controller.signal.aborted) return;

    loads.delete(profileId);
    const database = profile.provider === 'sqlite' ? null : (profile.config.database ?? '');
    const nodes = schemas ? buildTreeNodes(profileId, database, schemas) : [];
    set(
      state => {
        // Làm mới sẽ giữ trạng thái mở rộng của các node vẫn còn tồn tại.
        for (const node of nodes) state.expanded[node.value] ??= true;
        state.trees[profileId] = {
          status: schemas ? 'ready' : 'error',
          nodes,
          tableNames: schemas ? listTableNames(schemas) : [],
        };
      },
      undefined,
      `${SCOPE}/loaded`
    );
  };

  return {
    opened: {},
    trees: {},
    expanded: {},
    selected: null,

    openProfile: async profileId => {
      const profile = useDbProfileStore.getState().getDbProfileById(profileId);
      if (!profile?.isConnected) return;

      const current = get().trees[profileId];
      const needsLoad = !current || current.status === 'error';
      set(
        state => {
          state.opened[profileId] = true;
          if (needsLoad) state.trees[profileId] = { status: 'loading', nodes: [], tableNames: [] };
        },
        undefined,
        `${SCOPE}/openProfile`
      );
      if (!needsLoad) return;

      await loadTree(profile);
    },

    refreshProfile: async profileId => {
      const profile = useDbProfileStore.getState().getDbProfileById(profileId);
      if (!profile?.isConnected) return;
      loads.get(profileId)?.abort();
      set(
        state => {
          state.trees[profileId] = { status: 'loading', nodes: [], tableNames: [] };
        },
        undefined,
        `${SCOPE}/refreshProfile`
      );
      await loadTree(profile);
    },

    closeProfile: profileId => {
      set(
        state => {
          delete state.opened[profileId];
        },
        undefined,
        `${SCOPE}/closeProfile`
      );
    },

    toggleProfile: profileId => {
      if (get().opened[profileId]) get().closeProfile(profileId);
      else void get().openProfile(profileId);
    },

    toggleNode: value => {
      set(
        state => {
          state.expanded[value] = !state.expanded[value];
        },
        undefined,
        `${SCOPE}/toggleNode`
      );
    },

    selectNode: value => {
      set({ selected: value }, undefined, `${SCOPE}/selectNode`);
    },

    dropProfile: profileId => {
      loads.get(profileId)?.abort();
      loads.delete(profileId);
      set(
        state => {
          delete state.opened[profileId];
          delete state.trees[profileId];
          for (const value of Object.keys(state.expanded)) {
            if (isNodeOf(profileId, value)) delete state.expanded[value];
          }
          if (state.selected && isNodeOf(profileId, state.selected)) state.selected = null;
        },
        undefined,
        `${SCOPE}/dropProfile`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      for (const controller of loads.values()) controller.abort();
      loads.clear();
      set({ opened: {}, trees: {}, expanded: {}, selected: null }, undefined, `${SCOPE}/reset`);
    },
  };
}, 'DbTree');
