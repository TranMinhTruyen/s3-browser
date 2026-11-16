import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { MOCK_DB_PROFILES } from '@/pages/sql/mock/dbProfileMock';

export type DbType = 'postgresql' | 'sqlite';
export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

/** Database connection profile (kept in RAM until the DB backend exists). Fields of the other DB type stay empty. */
export type DbProfile = {
  id: string;
  name: string;
  color: string;
  dbType: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  filePath: string;
  isConnected: boolean;
};

interface DbProfileState {
  dbProfiles: Partial<Record<string, DbProfile>>;
}

interface DbProfileAction {
  getDbProfileById: (key?: string | null) => DbProfile | null | undefined;
  /** Adds the profile, or replaces the one with the same id. */
  saveDbProfile: (profile: DbProfile) => void;
  deleteDbProfile: (key: string) => void;
  setConnected: (key: string, connected: boolean) => void;
  reset: () => void;
}

const SCOPE = 'dbProfile';

let lastProfiles: DbProfileState['dbProfiles'] | null = null;
let lastNames: Record<string, string> = {};

/** Profile id -> name. Computed once per `dbProfiles` change and shared by every tab that selects it. */
export const selectProfileNames = (s: DbProfileState): Record<string, string> => {
  if (s.dbProfiles !== lastProfiles) {
    lastProfiles = s.dbProfiles;
    lastNames = Object.fromEntries(Object.entries(s.dbProfiles).map(([key, value]) => [key, value?.name ?? '']));
  }
  return lastNames;
};

/** Database profiles by id, starting with the mock ones. */
export const useDbProfileStore = createAppStore<DbProfileState & DbProfileAction>(
  (set, get) => ({
    dbProfiles: MOCK_DB_PROFILES,

    getDbProfileById: key => (key ? get().dbProfiles[key] : null),

    saveDbProfile: profile => {
      set(
        state => {
          state.dbProfiles[profile.id] = profile;
        },
        undefined,
        `${SCOPE}/saveDbProfile`
      );
    },

    deleteDbProfile: key => {
      set(
        state => {
          delete state.dbProfiles[key];
        },
        undefined,
        `${SCOPE}/deleteDbProfile`
      );
    },

    setConnected: (key, connected) => {
      set(
        state => {
          const profile = state.dbProfiles[key];
          if (profile) profile.isConnected = connected;
        },
        undefined,
        `${SCOPE}/setConnected`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set({ dbProfiles: MOCK_DB_PROFILES }, undefined, `${SCOPE}/reset`);
    },
  }),
  'DbProfile'
);
