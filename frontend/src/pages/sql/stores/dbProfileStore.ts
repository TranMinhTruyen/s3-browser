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

/** Key i18n (`dbType.*`, `form.dbType.*`) được đặt theo loại DB, không theo id của provider. */
export const PROVIDER_LABEL_KEY: Record<Provider, 'sqlite' | 'postgresql'> = {
  sqlite: 'sqlite',
  postgres: 'postgresql',
};

/** Profile kết nối database theo dữ liệu backend lưu (không bao giờ chứa mật khẩu). Kết nối PostgreSQL hiện vẫn là giả lập. */
export type DbProfile = {
  id: string;
  name: string;
  color: string;
  provider: Provider;
  config: DbProfileOutput['config'];
  /** Mật khẩu đã được lưu ở backend. */
  hasSecret: boolean;
  isConnected: boolean;
};

interface DbProfileState {
  dbProfiles: Partial<Record<string, DbProfile>>;
}

interface DbProfileAction {
  getDbProfileById: (key?: string | null) => DbProfile | null | undefined;
  /** Tải lại profile từ backend; giữ nguyên các cờ trạng thái kết nối. */
  loadDbProfiles: () => Promise<boolean>;
  /** Lưu profile ở backend rồi cập nhật store. Trả về false nếu backend từ chối. */
  saveDbProfile: (input: DbProfileInput, isUpdate: boolean) => Promise<boolean>;
  deleteDbProfile: (key: string) => void;
  /** Xóa profile ở backend trước. Trả về false nếu profile không bị xóa. */
  removeDbProfile: (key: string) => Promise<boolean>;
  setConnected: (key: string, connected: boolean) => void;
  /** Kết nối profile (PostgreSQL giả lập: chỉ cập nhật cờ). Trả về false nếu thất bại hoặc đang bận. */
  connectDbProfile: (key: string) => Promise<boolean>;
  /** Ngắt kết nối profile (PostgreSQL giả lập: chỉ cập nhật cờ). Trả về false nếu thất bại hoặc đang bận. */
  disconnectDbProfile: (key: string) => Promise<boolean>;
  reset: () => void;
}

const SCOPE = 'dbProfile';

/** Các profile đang kết nối/ngắt kết nối để click đúp không gửi yêu cầu hai lần. */
const busy = new Set<string>();

let lastProfiles: DbProfileState['dbProfiles'] | null = null;
let lastNames: Record<string, string> = {};

/** Ánh xạ id profile -> tên. Tính lại mỗi khi `dbProfiles` thay đổi và dùng chung cho mọi tab chọn profile đó. */
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

/** Chạy `task` nếu profile chưa có thao tác kết nối/ngắt kết nối nào đang thực hiện. */
const runExclusive = async (key: string, task: () => Promise<boolean>): Promise<boolean> => {
  if (busy.has(key)) return false;
  busy.add(key);
  try {
    return await task();
  } finally {
    busy.delete(key);
  }
};

/** Các profile database được lập chỉ mục theo id. */
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
