import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectActiveTab, useTabListStore } from '@/common/stores/tabListStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

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
    expect(selectActiveTab(state())).toMatchObject({ currentView: 'bucketList', prefix: '' });
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

  describe('closeTab', () => {
    it('does nothing for the last tab or an unknown tab', () => {
      state().closeTab(activeId());
      expect(Object.keys(state().tabList)).toHaveLength(1);
      state().addTab();
      state().closeTab('ghost');
      expect(Object.keys(state().tabList)).toHaveLength(2);
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
      selectionItem: [],
    });
    expect(state().tabList[id].detailItem).toBeUndefined();

    state().changeCurrentView(id, 'bucketList', 'bkt');
    expect(state().tabList[id].bucket).toBeUndefined();
    state().changeCurrentView('ghost', 'bucketList');
    expect(state().tabList.ghost).toBeUndefined();
  });

  it('changePrefix clears selection and detail', () => {
    const id = activeId();
    state().addSelectItem(id, ['x']);
    state().openDetail(id, item);
    state().changePrefix(id, 'a/');
    expect(state().tabList[id]).toMatchObject({ prefix: 'a/', selectionItem: [] });
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

  it('selection actions', () => {
    const id = activeId();
    state().addSelectItem(id, ['a', 'b']);
    state().addSelectItem(id, ['b', 'c']);
    expect(state().tabList[id].selectionItem).toEqual(['a', 'b', 'c']);
    state().removeSelectItem(id, ['b']);
    expect(state().tabList[id].selectionItem).toEqual(['a', 'c']);
    state().clearSelectItem(id);
    expect(state().tabList[id].selectionItem).toEqual([]);

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
    expect(state().tabList[id].deletingItems).toEqual(['a', 'b', 'c']);
    state().setDeleting(id, ['a'], false);
    expect(state().tabList[id].deletingItems).toEqual(['b', 'c']);
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
});
