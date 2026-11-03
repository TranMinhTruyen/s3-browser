import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import { isTabHidden, onTabGone } from '@/common/utils/tabUtils';

const tabState = { currentView: 'bucketList' as const, prefix: '', selectionItem: {}, deletingItems: {} };

describe('isTabHidden', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it.each([
    ['the tab exists and is not the active one', { a: tabState, b: tabState }, 'a', 'b', true],
    ['the tab is the active one', { a: tabState, b: tabState }, 'a', 'a', false],
    ['the tab was closed (not in the list anymore)', { a: tabState }, 'a', 'gone', false],
    ['there is no active tab', { a: tabState }, undefined, 'a', true],
    ['the tab list is empty', {}, undefined, 'a', false],
  ] as const)('is %s -> %s', (_name, tabList, activeTab, tabId, expected) => {
    useTabListStore.setState({ tabList: { ...tabList }, activeTab });
    expect(isTabHidden(tabId)).toBe(expected);
  });
});

describe('onTabGone', () => {
  const state = (activeTab: string | undefined, ids: string[]) => ({
    activeTab,
    tabList: Object.fromEntries(ids.map(id => [id, tabState])),
  });
  // Counts the subscriptions still alive on the store.
  const trackSubscriptions = () => {
    const original = useTabListStore.subscribe;
    const live = { count: 0 };
    vi.spyOn(useTabListStore, 'subscribe').mockImplementation(listener => {
      live.count += 1;
      const unsubscribe = original(listener);
      let done = false;
      return () => {
        if (!done) live.count -= 1;
        done = true;
        unsubscribe();
      };
    });
    return live;
  };

  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['the tab is the active one', 'a'],
    ['the tab is already gone', 'gone'],
  ])('runs fn right away when %s', (_name, tabId) => {
    useTabListStore.setState(state('a', ['a', 'b']));
    const fn = vi.fn();
    const live = trackSubscriptions();

    onTabGone(tabId, fn)();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(live.count).toBe(0);
  });

  it('does nothing until the cleanup is called', () => {
    useTabListStore.setState(state('a', ['a', 'b']));
    const fn = vi.fn();
    onTabGone('b', fn);
    useTabListStore.setState(state('a', ['a']));
    expect(fn).not.toHaveBeenCalled();
  });

  it('waits for a hidden tab to be closed, then runs fn once and unsubscribes', () => {
    useTabListStore.setState(state('a', ['a', 'b']));
    const fn = vi.fn();
    const live = trackSubscriptions();

    onTabGone('b', fn)();
    expect(fn).not.toHaveBeenCalled();
    expect(live.count).toBe(1);

    useTabListStore.setState(state('a', ['a']));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(live.count).toBe(0);

    useTabListStore.setState(state('a', ['a', 'c']));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs fn when the hidden tab is closed together with an active tab change', () => {
    useTabListStore.setState(state('a', ['a', 'b']));
    const fn = vi.fn();
    onTabGone('b', fn)();

    useTabListStore.setState(state('c', ['c']));

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops waiting without running fn when the tab is shown again', () => {
    useTabListStore.setState(state('a', ['a', 'b']));
    const fn = vi.fn();
    const live = trackSubscriptions();
    onTabGone('b', fn)();

    useTabListStore.setState(state('b', ['a', 'b']));
    expect(live.count).toBe(0);

    useTabListStore.setState(state('a', ['a']));
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps waiting while the tab stays hidden and another tab becomes active', () => {
    useTabListStore.setState(state('a', ['a', 'b', 'c']));
    const fn = vi.fn();
    const live = trackSubscriptions();
    onTabGone('b', fn)();

    useTabListStore.setState(state('c', ['a', 'b', 'c']));
    useTabListStore.setState(state('c', ['a', 'b', 'c', 'd']));

    expect(fn).not.toHaveBeenCalled();
    expect(live.count).toBe(1);

    useTabListStore.setState(state('c', ['a', 'c']));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(live.count).toBe(0);
  });
});
