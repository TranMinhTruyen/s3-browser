import type { DbProfile } from '@/pages/sql/stores/dbProfileStore';

/** Profile PostgreSQL theo cấu trúc backend trả về (không có mật khẩu). */
export const pgProfile = (id = 'pg-1', extra: Partial<DbProfile> = {}): DbProfile => ({
  id,
  name: `${id}-name`,
  color: '#d0ebff',
  provider: 'postgres',
  config: { host: 'localhost', port: 5432, database: 'postgres', username: 'postgres', sslMode: 'prefer' },
  hasSecret: false,
  isConnected: false,
  ...extra,
});

/** Profile SQLite theo cấu trúc backend trả về. */
export const sqliteProfile = (id = 'sqlite-1', extra: Partial<DbProfile> = {}): DbProfile => ({
  id,
  name: `${id}-name`,
  color: '#fff3bf',
  provider: 'sqlite',
  config: { filePath: `C:/${id}.db`, readOnly: false },
  hasSecret: false,
  isConnected: false,
  ...extra,
});

/** Khởi tạo trực tiếp state của store (không qua IPC). */
export const toProfileMap = (...profiles: DbProfile[]): Record<string, DbProfile> =>
  Object.fromEntries(profiles.map(p => [p.id, p]));
