import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

export type ConnectionProfile = ConnectionProfileOutput & {};

interface ProfileState {
  connectionProfiles: Partial<Record<string, ConnectionProfile>>;
}

interface ProfileAction {
  setConnectionProfiles: (datas: Partial<Record<string, ConnectionProfile>>) => void;
  loadConnectionProfiles: () => Promise<void>;
  getAllConnectionProfiles: () => Partial<Record<string, ConnectionProfile>>;
  getConnectionProfileById: (key?: string | null) => ConnectionProfile | null | undefined;
  updateConnectionProfiles: (key: string, data: ConnectionProfile) => void;
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

      get().setConnectionProfiles(output.connectionProfiles ?? {});
    },

    getAllConnectionProfiles: () => {
      return get().connectionProfiles;
    },

    getConnectionProfileById: (key?: string | null) => {
      if (key) {
        return get().connectionProfiles[key];
      }
      return null;
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
