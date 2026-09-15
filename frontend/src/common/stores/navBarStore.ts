import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models/profile/models';
import { createStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

interface NavBarState {
  leftNavbarWidth: number;
  connectionProfiles: Partial<Record<string, ConnectionProfileOutput>>;

  setConnectionProfiles: (datas: Partial<Record<string, ConnectionProfileOutput>>) => void;
  loadConnectionProfiles: () => Promise<void>;
  getConnectionProfiles: () => Partial<Record<string, ConnectionProfileOutput>>;
  updateConnectionProfiles: (key: string, data: ConnectionProfileOutput) => void;
  deleteConnectionProfiles: (key: string) => void;

  setLeftNavbarWidth: (width: number) => void;
  getLeftNavbarWidth: () => number;

  reset: () => void;
}

const SCOPE = 'NavBar';
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 480;

export const useNavBarStore = createStore<NavBarState>(
  (set, get) => ({
    leftNavbarWidth: MAX_WIDTH,
    connectionProfiles: {},

    setConnectionProfiles: datas => {
      set({ connectionProfiles: datas }, undefined, `${SCOPE}/setConnectionProfiles`);
    },

    loadConnectionProfiles: async () => {
      const output = await callIPC(GetAllConnectionProfile, [], { scope: `${SCOPE}/loadConnectionProfiles` });
      if (!output) {
        return;
      }

      get().setConnectionProfiles(output.connectionProfiles);
    },

    getConnectionProfiles: () => {
      return get().connectionProfiles;
    },

    updateConnectionProfiles: (key, data) => {
      set(
        state => {
          state.connectionProfiles[key] = data;
        },
        undefined,
        `${SCOPE}/updateConnectionProfiles`
      );
    },

    deleteConnectionProfiles: key => {
      set(
        state => {
          delete state.connectionProfiles[key];
        },
        undefined,
        `${SCOPE}/deleteConnectionProfiles`
      );
    },

    setLeftNavbarWidth: (width: number) => {
      set(
        state => {
          state.leftNavbarWidth = width;
        },
        undefined,
        `${SCOPE}/setLeftNavbarWidth`
      );
    },

    getLeftNavbarWidth: () => {
      return get().leftNavbarWidth;
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        {
          connectionProfiles: {},
        },
        undefined,
        `${SCOPE}/reset`
      );
    },
  }),
  SCOPE
);
