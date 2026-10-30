import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabPersistence } from '@/common/hooks/useTabPersistence';
import { useTabListStore } from '@/common/stores/tabListStore';
import { isTabRestoreFailed, saveTabState } from '@/common/utils/tabPersistence';

vi.mock('@/common/utils/tabPersistence', () => ({ saveTabState: vi.fn(), isTabRestoreFailed: vi.fn() }));
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
    expect(saveMock).toHaveBeenCalledWith(tabs().serializeTabs());
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
    const original = tabs().serializeTabs();
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
