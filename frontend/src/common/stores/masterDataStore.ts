import { GetMasterData, GetRegionData } from '@wails/S3Browser/internal/handlers/masterhandler';
import { MasterOutput } from '@wails/S3Browser/models/master';
import { createStore } from '@/common/stores/createStore';
import { callIPC } from '@/common/utils/ipcUtils';

const MASTER_CODE = {
  REGION: 'REGION',
} as const;

type MasterCode = (typeof MASTER_CODE)[keyof typeof MASTER_CODE];

type MasterData = Partial<Record<MasterCode, MasterOutput[]>>;

interface MasterDataState {
  masterData: MasterData;
  regionData: Partial<Record<string, MasterOutput[]>>;

  /** Replaces the rows held for one master code. */
  set: (key: MasterCode, datas: MasterOutput[]) => void;
  /** Merges a whole `{ code: rows }` payload, keeping codes it does not carry. */
  setAll: (datas: MasterData) => void;
  /** Rows of one master code, empty when it has not been loaded yet. */
  get: (key: MasterCode) => MasterOutput[];
  /** Fetches the given master codes from the backend and stores them. */
  load: (keys: MasterCode[]) => Promise<void>;
  /** Fetches every known master code. */
  loadAll: () => Promise<void>;
  /** Same as `load`, but skips the codes already in the store. */
  loadMissing: (keys: MasterCode[]) => Promise<void>;
  reset: () => boolean;

  /** Region master data */
  loadRegion: () => Promise<void>;
  getRegion: () => Partial<Record<string, MasterOutput[]>>;
}

const SCOPE = 'MasterData';

export const useMasterDataStore = createStore<MasterDataState>(
  (set, get) => ({
    masterData: {},
    regionData: {},

    set: (key, datas) => {
      set(
        state => ({
          masterData: { ...state.masterData, [key]: datas },
        }),
        undefined,
        `${SCOPE}/set`
      );
    },

    setAll: datas => {
      set(
        state => ({
          masterData: { ...state.masterData, ...datas },
        }),
        undefined,
        `${SCOPE}/setAll`
      );
    },

    get: key => {
      return get().masterData[key] ?? [];
    },

    loadAll: async () => {
      await get().loadRegion();
    },

    loadMissing: async keys => {
      const { masterData, load } = get();
      await load(keys.filter(key => masterData[key] === undefined));
    },

    load: async keys => {
      if (keys.length === 0) {
        return;
      }

      const output = await callIPC(() => GetMasterData(keys), `${SCOPE}/load`);
      if (!output) {
        return;
      }

      get().setAll(output.masterData as MasterData);
    },

    reset: () => {
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
      const output = await callIPC(() => GetRegionData(), `${SCOPE}/loadRegion`);
      if (!output) {
        return;
      }

      set(
        state => ({
          regionData: { ...state.regionData, ...output.regionData },
        }),
        undefined,
        `${SCOPE}/loadRegion`
      );
    },

    getRegion: () => {
      return get().regionData;
    },
  }),
  SCOPE
);
