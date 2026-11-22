import {
  ConnectDb,
  CreateDbProfile,
  DeleteDbProfileById,
  DisconnectDb,
  GetAllDbProfile,
  UpdateDbProfileById,
} from '@wails/S3Browser/internal/handlers/dbhandler';
import type { DbProfileInput, DbProfileOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

export type Provider = 'sqlite' | 'postgres';
export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

/** i18n keys (`dbType.*`, `form.dbType.*`) are named after the DB type, not the provider id. */
export const PROVIDER_LABEL_KEY: Record<Provider, 'sqlite' | 'postgresql'> = {
  sqlite: 'sqlite',
  postgres: 'postgresql',
};

/** Database connection profile as saved by the backend (never holds the password). PostgreSQL connect is still fake. */
export type DbProfile = {
  id: string;
  name: string;
  color: string;
  provider: Provider;
  config: DbProfileOutput['config'];
  /** A password is stored in the backend. */
  hasSecret: boolean;
  isConnected: boolean;
};

interface DbProfileState {
  dbProfiles: Partial<Record<string, DbProfile>>;
}

interface DbProfileAction {
  getDbProfileById: (key?: string | null) => DbProfile | null | undefined;
  /** Reloads the profiles from the backend; connected flags are kept. */
  loadDbProfiles: () => Promise<boolean>;
  /** Saves the profile in the backend, then in the store. Resolves false when the backend refused. */
  saveDbProfile: (input: DbProfileInput, isUpdate: boolean) => Promise<boolean>;
  deleteDbProfile: (key: string) => void;
  /** Deletes the profile in the backend first. Resolves false when it was kept. */
  removeDbProfile: (key: string) => Promise<boolean>;
  setConnected: (key: string, connected: boolean) => void;
  /** Connects the profile (PostgreSQL is fake: only the flag). Resolves false when it failed or is busy. */
  connectDbProfile: (key: string) => Promise<boolean>;
  /** Disconnects the profile (PostgreSQL is fake: only the flag). Resolves false when it failed or is busy. */
  disconnectDbProfile: (key: string) => Promise<boolean>;
  reset: () => void;
}

const SCOPE = 'dbProfile';

/** Profiles with a connect/disconnect in flight, so a double click does not send the call twice. */
const busy = new Set<string>();

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

const fromOutput = (output: DbProfileOutput, isConnected: boolean): DbProfile => ({
  id: output.id,
  name: output.name,
  color: output.color,
  provider: output.provider as Provider,
  config: { ...output.config },
  hasSecret: output.hasSecret,
  isConnected,
});

/** Runs `task` unless another connect/disconnect of the profile is in flight. */
const runExclusive = async (key: string, task: () => Promise<boolean>): Promise<boolean> => {
  if (busy.has(key)) return false;
  busy.add(key);
  try {
    return await task();
  } finally {
    busy.delete(key);
  }
};

/** Database profiles by id. */
export const useDbProfileStore = createAppStore<DbProfileState & DbProfileAction>(
  (set, get) => ({
    dbProfiles: {},

    getDbProfileById: key => (key ? get().dbProfiles[key] : null),

    loadDbProfiles: async () => {
      const output = await callIPC(GetAllDbProfile, [], { scope: `${SCOPE}/loadDbProfiles` });
      if (!output) return false;

      const current = get().dbProfiles;
      const next: DbProfileState['dbProfiles'] = {};
      for (const item of output.dbProfiles ?? []) {
        next[item.id] = fromOutput(item, current[item.id]?.isConnected ?? false);
      }
      set({ dbProfiles: next }, undefined, `${SCOPE}/loadDbProfiles`);
      return true;
    },

    saveDbProfile: async (input, isUpdate) => {
      const output = await callIPC(isUpdate ? UpdateDbProfileById : CreateDbProfile, [input]);
      if (!output) return false;
      set(
        state => {
          state.dbProfiles[output.id] = fromOutput(output, state.dbProfiles[output.id]?.isConnected ?? false);
        },
        undefined,
        `${SCOPE}/saveDbProfile`
      );
      return true;
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

    removeDbProfile: async key => {
      const profile = get().dbProfiles[key];
      if (!profile) return false;
      const deleted = await callIPC(DeleteDbProfileById, [{ id: key, name: profile.name, config: {} }]);
      if (!deleted) return false;
      get().deleteDbProfile(key);
      return true;
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

    connectDbProfile: key =>
      runExclusive(key, async () => {
        const profile = get().dbProfiles[key];
        if (!profile || profile.isConnected) return false;
        if (profile.provider === 'sqlite' && !(await callIPC(ConnectDb, [{ profileId: key }]))) return false;
        get().setConnected(key, true);
        return true;
      }),

    disconnectDbProfile: key =>
      runExclusive(key, async () => {
        const profile = get().dbProfiles[key];
        if (!profile?.isConnected) return false;
        if (profile.provider === 'sqlite' && !(await callIPC(DisconnectDb, [{ profileId: key }]))) return false;
        get().setConnected(key, false);
        return true;
      }),

    reset: () => {
      invalidateLoads(SCOPE);
      busy.clear();
      set({ dbProfiles: {} }, undefined, `${SCOPE}/reset`);
    },
  }),
  'DbProfile'
);
