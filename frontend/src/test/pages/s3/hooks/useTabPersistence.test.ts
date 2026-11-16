import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabPersistence } from '@/pages/s3/hooks/useTabPersistence';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { isTabRestoreFailed, saveTabState } from '@/pages/s3/utils/tabPersistence';

vi.mock('@/pages/s3/utils/tabPersistence', () => ({ saveTabState: vi.fn(), isTabRestoreFailed: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const saveMock = vi.mocked(saveTabState);
const failedMock = vi.mocked(isTabRestoreFailed);
const tabs = () => useTabListStore.getState();
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useTabPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tabs().reset();
    vi.clearAllMocks();
    failedMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not save the first payload', () => {
    renderHook(() => useTabPersistence());
    advance(1000);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('saves once, 500ms after a change', () => {
    renderHook(() => useTabPersistence());
    act(() => tabs().addTab());
    advance(499);
    expect(saveMock).not.toHaveBeenCalled();
    advance(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const { activeTab } = tabs();
    expect(saveMock).toHaveBeenCalledWith({
      tabs: expect.arrayContaining([{ id: activeTab, profileId: null }]),
      activeTab,
    });
    expect(saveMock.mock.calls[0][0].tabs).toHaveLength(2);
  });

  it('debounces consecutive changes into one save of the latest layout', () => {
    renderHook(() => useTabPersistence());
    act(() => tabs().addTab());
    advance(300);
    act(() => tabs().addTab());
    advance(300);
    expect(saveMock).not.toHaveBeenCalled();
    advance(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].tabs).toHaveLength(3);
  });

  it('skips the save when the layout returns to what is already saved', () => {
    renderHook(() => useTabPersistence());
    const original = { activeTab: tabs().activeTab };
    act(() => tabs().addTab());
    const added = tabs().activeTab;
    advance(100);
    act(() => {
      tabs().closeTab(added);
      tabs().setActiveTab(original.activeTab);
    });
    advance(1000);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not save for a change that does not touch the layout', () => {
    renderHook(() => useTabPersistence());
    act(() => tabs().setUploadingTab('x'));
    advance(1000);
    expect(saveMock).not.toHaveBeenCalled();
    act(() => tabs().setUploadingTab(null));
  });

  it('saves a profile change', () => {
    renderHook(() => useTabPersistence());
    act(() => tabs().updateTab(tabs().activeTab, { profileId: 'p1' }));
    advance(500);
    expect(saveMock.mock.calls[0][0].tabs[0].profileId).toBe('p1');
  });

  it('drops the pending save on unmount', () => {
    const { unmount } = renderHook(() => useTabPersistence());
    act(() => tabs().addTab());
    advance(200);
    unmount();
    advance(1000);
    expect(saveMock).not.toHaveBeenCalled();
  });

  describe('layout selector', () => {
    const item = { name: 'a.txt', key: 'a.txt' } as never;

    it.each([
      ['select an object', () => tabs().addSelectItem(tabs().activeTab, ['a'])],
      ['open the detail drawer', () => tabs().openDetail(tabs().activeTab, item)],
      ['change the prefix', () => tabs().changePrefix(tabs().activeTab, 'photos/')],
      ['change the view', () => tabs().changeCurrentView(tabs().activeTab, 'objectList', 'b')],
    ])('does not re-render, serialize or save when you %s', (_name, change) => {
      let renders = 0;
      renderHook(() => {
        renders++;
        useTabPersistence();
      });
      const rendersBefore = renders;
      const stringify = vi.spyOn(JSON, 'stringify');
      act(change);
      advance(1000);
      expect(renders).toBe(rendersBefore);
      expect(stringify).not.toHaveBeenCalled();
      expect(saveMock).not.toHaveBeenCalled();
      stringify.mockRestore();
    });

    it('serializes once per layout change', () => {
      renderHook(() => useTabPersistence());
      const stringify = vi.spyOn(JSON, 'stringify');
      act(() => tabs().addTab());
      expect(stringify).toHaveBeenCalledTimes(1);
      stringify.mockRestore();
    });

    it('saves the new order after moving a tab', () => {
      renderHook(() => useTabPersistence());
      const first = tabs().activeTab;
      act(() => tabs().addTab());
      const second = tabs().activeTab;
      advance(500);
      saveMock.mockClear();
      act(() => tabs().moveTab(second, first));
      advance(500);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock.mock.calls[0][0].tabs.map(t => t.id)).toEqual([second, first]);
    });

    it('saves a new active tab', () => {
      renderHook(() => useTabPersistence());
      const first = tabs().activeTab;
      act(() => tabs().addTab());
      advance(500);
      saveMock.mockClear();
      act(() => tabs().setActiveTab(first));
      advance(500);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock.mock.calls[0][0].activeTab).toBe(first);
    });

    it('keeps each profile with its own tab', () => {
      renderHook(() => useTabPersistence());
      const first = tabs().activeTab;
      act(() => tabs().addTab());
      const second = tabs().activeTab;
      act(() => tabs().updateTab(second, { profileId: 'p2' }));
      advance(500);
      expect(saveMock.mock.calls[0][0].tabs).toEqual([
        { id: first, profileId: null },
        { id: second, profileId: 'p2' },
      ]);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ])('saves a %s profileId as null', (_name, profileId) => {
      renderHook(() => useTabPersistence());
      const id = tabs().activeTab;
      act(() => tabs().updateTab(id, { profileId: 'p1' }));
      advance(500);
      saveMock.mockClear();
      act(() => tabs().updateTab(id, { profileId }));
      advance(500);
      expect(saveMock.mock.calls[0][0].tabs[0]).toEqual({ id, profileId: null });
    });
    it('sends the same payload as serializeTabs, with the same key order', () => {
      renderHook(() => useTabPersistence());
      const first = tabs().activeTab;
      const check = () => {
        advance(500);
        const sent = saveMock.mock.calls.at(-1)?.[0];
        expect(sent).toEqual(tabs().serializeTabs());
        expect(JSON.stringify(sent)).toBe(JSON.stringify(tabs().serializeTabs()));
        saveMock.mockClear();
      };
      act(() => tabs().addTab());
      check();
      const second = tabs().activeTab;
      act(() => tabs().updateTab(second, { profileId: 'p2' }));
      check();
      act(() => tabs().moveTab(second, first));
      check();
    });
  });

  describe('pagehide', () => {
    it('flushes a pending save immediately, once', () => {
      renderHook(() => useTabPersistence());
      act(() => tabs().addTab());
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).toHaveBeenCalledTimes(1);
      advance(1000);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a pending save', () => {
      renderHook(() => useTabPersistence());
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('does nothing when the pending layout is already saved', () => {
      renderHook(() => useTabPersistence());
      act(() => tabs().addTab());
      advance(500);
      saveMock.mockClear();
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('stops listening after unmount', () => {
      const { unmount } = renderHook(() => useTabPersistence());
      act(() => tabs().addTab());
      unmount();
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).not.toHaveBeenCalled();
    });
  });

  describe('after a failed restore', () => {
    beforeEach(() => failedMock.mockReturnValue(true));

    it('never saves, so tabs.json is not overwritten', () => {
      renderHook(() => useTabPersistence());
      act(() => tabs().addTab());
      advance(1000);
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('does not save on pagehide either', () => {
      renderHook(() => useTabPersistence());
      act(() => tabs().addTab());
      window.dispatchEvent(new Event('pagehide'));
      expect(saveMock).not.toHaveBeenCalled();
    });
  });
});
