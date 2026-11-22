import type { DbProfile } from '@/pages/sql/stores/dbProfileStore';

/** PostgreSQL profile in the shape the backend returns (no password). */
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

/** SQLite profile in the shape the backend returns. */
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

/** Seeds the store state directly (no IPC). */
export const toProfileMap = (...profiles: DbProfile[]): Record<string, DbProfile> =>
  Object.fromEntries(profiles.map(p => [p.id, p]));
