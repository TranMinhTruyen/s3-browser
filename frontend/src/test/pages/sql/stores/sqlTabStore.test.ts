import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const store = () => useSqlTabStore.getState();
const ids = () => Object.keys(store().tabList);

describe('sqlTabStore', () => {
  beforeEach(() => {
    store().reset();
  });

  it('starts with one active tab without a profile', () => {
    expect(ids()).toHaveLength(1);
    expect(store().activeTab).toBe(ids()[0]);
    expect(store().tabList[ids()[0]]).toEqual({ profileId: null });
  });

  it('reset invalidates pending loads of its scope', () => {
    vi.mocked(invalidateLoads).mockClear();
    store().reset();
    expect(invalidateLoads).toHaveBeenCalledWith('sqlTab');
  });

  it('reset gives a fresh single tab', () => {
    const [old] = ids();
    store().addTab();
    store().reset();
    expect(ids()).toHaveLength(1);
    expect(ids()[0]).not.toBe(old);
  });

  it('addTab appends a tab and makes it active', () => {
    const [first] = ids();
    store().addTab();
    expect(ids()).toHaveLength(2);
    expect(ids()[0]).toBe(first);
    expect(store().activeTab).toBe(ids()[1]);
  });

  describe('setActiveTab', () => {
    it('changes the active tab', () => {
      store().addTab();
      store().setActiveTab(ids()[0]);
      expect(store().activeTab).toBe(ids()[0]);
    });

    it.each([null, ''])('ignores %j', value => {
      const before = store().activeTab;
      store().setActiveTab(value);
      expect(store().activeTab).toBe(before);
    });
  });

  describe('closeTab', () => {
    it('does not close the last tab', () => {
      store().closeTab(ids()[0]);
      expect(ids()).toHaveLength(1);
    });

    it('ignores an unknown tab id', () => {
      store().addTab();
      store().closeTab('nope');
      expect(ids()).toHaveLength(2);
    });

    it('closing an inactive tab keeps the active tab', () => {
      store().addTab();
      const [a, b] = ids();
      store().closeTab(a);
      expect(ids()).toEqual([b]);
      expect(store().activeTab).toBe(b);
    });

    it('closing the active tab activates the next one', () => {
      store().addTab();
      store().addTab();
      const [a, b, c] = ids();
      store().setActiveTab(a);
      store().closeTab(a);
      expect(ids()).toEqual([b, c]);
      expect(store().activeTab).toBe(b);
    });

    it('closing the active last tab activates the previous one', () => {
      store().addTab();
      const [a, b] = ids();
      store().closeTab(b);
      expect(ids()).toEqual([a]);
      expect(store().activeTab).toBe(a);
    });
  });

  describe('moveTab', () => {
    beforeEach(() => {
      store().addTab();
      store().addTab();
    });

    it.each([
      ['forward', 0, 2, [1, 2, 0]],
      ['backward', 2, 0, [2, 0, 1]],
    ])('moves a tab %s to the position of the target and keeps the active tab', (_n, from, to, order) => {
      const original = ids();
      const active = store().activeTab;
      store().moveTab(original[from], original[to]);
      expect(ids()).toEqual(order.map(i => original[i]));
      expect(store().activeTab).toBe(active);
    });

    it('does nothing when source and target are the same tab', () => {
      const original = ids();
      store().moveTab(original[0], original[0]);
      expect(ids()).toEqual(original);
    });

    it.each([
      ['source', true],
      ['target', false],
    ])('does nothing for an unknown %s', (_n, unknownSource) => {
      const original = ids();
      if (unknownSource) store().moveTab('nope', original[0]);
      else store().moveTab(original[0], 'nope');
      expect(ids()).toEqual(original);
    });
  });

  describe('profiles', () => {
    it('setTabProfile sets and clears the profile of one tab', () => {
      store().addTab();
      const [a, b] = ids();
      store().setTabProfile(a, 'p1');
      expect(store().tabList[a].profileId).toBe('p1');
      expect(store().tabList[b].profileId).toBeNull();
      store().setTabProfile(a, null);
      expect(store().tabList[a].profileId).toBeNull();
    });

    it('setTabProfile ignores an unknown tab', () => {
      store().setTabProfile('nope', 'p1');
      expect(ids()).toHaveLength(1);
      expect(store().tabList.nope).toBeUndefined();
    });

    it('clearProfile resets every tab using that profile only', () => {
      store().addTab();
      store().addTab();
      const [a, b, c] = ids();
      store().setTabProfile(a, 'p1');
      store().setTabProfile(b, 'p1');
      store().setTabProfile(c, 'p2');
      store().clearProfile('p1');
      expect(store().tabList[a].profileId).toBeNull();
      expect(store().tabList[b].profileId).toBeNull();
      expect(store().tabList[c].profileId).toBe('p2');
    });
  });
});
