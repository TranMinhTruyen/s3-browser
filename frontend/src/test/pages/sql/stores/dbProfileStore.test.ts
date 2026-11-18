import {
  ConnectDb,
  CreateDbProfile,
  DeleteDbProfileById,
  DisconnectDb,
  GetAllDbProfile,
  UpdateDbProfileById,
} from '@wails/S3Browser/internal/handlers/dbhandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import {
  type DbProfile,
  PROVIDER_LABEL_KEY,
  selectProfileNames,
  useDbProfileStore,
} from '@/pages/sql/stores/dbProfileStore';
import { pgProfile, sqliteProfile } from '@/test/_helpers/dbProfiles';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  ConnectDb: vi.fn(),
  CreateDbProfile: vi.fn(),
  DeleteDbProfileById: vi.fn(),
  DisconnectDb: vi.fn(),
  GetAllDbProfile: vi.fn(),
  UpdateDbProfileById: vi.fn(),
}));

const callIPCMock = vi.mocked(callIPC);
const store = () => useDbProfileStore.getState();

const profile = (id: string, extra: Partial<DbProfile> = {}): DbProfile => pgProfile(id, extra);
const sqlite = (id: string, extra: Partial<DbProfile> = {}): DbProfile => sqliteProfile(id, extra);

/** Puts profiles in the store the way a backend load does. */
const seed = (...profiles: DbProfile[]) =>
  useDbProfileStore.setState({ dbProfiles: Object.fromEntries(profiles.map(p => [p.id, p])) });

const output = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `${id}-name`,
  color: '#fff',
  provider: 'sqlite',
  config: { filePath: `C:/${id}.db`, readOnly: false },
  hasSecret: false,
  ...extra,
});

