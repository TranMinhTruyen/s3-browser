import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import {
  createDbProfileSchema,
  type DbProfileForm,
  getDefaultDbProfileForm,
  SSL_MODES,
  toDbProfileInput,
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

/** Ánh xạ từ trường sang thông báo lỗi trong `values`. */
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
      provider: 'postgres',
      host: '',
      port: 5432,
      database: '',
      username: '',
      password: '',
      sslMode: 'prefer',
      filePath: '',
      readOnly: false,
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
    expect(errors(pg({ provider: 'sqlite', host: '', database: '', username: '', filePath: 'C:/a.db' }))).toEqual({});
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
    expect(errors(pg({ provider: 'sqlite', host: '', filePath: ' ' }))).toEqual({ filePath: 'V000001' });
  });

  it('does not require the PostgreSQL fields to be empty for SQLite', () => {
    expect(errors(pg({ provider: 'sqlite', port: '', filePath: 'a.db' }))).toEqual({});
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
    provider: 'postgres',
    config: { host: 'h', port: 6543, database: 'd', username: 'u', sslMode: 'require' },
    hasSecret: true,
    isConnected: true,
  };

  it('copies the profile values and never loads the password', () => {
    expect(toFormValues(saved)).toEqual({
      name: 'N',
      color: '#fff',
      provider: 'postgres',
      host: 'h',
      port: 6543,
      database: 'd',
      username: 'u',
      password: '',
      sslMode: 'require',
      filePath: '',
      readOnly: false,
    });
  });

  it('reads the SQLite file path and read-only flag, with the default port and SSL mode', () => {
    expect(
      toFormValues({ ...saved, provider: 'sqlite', config: { filePath: 'C:/a.db', readOnly: true } })
    ).toMatchObject({
      provider: 'sqlite',
      filePath: 'C:/a.db',
      readOnly: true,
      host: '',
      port: 5432,
      sslMode: 'prefer',
    });
  });

  it('falls back to empty values for an empty config', () => {
    expect(toFormValues({ ...saved, config: {} })).toMatchObject({
      host: '',
      port: 5432,
      database: '',
      username: '',
      sslMode: 'prefer',
      filePath: '',
      readOnly: false,
    });
  });
});

describe('toDbProfileInput', () => {
  it('sends only the PostgreSQL config (trimmed, port as number) and the password as secret', () => {
    const values = pg({
      name: ' N ',
      host: ' h ',
      database: ' d ',
      username: ' u ',
      password: ' pw ',
      port: '6543',
      sslMode: 'verify-full',
      filePath: 'leftover.db',
      readOnly: true,
    });
    expect(toDbProfileInput(values, 'id1')).toEqual({
      id: 'id1',
      name: 'N',
      color: DEFAULT_PROFILE_COLOR,
      provider: 'postgres',
      config: { host: 'h', port: 6543, database: 'd', username: 'u', sslMode: 'verify-full' },
      secret: ' pw ',
    });
  });

  it('sends only the file path (trimmed) and read-only flag for SQLite, without a secret', () => {
    const values = pg({ provider: 'sqlite', filePath: ' C:/a.db ', password: 'secret', sslMode: 'require' });
    const input = toDbProfileInput(values, 'id2');
    expect(input).toEqual({
      id: 'id2',
      name: 'Main',
      color: DEFAULT_PROFILE_COLOR,
      provider: 'sqlite',
      config: { filePath: 'C:/a.db', readOnly: false },
    });
    expect('secret' in input).toBe(false);
  });

  it('leaves the id undefined when creating', () => {
    expect(toDbProfileInput(pg()).id).toBeUndefined();
  });

  it('keeps the read-only flag for SQLite', () => {
    const values = pg({ provider: 'sqlite', filePath: 'C:/a.db', readOnly: true });
    expect(toDbProfileInput(values, 'id3').config.readOnly).toBe(true);
  });
});

describe('read-only flag', () => {
  it('is carried between the form and a saved SQLite profile', () => {
    const input = toDbProfileInput(pg({ provider: 'sqlite', filePath: 'C:/a.db', readOnly: true }), 'id5');
    const saved: DbProfile = {
      id: 'id5',
      name: input.name ?? '',
      color: input.color ?? '',
      provider: 'sqlite',
      config: input.config,
      hasSecret: false,
      isConnected: false,
    };
    expect(toFormValues(saved).readOnly).toBe(true);
  });

  it('does not affect validation', () => {
    expect(errors(pg({ provider: 'sqlite', filePath: 'C:/a.db', readOnly: true }))).toEqual({});
  });
});
