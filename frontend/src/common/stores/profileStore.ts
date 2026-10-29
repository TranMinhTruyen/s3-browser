import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

/** Saved connection profile, as returned by the backend. */
export type ConnectionProfile = ConnectionProfileOutput & {};

interface ProfileState {
  connectionProfiles: Partial<Record<string, ConnectionProfile>>;
}

interface ProfileAction {
  // Resolves true when the profiles were loaded.
  loadConnectionProfiles: () => Promise<boolean>;
  getConnectionProfileById: (key?: string | null) => ConnectionProfile | null | undefined;
  updateConnectionProfiles: (key: string, data: ConnectionProfile) => void;
  deleteConnectionProfiles: (key: string) => void;
  reset: () => void;
}

const SCOPE = 'profile';

/** Saved connection profiles by id. */
export const useProfileStore = createAppStore<ProfileState & ProfileAction>(
  (set, get) => ({
    connectionProfiles: {},

    loadConnectionProfiles: async () => {
      const output = await callIPC(GetAllConnectionProfile, [], { scope: `${SCOPE}/loadConnectionProfiles` });
      if (!output) {
        return false;
      }

      set({ connectionProfiles: output.connectionProfiles ?? {} }, undefined, `${SCOPE}/setConnectionProfiles`);
      return true;
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
