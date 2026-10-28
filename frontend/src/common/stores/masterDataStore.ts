import { GetMasterData, GetRegionData } from '@wails/S3Browser/internal/handlers/masterhandler';
import { MasterOutput } from '@wails/S3Browser/models/master';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

const MASTER_CODE = {
  REGION: 'REGION',
} as const;

type MasterCode = (typeof MASTER_CODE)[keyof typeof MASTER_CODE];

type MasterData = Partial<Record<MasterCode, MasterOutput[]>>;

interface MasterDataState {
  masterData: MasterData;
  regionData: Partial<Record<string, MasterOutput[]>>;
}

interface MasterDataAction {
  /** Merges a whole `{ code: rows }` payload, keeping codes it does not carry. */
  setAll: (datas: MasterData) => void;
  /** Fetches the given master codes from the backend and stores them. */
  load: (keys: MasterCode[]) => Promise<void>;
  /** Fetches every known master code. */
  loadAll: () => Promise<void>;
  reset: () => boolean;

  /** Region master data */
  loadRegion: () => Promise<void>;
}

const SCOPE = 'MasterData';

/** Master data (region lists, ...) loaded from the backend. */
export const useMasterDataStore = createAppStore<MasterDataState & MasterDataAction>(
  (set, get) => ({
    masterData: {},
    regionData: {},

    setAll: datas => {
      set(
        state => {
          Object.assign(state.masterData, datas);
        },
        undefined,
        `${SCOPE}/setAll`
      );
    },

    loadAll: async () => {
      await get().loadRegion();
    },

    load: async keys => {
      if (keys.length === 0) {
        return;
      }

      const output = await callIPC(GetMasterData, [keys], { scope: `${SCOPE}/load` });
      if (!output) {
        return;
      }

      get().setAll(output.masterData as MasterData);
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        {
          masterData: {},
          regionData: {},
        },
        undefined,
        `${SCOPE}/reset`
      );
      return true;
    },

    loadRegion: async () => {
      const output = await callIPC(GetRegionData, [], { scope: `${SCOPE}/loadRegion` });
      if (!output) {
        return;
      }

      set(
        state => {
          Object.assign(state.regionData, output.regionData);
        },
        undefined,
        `${SCOPE}/loadRegion`
      );
    },
  }),
  SCOPE
);
