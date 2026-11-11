import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import {
  createDbProfileSchema,
  type DbProfileForm,
  getDefaultDbProfileForm,
  SSL_MODES,
  toDbProfile,
  toFormValues,
} from '@/pages/sql/modals/dbProfile/dbProfileSchema';
import type { DbProfile } from '@/pages/sql/stores/dbProfileStore';

const pg = (extra: Partial<DbProfileForm> = {}): DbProfileForm => ({
  ...getDefaultDbProfileForm('Main'),
  host: 'localhost',
  database: 'app',
  username: 'me',
  ...extra,
});

/** Map of field -> message for the issues of `values`. */
const errors = (values: DbProfileForm, taken = false) => {
  const result = createDbProfileSchema(() => taken).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map(i => [String(i.path[0]), i.message]));
};

describe('getDefaultDbProfileForm', () => {
  it('is an empty PostgreSQL form with the default port, color and "prefer" SSL', () => {
    expect(getDefaultDbProfileForm('X')).toEqual({
      name: 'X',
      color: DEFAULT_PROFILE_COLOR,
      dbType: 'postgresql',
      host: '',
      port: 5432,
      database: '',
      username: '',
      password: '',
      sslMode: 'prefer',
      filePath: '',
    });
  });
});

describe('SSL_MODES', () => {
  it('lists the six PostgreSQL modes', () => {
    expect(SSL_MODES).toEqual(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);
  });
});

describe('createDbProfileSchema', () => {
  it('accepts a complete PostgreSQL form', () => {
    expect(errors(pg())).toEqual({});
  });

  it('accepts a complete SQLite form without PostgreSQL fields', () => {
    expect(errors(pg({ dbType: 'sqlite', host: '', database: '', username: '', filePath: 'C:/a.db' }))).toEqual({});
  });

  it('requires a non-blank name (trimmed)', () => {
    expect(errors(pg({ name: '   ' }))).toEqual({ name: 'V000001' });
  });

  it('reports a name already used by another profile', () => {
    expect(errors(pg(), true)).toEqual({ name: 'V000013' });
  });

  it('passes the trimmed name to isNameTaken', () => {
    const seen: string[] = [];
    createDbProfileSchema(name => {
      seen.push(name);
      return false;
    }).safeParse(pg({ name: '  Main  ' }));
    expect(seen).toEqual(['Main']);
  });

  it.each(['host', 'database', 'username'] as const)('requires %s for PostgreSQL', field => {
    expect(errors(pg({ [field]: ' ' }))).toEqual({ [field]: 'V000001' });
  });

  it('requires the file path for SQLite and ignores the PostgreSQL fields', () => {
    expect(errors(pg({ dbType: 'sqlite', host: '', filePath: ' ' }))).toEqual({ filePath: 'V000001' });
  });

  it('does not require the PostgreSQL fields to be empty for SQLite', () => {
    expect(errors(pg({ dbType: 'sqlite', port: '', filePath: 'a.db' }))).toEqual({});
  });

  it.each([
    ['an empty port', '', 'V000001'],
    ['port 0', 0, 'V000003:1,65535'],
    ['port 65536', 65536, 'V000003:1,65535'],
    ['a negative port', -1, 'V000003:1,65535'],
    ['a decimal port', 5432.5, 'V000003:1,65535'],
    ['a non numeric port', 'abc', 'V000003:1,65535'],
  ])('rejects %s', (_n, port, message) => {
    expect(errors(pg({ port }))).toEqual({ port: message });
  });

  it.each([1, 65535, '5432'])('accepts port %j', port => {
    expect(errors(pg({ port }))).toEqual({});
  });
});

describe('toFormValues', () => {
  const saved: DbProfile = {
    id: 'p1',
    name: 'N',
    color: '#fff',
    dbType: 'postgresql',
    host: 'h',
    port: 6543,
    database: 'd',
    username: 'u',
    password: 'pw',
    sslMode: 'require',
    filePath: '',
    isConnected: true,
  };

  it('copies the profile values', () => {
    expect(toFormValues(saved)).toMatchObject({ name: 'N', host: 'h', port: 6543, sslMode: 'require' });
  });

  it('uses the default port when the saved port is 0 (SQLite)', () => {
    expect(toFormValues({ ...saved, dbType: 'sqlite', port: 0 }).port).toBe(5432);
  });
});

describe('toDbProfile', () => {
  it('keeps the PostgreSQL fields (trimmed, port as number) and empties the file path', () => {
    const values = pg({
      name: ' N ',
      host: ' h ',
      database: ' d ',
      username: ' u ',
      password: ' pw ',
      port: '6543',
      sslMode: 'verify-full',
      filePath: 'leftover.db',
    });
    expect(toDbProfile(values, 'id1', true)).toEqual({
      id: 'id1',
      name: 'N',
      color: DEFAULT_PROFILE_COLOR,
      dbType: 'postgresql',
      isConnected: true,
      host: 'h',
      port: 6543,
      database: 'd',
      username: 'u',
      password: ' pw ',
      sslMode: 'verify-full',
      filePath: '',
    });
  });

  it('keeps only the file path (trimmed) for SQLite and empties everything else', () => {
    const values = pg({ dbType: 'sqlite', filePath: ' C:/a.db ', password: 'secret', sslMode: 'require' });
    expect(toDbProfile(values, 'id2', false)).toEqual({
      id: 'id2',
      name: 'Main',
      color: DEFAULT_PROFILE_COLOR,
      dbType: 'sqlite',
      isConnected: false,
      host: '',
      port: 0,
      database: '',
      username: '',
      password: '',
      sslMode: 'prefer',
      filePath: 'C:/a.db',
    });
  });
});
