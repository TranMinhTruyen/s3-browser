import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models/profile/models';
import { createStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

interface NavBarState {
  connectionProfiles: Partial<Record<string, ConnectionProfileOutput>>;

  setConnectionProfiles: (datas: Partial<Record<string, ConnectionProfileOutput>>) => void;
  loadConnectionProfiles: () => Promise<void>;
  getConnectionProfiles: () => Partial<Record<string, ConnectionProfileOutput>>;
  updateConnectionProfiles: (key: string, data: ConnectionProfileOutput) => void;

  reset: () => void;
}

const SCOPE = 'NavBar';

export const useNavBarStore = createStore<NavBarState>(
  (set, get) => ({
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
        state => ({
          connectionProfiles: { ...state.connectionProfiles, [key]: data },
        }),
        undefined,
        `${SCOPE}/updateConnectionProfiles`
      );
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
