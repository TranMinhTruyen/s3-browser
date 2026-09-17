import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

interface ProfileState {
  connectionProfiles: Partial<Record<string, ConnectionProfileOutput>>;
}

interface ProfileAction {
  setConnectionProfiles: (datas: Partial<Record<string, ConnectionProfileOutput>>) => void;
  loadConnectionProfiles: () => Promise<void>;
  getConnectionProfiles: () => Partial<Record<string, ConnectionProfileOutput>>;
  updateConnectionProfiles: (key: string, data: ConnectionProfileOutput) => void;
  deleteConnectionProfiles: (key: string) => void;
  reset: () => void;
}

const SCOPE = 'profile';

export const useProfileStore = createAppStore<ProfileState & ProfileAction>(
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