describe('dbProfileStore', () => {
  beforeEach(() => {
    store().reset();
  });

  it('starts empty (profiles only come from the backend)', () => {
    expect(store().dbProfiles).toEqual({});
  });

  it('maps the provider to its i18n key', () => {
    expect(PROVIDER_LABEL_KEY).toEqual({ sqlite: 'sqlite', postgres: 'postgresql' });
  });

  it.each([
    ['a known id', 'pg-1', 'pg-1-name'],
    ['an unknown id', 'nope', undefined],
  ])('getDbProfileById returns the profile for %s', (_n, id, name) => {
    seed(profile('pg-1'));
    expect(store().getDbProfileById(id)?.name).toBe(name);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('getDbProfileById returns null for %s', (_n, key) => {
    expect(store().getDbProfileById(key)).toBeNull();
  });

  it('deleteDbProfile removes the profile and ignores an unknown id', () => {
    seed(profile('a'), profile('b'));
    store().deleteDbProfile('a');
    expect(store().getDbProfileById('a')).toBeUndefined();
    store().deleteDbProfile('nope');
    expect(Object.keys(store().dbProfiles)).toEqual(['b']);
  });

  it('setConnected flips the flag of one profile only', () => {
    seed(profile('a'), profile('b'));
    store().setConnected('a', true);
    expect(store().getDbProfileById('a')?.isConnected).toBe(true);
    expect(store().getDbProfileById('b')?.isConnected).toBe(false);
    store().setConnected('a', false);
    expect(store().getDbProfileById('a')?.isConnected).toBe(false);
  });

  it('setConnected ignores an unknown id', () => {
    seed(profile('a'));
    store().setConnected('nope', true);
    expect(Object.keys(store().dbProfiles)).toEqual(['a']);
  });

  it('reset invalidates pending loads of its scope', () => {
    vi.mocked(invalidateLoads).mockClear();
    store().reset();
    expect(invalidateLoads).toHaveBeenCalledWith('dbProfile');
  });

  it('reset empties the profiles', () => {
    seed(profile('a'));
    store().reset();
    expect(store().dbProfiles).toEqual({});
  });

  describe('loadDbProfiles', () => {
    it('loads the profiles of the backend (SQLite and PostgreSQL) as disconnected', async () => {
      callIPCMock.mockResolvedValue({
        dbProfiles: [
          output('s1', { config: { filePath: 'C:/s1.db', readOnly: true } }),
          output('p1', {
            provider: 'postgres',
            config: { host: 'h', port: 5432, database: 'd', username: 'u', sslMode: 'require' },
            hasSecret: true,
          }),
        ],
      } as never);

      expect(await store().loadDbProfiles()).toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(GetAllDbProfile, [], { scope: 'dbProfile/loadDbProfiles' });
      expect(Object.keys(store().dbProfiles)).toEqual(['s1', 'p1']);
      expect(store().dbProfiles.s1).toEqual({
        id: 's1',
        name: 's1-name',
        color: '#fff',
        provider: 'sqlite',
        config: { filePath: 'C:/s1.db', readOnly: true },
        hasSecret: false,
        isConnected: false,
      });
      expect(store().dbProfiles.p1).toMatchObject({ provider: 'postgres', hasSecret: true, isConnected: false });
    });

    it('keeps the connected flag of a profile that is still there and drops the ones the backend lost', async () => {
      seed(sqlite('s1', { isConnected: true }), sqlite('gone'), profile('p1', { isConnected: true }));
      callIPCMock.mockResolvedValue({
        dbProfiles: [output('s1', { name: 'renamed' }), output('p1', { provider: 'postgres', config: {} })],
      } as never);

      await store().loadDbProfiles();

      expect(store().dbProfiles.s1).toMatchObject({ name: 'renamed', isConnected: true });
      expect(store().dbProfiles.gone).toBeUndefined();
      expect(store().dbProfiles.p1?.isConnected).toBe(true);
    });

    it('treats a missing profile list as empty', async () => {
      seed(sqlite('s1'));
      callIPCMock.mockResolvedValue({} as never);

      expect(await store().loadDbProfiles()).toBe(true);

      expect(store().dbProfiles).toEqual({});
    });

    it('leaves the store untouched and resolves false when the backend returns null', async () => {
      seed(sqlite('s1'));
      callIPCMock.mockResolvedValue(null);

      expect(await store().loadDbProfiles()).toBe(false);

      expect(store().dbProfiles.s1).toBeDefined();
    });
  });

  describe('saveDbProfile', () => {
    const sqliteInput = { name: 'local-name', color: '#d0ebff', provider: 'sqlite', config: { filePath: 'C:/l.db' } };

    it('creates through CreateDbProfile and stores the profile the backend returns', async () => {
      callIPCMock.mockResolvedValue(output('server-id', { config: { filePath: 'C:/x.db', readOnly: true } }) as never);

      const ok = await store().saveDbProfile(sqliteInput, false);

      expect(ok).toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(CreateDbProfile, [sqliteInput]);
      expect(store().dbProfiles['server-id']).toEqual({
        id: 'server-id',
        name: 'server-id-name',
        color: '#fff',
        provider: 'sqlite',
        config: { filePath: 'C:/x.db', readOnly: true },
        hasSecret: false,
        isConnected: false,
      });
    });

    it('creates a PostgreSQL profile through the backend too, keeping the password out of the store', async () => {
      const input = {
        name: 'pg',
        color: '#fff',
        provider: 'postgres',
        config: { host: 'h', port: 5432, database: 'd', username: 'u', sslMode: 'prefer' },
        secret: 'pw-secret',
      };
      callIPCMock.mockResolvedValue(
        output('pg-id', { provider: 'postgres', config: input.config, hasSecret: true }) as never
      );

      expect(await store().saveDbProfile(input, false)).toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(CreateDbProfile, [input]);
      expect(store().dbProfiles['pg-id']).toMatchObject({ provider: 'postgres', hasSecret: true });
      expect(JSON.stringify(store().dbProfiles)).not.toContain('pw-secret');
    });

    it('updates through UpdateDbProfileById and keeps the connected flag', async () => {
      seed(sqlite('s1', { isConnected: true }));
      callIPCMock.mockResolvedValue(output('s1', { name: 'new name' }) as never);

      const ok = await store().saveDbProfile({ ...sqliteInput, id: 's1' }, true);

      expect(ok).toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(UpdateDbProfileById, [{ ...sqliteInput, id: 's1' }]);
      expect(store().dbProfiles.s1).toMatchObject({ name: 'new name', isConnected: true });
    });

    it('resolves false and stores nothing when the backend refuses', async () => {
      callIPCMock.mockResolvedValue(null);

      expect(await store().saveDbProfile(sqliteInput, false)).toBe(false);

      expect(store().dbProfiles).toEqual({});
    });
  });

  describe('removeDbProfile', () => {
    it.each([
      ['SQLite', sqlite('s1')],
      ['PostgreSQL', profile('s1')],
    ])('deletes a %s profile in the backend first, then in the store', async (_n, p) => {
      seed(p);
      callIPCMock.mockResolvedValue(true as never);

      expect(await store().removeDbProfile('s1')).toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(DeleteDbProfileById, [{ id: 's1', name: 's1-name', config: {} }]);
      expect(store().dbProfiles.s1).toBeUndefined();
    });

    it('keeps the profile when the backend fails', async () => {
      seed(sqlite('s1'));
      callIPCMock.mockResolvedValue(null);

      expect(await store().removeDbProfile('s1')).toBe(false);

      expect(store().dbProfiles.s1).toBeDefined();
    });

    it('resolves false for an unknown profile', async () => {
      expect(await store().removeDbProfile('nope')).toBe(false);
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });

  describe('connectDbProfile', () => {
    it('connects a SQLite profile in the backend and sets the flag', async () => {
      seed(sqlite('s1'));
      callIPCMock.mockResolvedValue(true as never);

      expect(await store().connectDbProfile('s1')).toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(ConnectDb, [{ profileId: 's1' }]);
      expect(store().dbProfiles.s1?.isConnected).toBe(true);
    });

    it('does not change the flag when the SQLite connect fails', async () => {
      seed(sqlite('s1'));
      callIPCMock.mockResolvedValue(null);

      expect(await store().connectDbProfile('s1')).toBe(false);

      expect(store().dbProfiles.s1?.isConnected).toBe(false);
    });

    it('only flips the flag of a PostgreSQL profile (fake), without calling the backend', async () => {
      seed(profile('pg-1'));

      expect(await store().connectDbProfile('pg-1')).toBe(true);

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(store().dbProfiles['pg-1']?.isConnected).toBe(true);
    });

    it.each([
      ['an unknown profile', 'nope'],
      ['an already connected profile', 'connected'],
    ])('resolves false for %s without calling the backend', async (_n, key) => {
      seed(sqlite('connected', { isConnected: true }));

      expect(await store().connectDbProfile(key)).toBe(false);

      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('ignores a second connect while the first is in flight, then allows it again', async () => {
      seed(sqlite('s1'));
      let release!: (value: unknown) => void;
      callIPCMock.mockReturnValue(new Promise(resolve => (release = resolve)) as never);

      const first = store().connectDbProfile('s1');
      expect(await store().connectDbProfile('s1')).toBe(false);
      release(true);
      expect(await first).toBe(true);
      expect(callIPCMock).toHaveBeenCalledTimes(1);

      callIPCMock.mockResolvedValue(true as never);
      expect(await store().disconnectDbProfile('s1')).toBe(true); // the busy mark was released
    });
  });

  describe('disconnectDbProfile', () => {
    it('disconnects a SQLite profile in the backend and clears the flag', async () => {
      seed(sqlite('s1', { isConnected: true }));
      callIPCMock.mockResolvedValue(true as never);

      expect(await store().disconnectDbProfile('s1')).toBe(true);

      expect(callIPCMock).toHaveBeenCalledWith(DisconnectDb, [{ profileId: 's1' }]);
      expect(store().dbProfiles.s1?.isConnected).toBe(false);
    });

    it('keeps the flag when the SQLite disconnect fails', async () => {
      seed(sqlite('s1', { isConnected: true }));
      callIPCMock.mockResolvedValue(null);

      expect(await store().disconnectDbProfile('s1')).toBe(false);

      expect(store().dbProfiles.s1?.isConnected).toBe(true);
    });

    it('only clears the flag of a PostgreSQL profile (fake), without calling the backend', async () => {
      seed(profile('pg-1', { isConnected: true }));

      expect(await store().disconnectDbProfile('pg-1')).toBe(true);

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(store().dbProfiles['pg-1']?.isConnected).toBe(false);
    });

    it.each([
      ['an unknown profile', 'nope'],
      ['a profile that is not connected', 'pg-1'],
    ])('resolves false for %s', async (_n, key) => {
      seed(profile('pg-1'));
      expect(await store().disconnectDbProfile(key)).toBe(false);
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });
});

describe('selectProfileNames', () => {
  beforeEach(() => {
    store().reset();
  });

  it('maps every profile id to its name', () => {
    seed(profile('a'), sqlite('b'));
    expect(selectProfileNames(store())).toEqual({ a: 'a-name', b: 'b-name' });
  });

  it('falls back to an empty name for an undefined profile', () => {
    const state = { ...store(), dbProfiles: { a: undefined, b: profile('b') } } as never;
    expect(selectProfileNames(state)).toEqual({ a: '', b: 'b-name' });
  });

  it('returns the same object while dbProfiles keeps its reference, and a new one after it changes', () => {
    const first = selectProfileNames(store());
    expect(selectProfileNames({ ...store() })).toBe(first);
    seed(profile('new'));
    const next = selectProfileNames(store());
    expect(next).not.toBe(first);
    expect(next.new).toBe('new-name');
  });
});
