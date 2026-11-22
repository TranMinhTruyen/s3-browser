import type { TreeNodeData } from '@mantine/core';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { buildTreeNodes, isNodeOf, listTableNames, loadSchemas } from '@/pages/sql/utils/dbObjectSource';

/** The object tree of one profile. `nodes` is empty until `ready`; `tableNames` feeds SQL autocomplete. */
type DbTree = {
  status: 'loading' | 'ready' | 'error';
  nodes: TreeNodeData[];
  tableNames: string[];
};

interface DbTreeState {
  /** Profiles whose Accordion is open. */
  opened: Partial<Record<string, true>>;
  trees: Partial<Record<string, DbTree>>;
  /** Expanded nodes by node value. The top nodes of a tree start expanded. */
  expanded: Record<string, boolean>;
  /** The highlighted node (one at a time, across all profiles). */
  selected: string | null;
}

interface DbTreeAction {
  /** Opens the Accordion of a connected profile and loads its tree once (an earlier failure is retried). */
  openProfile: (profileId: string) => Promise<void>;
  /** Reloads the tree of a connected profile (stops a load in flight); expanded and selected nodes that still exist stay. */
  refreshProfile: (profileId: string) => Promise<void>;
  closeProfile: (profileId: string) => void;
  toggleProfile: (profileId: string) => void;
  toggleNode: (value: string) => void;
  selectNode: (value: string) => void;
  /** The profile was disconnected or deleted: closes its Accordion, drops its tree and stops its load. */
  dropProfile: (profileId: string) => void;
  reset: () => void;
}

const SCOPE = 'dbTree';

/** Tree loads in flight, so a drop can stop them. */
const loads = new Map<string, AbortController>();

/** Object trees (Accordion state, loaded nodes, expanded and selected nodes) of the connected database profiles. */
export const useDbTreeStore = createAppStore<DbTreeState & DbTreeAction>((set, get) => {
  /** Loads the tree of a connected profile into `trees`; a newer load or a drop aborts it. */
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
        // A refresh keeps the expanded state of the nodes that still exist.
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
