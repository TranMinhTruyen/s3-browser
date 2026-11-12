import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { MOCK_DB_PROFILES } from '@/pages/sql/mock/dbProfileMock';
import { type DbProfile, selectProfileNames, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const store = () => useDbProfileStore.getState();

const profile = (id: string, extra: Partial<DbProfile> = {}): DbProfile => ({
  ...MOCK_DB_PROFILES['mock-pg-local'],
  id,
  name: `${id}-name`,
  ...extra,
});

describe('dbProfileStore', () => {
  beforeEach(() => {
    store().reset();
  });

  it('starts with the mock profiles (two PostgreSQL, one SQLite), all disconnected', () => {
    const all = Object.values(store().dbProfiles);
    expect(all.map(p => p?.dbType).sort()).toEqual(['postgresql', 'postgresql', 'sqlite']);
    expect(all.every(p => p?.isConnected === false)).toBe(true);
  });

  it.each([
    ['a known id', 'mock-pg-local', 'Local PostgreSQL'],
    ['an unknown id', 'nope', undefined],
  ])('getDbProfileById returns the profile for %s', (_n, id, name) => {
    expect(store().getDbProfileById(id)?.name).toBe(name);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('getDbProfileById returns null for %s', (_n, key) => {
    expect(store().getDbProfileById(key)).toBeNull();
  });

  it('saveDbProfile adds a new profile', () => {
    store().saveDbProfile(profile('new'));
    expect(store().getDbProfileById('new')?.name).toBe('new-name');
    expect(Object.keys(store().dbProfiles)).toHaveLength(4);
  });

  it('saveDbProfile replaces the profile with the same id', () => {
    store().saveDbProfile(profile('mock-pg-local', { name: 'Renamed' }));
    expect(store().getDbProfileById('mock-pg-local')?.name).toBe('Renamed');
    expect(Object.keys(store().dbProfiles)).toHaveLength(3);
  });

  it('deleteDbProfile removes the profile and ignores an unknown id', () => {
    store().deleteDbProfile('mock-pg-local');
    expect(store().getDbProfileById('mock-pg-local')).toBeUndefined();
    store().deleteDbProfile('nope');
    expect(Object.keys(store().dbProfiles)).toHaveLength(2);
  });

  it('setConnected flips the flag of one profile only', () => {
    store().setConnected('mock-pg-local', true);
    expect(store().getDbProfileById('mock-pg-local')?.isConnected).toBe(true);
    expect(store().getDbProfileById('mock-pg-staging')?.isConnected).toBe(false);
    store().setConnected('mock-pg-local', false);
    expect(store().getDbProfileById('mock-pg-local')?.isConnected).toBe(false);
  });

  it('setConnected ignores an unknown id', () => {
    const before = Object.keys(store().dbProfiles);
    store().setConnected('nope', true);
    expect(Object.keys(store().dbProfiles)).toEqual(before);
  });

  it('reset invalidates pending loads of its scope', () => {
    vi.mocked(invalidateLoads).mockClear();
    store().reset();
    expect(invalidateLoads).toHaveBeenCalledWith('dbProfile');
  });

  it('reset restores the mock profiles after changes', () => {
    store().saveDbProfile(profile('new'));
    store().deleteDbProfile('mock-pg-local');
    store().reset();
    expect(Object.keys(store().dbProfiles).sort()).toEqual(Object.keys(MOCK_DB_PROFILES).sort());
  });

  it('does not mutate the shared mock data when profiles change', () => {
    store().setConnected('mock-pg-local', true);
    expect(MOCK_DB_PROFILES['mock-pg-local'].isConnected).toBe(false);
  });
});

describe('selectProfileNames', () => {
  beforeEach(() => {
    store().reset();
  });

  it('maps every profile id to its name', () => {
    expect(selectProfileNames(store())).toEqual({
      'mock-pg-local': 'Local PostgreSQL',
      ...Object.fromEntries(
        Object.entries(store().dbProfiles)
          .filter(([id]) => id !== 'mock-pg-local')
          .map(([id, p]) => [id, p?.name])
      ),
    });
  });

  it('falls back to an empty name for an undefined profile', () => {
    const state = { ...store(), dbProfiles: { a: undefined, b: profile('b') } } as never;
    expect(selectProfileNames(state)).toEqual({ a: '', b: 'b-name' });
  });

  it('returns the same object while dbProfiles keeps its reference, and a new one after it changes', () => {
    const first = selectProfileNames(store());
    expect(selectProfileNames({ ...store() })).toBe(first);
    store().saveDbProfile(profile('new'));
    const next = selectProfileNames(store());
    expect(next).not.toBe(first);
    expect(next.new).toBe('new-name');
  });
});
