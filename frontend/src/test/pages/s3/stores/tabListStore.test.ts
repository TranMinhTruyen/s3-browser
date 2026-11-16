import { Bucket } from '@wails/S3Browser/models/bucket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLoads } from '@/common/utils/ipcUtils';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const state = () => useTabListStore.getState();
const activeId = () => state().activeTab;
const item = { key: 'a.txt' } as never;

describe('tabListStore', () => {
  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  // reset() keeps uploadingTabId on purpose, so clear it explicitly to not leak into the next test.
  afterEach(() => {
    state().setUploadingTab(null);
  });

  it('starts with one empty tab', () => {
    expect(Object.keys(state().tabList)).toHaveLength(1);
    expect(state().tabList[activeId()]).toMatchObject({ currentView: 'bucketList', prefix: '' });
    expect(state().tabList[activeId()].selectionItem).toEqual({});
    expect(state().tabList[activeId()].deletingItems).toEqual({});
  });

  it('setActiveTab ignores an empty id', () => {
    const before = activeId();
    state().setActiveTab(null);
    state().setActiveTab('');
    expect(activeId()).toBe(before);
    state().addTab();
    state().setActiveTab(before);
    expect(activeId()).toBe(before);
  });

  it('addTab adds and activates a tab', () => {
    state().addTab();
    expect(Object.keys(state().tabList)).toHaveLength(2);
    expect(state().tabList[activeId()]).toBeDefined();
  });

  it('updateTab patches a known tab only', () => {
    const id = activeId();
    state().updateTab(id, { profileId: 'p1' });
    expect(state().tabList[id].profileId).toBe('p1');
    state().updateTab('ghost', { profileId: 'p2' });
    expect(state().tabList.ghost).toBeUndefined();
  });

  describe('moveTab', () => {
    const order = () => Object.keys(state().tabList);

    it('moves a tab to the position of the target and keeps the active tab', () => {
      state().addTab();
      state().addTab();
      const [a, b, c] = order();
      const active = activeId();

      state().moveTab(a, c);
      expect(order()).toEqual([b, c, a]);
      state().moveTab(a, b);
      expect(order()).toEqual([a, b, c]);
      expect(activeId()).toBe(active);
    });

    it('keeps the tab data when reordering', () => {
      state().addTab();
      const [a, b] = order();
      state().updateTab(a, { prefix: 'photos/' });
      state().moveTab(a, b);
      expect(state().tabList[a].prefix).toBe('photos/');
    });

    it.each([
      ['same id', 0, 0],
      ['unknown active id', -1, 0],
      ['unknown over id', 0, -1],
    ])('does nothing for %s', (_name, from, to) => {
      state().addTab();
      const ids = order();
      const before = state().tabList;
      state().moveTab(from < 0 ? 'ghost' : ids[from], to < 0 ? 'ghost' : ids[to]);
      expect(state().tabList).toBe(before);
      expect(order()).toEqual(ids);
    });
  });

  describe('closeTab', () => {
    it('does nothing for the last tab or an unknown tab', () => {
      state().closeTab(activeId());
      expect(Object.keys(state().tabList)).toHaveLength(1);
      state().addTab();
      state().closeTab('ghost');
      expect(Object.keys(state().tabList)).toHaveLength(2);
    });

    it.each(['toString', 'constructor', '__proto__'])('ignores the inherited key %s', key => {
      state().addTab();
      const before = state().tabList;
      state().closeTab(key);
      expect(state().tabList).toBe(before);
    });

    it('keeps the active tab when closing another one', () => {
      const first = activeId();
      state().addTab();
      const second = activeId();
      state().closeTab(first);
      expect(activeId()).toBe(second);
    });

    it('activates the next tab, else the previous one', () => {
      const first = activeId();
      state().addTab();
      const second = activeId();
      state().addTab();
      const third = activeId();

      state().setActiveTab(first);
      state().closeTab(first);
      expect(activeId()).toBe(second);

      state().setActiveTab(third);
      state().closeTab(third);
      expect(activeId()).toBe(second);
    });
  });

  it('changeCurrentView opens a bucket and resets the folder state', () => {
    const id = activeId();
    state().addSelectItem(id, ['x']);
    state().openDetail(id, item);
    state().changeCurrentView(id, 'objectList', 'bkt');
    expect(state().tabList[id]).toMatchObject({
      currentView: 'objectList',
      bucket: 'bkt',
      prefix: '',
    });
    expect(state().tabList[id].selectionItem).toEqual({});
    expect(state().tabList[id].detailItem).toBeUndefined();

    state().changeCurrentView(id, 'bucketList', 'bkt');
    expect(state().tabList[id].bucket).toBeUndefined();
    state().changeCurrentView('ghost', 'bucketList');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('changeCurrentView to bucketList clears bucket, folder, selection and detail', () => {
    const id = activeId();
    state().changeCurrentView(id, 'objectList', 'bkt');
    state().changePrefix(id, 'a/');
    state().addSelectItem(id, ['x']);
    state().openDetail(id, item);
    state().changeCurrentView(id, 'bucketList');
    expect(state().tabList[id]).toMatchObject({ currentView: 'bucketList', prefix: '' });
    expect(state().tabList[id].selectionItem).toEqual({});
    expect(state().tabList[id].bucket).toBeUndefined();
    expect(state().tabList[id].detailItem).toBeUndefined();
  });

  it('changePrefix clears selection and detail', () => {
    const id = activeId();
    state().addSelectItem(id, ['x']);
    state().openDetail(id, item);
    state().changePrefix(id, 'a/');
    expect(state().tabList[id]).toMatchObject({ prefix: 'a/' });
    expect(state().tabList[id].selectionItem).toEqual({});
    expect(state().tabList[id].detailItem).toBeUndefined();
    state().changePrefix('ghost', 'b/');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('resetViewByProfile and clearProfile only touch tabs of that profile', () => {
    const mine = activeId();
    state().updateTab(mine, { profileId: 'p1', currentView: 'objectList', bucket: 'b', prefix: 'x/' });
    state().addTab();
    const other = activeId();
    state().updateTab(other, { profileId: 'p2', currentView: 'objectList', bucket: 'b' });

    state().resetViewByProfile('p1');
    expect(state().tabList[mine]).toMatchObject({ profileId: 'p1', currentView: 'bucketList', prefix: '' });
    expect(state().tabList[other].currentView).toBe('objectList');

    state().updateTab(mine, { currentView: 'objectList' });
    state().clearProfile('p1');
    expect(state().tabList[mine]).toMatchObject({ profileId: null, currentView: 'bucketList' });
    expect(state().tabList[other].profileId).toBe('p2');
  });

  it('resetViewByProfile and clearProfile clear bucket, folder, selection and detail', () => {
    const mine = activeId();
    const dirty = {
      currentView: 'objectList' as const,
      bucket: 'b',
      prefix: 'x/',
      selectionItem: { k: true as const },
    };
    state().updateTab(mine, { profileId: 'p1', ...dirty, detailItem: item });
    state().addTab();
    const other = activeId();
    state().updateTab(other, { profileId: 'p2', ...dirty, detailItem: item });

    state().resetViewByProfile('p1');
    expect(state().tabList[mine]).toMatchObject({
      profileId: 'p1',
      currentView: 'bucketList',
      prefix: '',
    });
    expect(state().tabList[mine].selectionItem).toEqual({});
    expect(state().tabList[mine].bucket).toBeUndefined();
    expect(state().tabList[mine].detailItem).toBeUndefined();
    expect(state().tabList[other]).toMatchObject({ ...dirty, detailItem: item });

    state().updateTab(mine, { ...dirty, detailItem: item });
    state().clearProfile('p1');
    expect(state().tabList[mine]).toMatchObject({
      profileId: null,
      currentView: 'bucketList',
      prefix: '',
    });
    expect(state().tabList[mine].selectionItem).toEqual({});
    expect(state().tabList[mine].bucket).toBeUndefined();
    expect(state().tabList[mine].detailItem).toBeUndefined();
    expect(state().tabList[other]).toMatchObject({ profileId: 'p2', ...dirty });
  });

  it('selection actions', () => {
    const id = activeId();
    state().addSelectItem(id, ['a', 'b']);
    state().addSelectItem(id, ['b', 'c']);
    expect(state().tabList[id].selectionItem).toEqual({ a: true, b: true, c: true });
    state().removeSelectItem(id, ['b', 'missing']);
    expect(state().tabList[id].selectionItem).toEqual({ a: true, c: true });
    state().clearSelectItem(id);
    expect(state().tabList[id].selectionItem).toEqual({});

    state().addSelectItem('ghost', ['a']);
    state().removeSelectItem('ghost', ['a']);
    state().clearSelectItem('ghost');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('openDetail and closeDetail', () => {
    const id = activeId();
    state().openDetail(id, item);
    expect(state().tabList[id].detailItem).toEqual(item);
    state().closeDetail(id);
    expect(state().tabList[id].detailItem).toBeUndefined();
    state().openDetail('ghost', item);
    state().closeDetail('ghost');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('setDeleting adds and removes keys', () => {
    const id = activeId();
    state().setDeleting(id, ['a', 'b'], true);
    state().setDeleting(id, ['b', 'c'], true);
    expect(state().tabList[id].deletingItems).toEqual({ a: true, b: true, c: true });
    state().setDeleting(id, ['a', 'missing'], false);
    expect(state().tabList[id].deletingItems).toEqual({ b: true, c: true });
    state().setDeleting('ghost', ['a'], true);
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('setUploadingTab survives reset, reset invalidates the scope', () => {
    state().setUploadingTab('t1');
    expect(state().uploadingTabId).toBe('t1');
    state().reset();
    expect(state().uploadingTabId).toBe('t1');
    expect(invalidateLoads).toHaveBeenCalledWith('tabList');
  });

  it('serializeTabs lists tabs in order with a null profile by default', () => {
    const first = activeId();
    state().updateTab(first, { profileId: 'p1' });
    state().addTab();
    const second = activeId();
    expect(state().serializeTabs()).toEqual({
      tabs: [
        { id: first, profileId: 'p1' },
        { id: second, profileId: null },
      ],
      activeTab: second,
    });
  });

  describe('restoreTabs', () => {
    it('rebuilds tabs with their profile and active tab', () => {
      state().restoreTabs({
        tabs: [
          { id: 'a', profileId: 'p1' },
          { id: 'b', profileId: null },
        ],
        activeTab: 'b',
      });
      expect(Object.keys(state().tabList)).toEqual(['a', 'b']);
      expect(state().tabList.a).toMatchObject({ profileId: 'p1', currentView: 'bucketList', prefix: '' });
      expect(state().tabList.b.profileId).toBeNull();
      expect(activeId()).toBe('b');
    });

    it('falls back to the first tab when the active tab is unknown', () => {
      state().restoreTabs({ tabs: [{ id: 'a' }, { id: 'b' }], activeTab: 'zzz' } as never);
      expect(activeId()).toBe('a');
    });

    it.each(['toString', 'constructor'])('falls back to the first tab for inherited active tab %s', key => {
      state().restoreTabs({ tabs: [{ id: 'a' }, { id: 'b' }], activeTab: key } as never);
      expect(activeId()).toBe('a');
    });

    it.each([
      ['empty list', { tabs: [], activeTab: 'a' }],
      ['missing list', { activeTab: 'a' }],
      ['only empty ids', { tabs: [{ id: '', profileId: null }], activeTab: '' }],
      [
        'duplicate ids',
        {
          tabs: [
            { id: 'a', profileId: null },
            { id: 'a', profileId: 'p1' },
          ],
          activeTab: 'a',
        },
      ],
    ])('keeps the current tabs for %s', (_name, saved) => {
      const before = state().serializeTabs();
      state().restoreTabs(saved as never);
      expect(state().serializeTabs()).toEqual(before);
    });

    it('drops empty ids but keeps the valid ones', () => {
      state().restoreTabs({
        tabs: [
          { id: '', profileId: null },
          { id: 'a', profileId: null },
        ],
        activeTab: 'a',
      });
      expect(Object.keys(state().tabList)).toEqual(['a']);
    });
  });
});

describe('tabListStore bucket detail', () => {
  const bucket = { name: 'bkt', creationDate: '2026-01-02T03:04:05' } as never;

  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
  });

  it('openBucketDetail and closeBucketDetail set and clear the bucket of the tab', () => {
    const id = activeId();
    state().openBucketDetail(id, bucket);
    expect(state().tabList[id].detailBucket).toEqual(bucket);
    state().closeBucketDetail(id);
    expect(state().tabList[id].detailBucket).toBeUndefined();
  });

  it('setBucketDetailPolicyMode sets the mode only when the open bucket has that name', () => {
    const id = activeId();
    state().openBucketDetail(id, bucket);

    state().setBucketDetailPolicyMode(id, 'other', 'public');
    expect(state().tabList[id].detailBucket).toEqual(bucket);

    state().setBucketDetailPolicyMode(id, 'bkt', 'public');
    expect(state().tabList[id].detailBucket).toMatchObject({ name: 'bkt', policyMode: 'public' });
    expect(bucket).not.toHaveProperty('policyMode');
  });

  it('setBucketDetailPolicyMode gives subscribers a new bucket reference (real Bucket instance)', () => {
    const id = activeId();
    const real = new Bucket({ name: 'bkt', creationDate: '2026-01-02T03:04:05', policyMode: 'private' });
    state().openBucketDetail(id, real);
    const before = state().tabList[id].detailBucket;

    state().setBucketDetailPolicyMode(id, 'bkt', 'public');

    expect(state().tabList[id].detailBucket?.policyMode).toBe('public');
    expect(state().tabList[id].detailBucket).not.toBe(before);
  });

  it('setBucketDetailPolicyMode does nothing without an open detail or for an unknown tab', () => {
    const id = activeId();
    state().setBucketDetailPolicyMode(id, 'bkt', 'public');
    expect(state().tabList[id].detailBucket).toBeUndefined();
    state().setBucketDetailPolicyMode('ghost', 'bkt', 'public');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('ignores an unknown tab', () => {
    state().openBucketDetail('ghost', bucket);
    state().closeBucketDetail('ghost');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('changeCurrentView clears the bucket detail', () => {
    const id = activeId();
    state().openBucketDetail(id, bucket);
    state().changeCurrentView(id, 'objectList', 'bkt');
    expect(state().tabList[id].detailBucket).toBeUndefined();
  });

  it('resetViewByProfile and clearProfile clear the bucket detail of that profile only', () => {
    const mine = activeId();
    state().updateTab(mine, { profileId: 'p1' });
    state().addTab();
    const other = activeId();
    state().updateTab(other, { profileId: 'p2' });
    state().openBucketDetail(mine, bucket);
    state().openBucketDetail(other, bucket);

    state().resetViewByProfile('p1');
    expect(state().tabList[mine].detailBucket).toBeUndefined();
    expect(state().tabList[other].detailBucket).toEqual(bucket);

    state().openBucketDetail(mine, bucket);
    state().clearProfile('p1');
    expect(state().tabList[mine].detailBucket).toBeUndefined();
    expect(state().tabList[other].detailBucket).toEqual(bucket);
  });
});

describe('tabListStore removeBucket', () => {
  const detail = { name: 'bkt', creationDate: '2026-01-02T03:04:05' } as never;
  const other = { name: 'other', creationDate: '2026-01-02T03:04:05' } as never;
  const tabs = () => state().tabList;

  // Four tabs of profile p1 plus one of p2, each given a view.
  function seed() {
    state().restoreTabs({
      tabs: [
        { id: 'inBucket', profileId: 'p1' },
        { id: 'inOther', profileId: 'p1' },
        { id: 'listWithDetail', profileId: 'p1' },
        { id: 'listWithOtherDetail', profileId: 'p1' },
        { id: 'otherProfile', profileId: 'p2' },
      ],
      activeTab: 'inBucket',
    });
    state().changeCurrentView('inBucket', 'objectList', 'bkt');
    state().changePrefix('inBucket', 'dir/');
    state().changeCurrentView('inOther', 'objectList', 'other');
    state().openBucketDetail('listWithDetail', detail);
    state().openBucketDetail('listWithOtherDetail', other);
    state().changeCurrentView('otherProfile', 'objectList', 'bkt');
  }

  beforeEach(() => {
    state().reset();
    vi.clearAllMocks();
    seed();
  });

  it('sends the tabs of the profile that are inside the bucket back to the bucket list', () => {
    state().removeBucket('p1', 'bkt');

    expect(tabs().inBucket).toMatchObject({ currentView: 'bucketList', bucket: undefined, prefix: '' });
  });

  it('keeps the tabs of the profile inside another bucket', () => {
    state().removeBucket('p1', 'bkt');

    expect(tabs().inOther).toMatchObject({ currentView: 'objectList', bucket: 'other' });
  });

  it('closes the detail of the deleted bucket only', () => {
    state().removeBucket('p1', 'bkt');

    expect(tabs().listWithDetail.detailBucket).toBeUndefined();
    expect(tabs().listWithOtherDetail.detailBucket).toEqual(other);
  });

  it('leaves the tabs of other profiles alone', () => {
    state().removeBucket('p1', 'bkt');

    expect(tabs().otherProfile).toMatchObject({ currentView: 'objectList', bucket: 'bkt' });
  });
});
