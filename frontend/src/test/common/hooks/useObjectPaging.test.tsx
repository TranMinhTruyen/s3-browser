import { act, renderHook, waitFor } from '@testing-library/react';
import { GetListObject, SearchObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Activity, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_PAGE_SIZE, NEXT_PAGE_SIZE, useObjectPaging } from '@/common/hooks/useObjectPaging';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ GetListObject: vi.fn(), SearchObject: vi.fn() }));

type Params = Parameters<typeof useObjectPaging>[0];
type Page = { objectList: { key: string }[]; nextCursor?: string };

const page = (keys: string[], nextCursor?: string): Page => ({
  objectList: keys.map(key => ({ key })),
  nextCursor,
});
const keysOf = (r: { current: ReturnType<typeof useObjectPaging> }) => r.current.objectDatas.map(o => o.key);

const scrollTo = vi.fn();
const baseParams = (patch: Partial<Params> = {}): Params => ({
  tabId: 'tab-1',
  connectionId: 'conn',
  profileName: 'prof',
  bucket: 'bkt',
  prefix: 'dir/',
  keyword: '',
  listKey: 'list-1',
  scrollRef: { current: { scrollTo } as unknown as HTMLElement },
  ...patch,
});
const setup = (patch: Partial<Params> = {}) => renderHook(p => useObjectPaging(p), { initialProps: baseParams(patch) });
const mockIPC = () => vi.mocked(callIPC) as unknown as ReturnType<typeof vi.fn>;
const signalOf = (call: number) => (mockIPC().mock.calls[call][2] as { signal: AbortSignal }).signal;

describe('useObjectPaging', () => {
  it('exposes the page sizes', () => {
    expect(FIRST_PAGE_SIZE).toBe(200);
    expect(NEXT_PAGE_SIZE).toBe(1000);
  });

  it('loads the first page of the folder listing', async () => {
    mockIPC().mockResolvedValue(page(['a', 'b'], 'c1'));
    const { result } = setup();

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(
      GetListObject,
      [{ connectionId: 'conn', profileName: 'prof', bucket: 'bkt', prefix: 'dir/', nextCursor: '', limit: 200 }],
      { signal: expect.any(AbortSignal), rejectAction: expect.any(Function) }
    );
    expect(keysOf(result)).toEqual(['a', 'b']);
    expect(result.current.nextCursor).toBe('c1');
    expect(result.current.cursorKey).toBe('list-1');
    expect(result.current.isLoadingFirst).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('searches instead of listing when a keyword is applied and treats a missing cursor as the end', async () => {
    mockIPC().mockResolvedValue(page(['a']));
    const { result } = setup({ keyword: 'abc' });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(
      SearchObject,
      [{ connectionId: 'conn', profileName: 'prof', bucket: 'bkt', prefix: 'dir/', keyword: 'abc', nextCursor: '' }],
      { signal: expect.any(AbortSignal) }
    );
    expect(result.current.nextCursor).toBe('');
  });

  it('does not call the backend without a connection or bucket', async () => {
    const { result: noConn } = setup({ connectionId: undefined });
    const { result: noBucket } = setup({ bucket: undefined });
    await act(async () => {});
    expect(callIPC).not.toHaveBeenCalled();
    expect(noConn.current.isLoaded).toBe(false);
    expect(noBucket.current.objectDatas).toEqual([]);
  });

  it('stays not loaded when the refresh finds no connection', async () => {
    const { result } = setup({ connectionId: undefined });
    await act(async () => {
      await result.current.onRefresh();
    });
    expect(callIPC).not.toHaveBeenCalled();
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.isLoadingFirst).toBe(false);
  });

  it('stays not loaded when the first page fails', async () => {
    mockIPC().mockResolvedValue(null);
    const { result } = setup();
    await waitFor(() => expect(callIPC).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoadingFirst).toBe(false));
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.objectDatas).toEqual([]);
  });

  it('aborts the running request and ignores its late result when the list changes', async () => {
    let resolveOld!: (v: Page) => void;
    mockIPC()
      .mockReturnValueOnce(new Promise<Page>(r => (resolveOld = r)))
      .mockResolvedValueOnce(page(['new']));
    const { result, rerender } = setup();

    rerender(baseParams({ prefix: 'other/', listKey: 'list-2' }));
    await waitFor(() => expect(result.current.cursorKey).toBe('list-2'));
    expect(signalOf(0).aborted).toBe(true);

    await act(async () => resolveOld(page(['old'], 'stale')));
    expect(keysOf(result)).toEqual(['new']);
    expect(result.current.nextCursor).toBe('');
  });

  it.each([
    ['connection', { connectionId: undefined }],
    ['bucket', { bucket: undefined }],
  ])('loads the first page again when the same list comes back after losing the %s', async (_name, lost) => {
    mockIPC().mockResolvedValue(page(['a']));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(callIPC).toHaveBeenCalledTimes(1);

    rerender(baseParams(lost));
    expect(callIPC).toHaveBeenCalledTimes(1);
    rerender(baseParams());

    await waitFor(() => expect(callIPC).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(keysOf(result)).toEqual(['a']);
  });

  it('aborts the running request on unmount', async () => {
    mockIPC().mockReturnValue(new Promise(() => {}));
    const { unmount } = setup();
    await waitFor(() => expect(callIPC).toHaveBeenCalled());
    unmount();
    expect(signalOf(0).aborted).toBe(true);
  });

  describe('next page', () => {
    it('appends the whole page, even a repeated key, and follows the new cursor with the big page size', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
        .mockResolvedValueOnce(page(['b', 'c'], 'c2'));
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));
      expect(mockIPC().mock.calls[0][1]).toEqual([expect.objectContaining({ nextCursor: '', limit: FIRST_PAGE_SIZE })]);

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(mockIPC().mock.calls[1][0]).toBe(GetListObject);
      expect(mockIPC().mock.calls[1][1]).toEqual([
        expect.objectContaining({ nextCursor: 'c1', limit: NEXT_PAGE_SIZE }),
      ]);
      // A folder listing never overlaps, so nothing is filtered.
      expect(keysOf(result)).toEqual(['a', 'b', 'b', 'c']);
      expect(result.current.nextCursor).toBe('c2');
      expect(result.current.isLoadingMore).toBe(false);
    });

    it('keeps the same array when the folder page is empty', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(page([], 'c2'));
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));
      const before = result.current.objectDatas;

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(result.current.objectDatas).toBe(before);
      expect(result.current.nextCursor).toBe('c2');
    });

    it('drops keys already shown while searching, without a page size', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
        .mockResolvedValueOnce(page(['b', 'c'], 'c2'));
      const { result } = setup({ keyword: 'abc' });
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(mockIPC().mock.calls[1][0]).toBe(SearchObject);
      expect(mockIPC().mock.calls[1][1][0]).toEqual(expect.objectContaining({ nextCursor: 'c1', keyword: 'abc' }));
      expect(mockIPC().mock.calls[1][1][0]).not.toHaveProperty('limit');
      expect(keysOf(result)).toEqual(['a', 'b', 'c']);
      expect(result.current.nextCursor).toBe('c2');
    });

    it('keeps the same array when a search page has nothing new', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(page(['a'], 'c2'));
      const { result } = setup({ keyword: 'abc' });
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));
      const before = result.current.objectDatas;

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(result.current.objectDatas).toBe(before);
    });

    it.each([
      ['the same cursor comes back', 'c1'],
      ['no cursor comes back', undefined],
    ])('treats the list as ended when %s', async (_name, next) => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(page(['b'], next));
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(result.current.nextCursor).toBe('');
    });

    it('does nothing without a cursor', async () => {
      mockIPC().mockResolvedValue(page(['a']));
      const { result } = setup();
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(callIPC).toHaveBeenCalledTimes(1);
    });

    it('flags an error on failure and clears it when the user retries', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(page(['b']));
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      await act(async () => {
        await result.current.loadNextPage();
      });
      expect(result.current.loadMoreError).toBe(true);
      expect(result.current.isLoadingMore).toBe(false);

      await act(async () => {
        await result.current.onClickLoadMore();
      });
      expect(result.current.loadMoreError).toBe(false);
      expect(keysOf(result)).toEqual(['a', 'b']);
    });

    it('ignores the result of an aborted next-page request', async () => {
      let resolveNext!: (v: Page) => void;
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockReturnValueOnce(new Promise<Page>(r => (resolveNext = r)));
      const { result, unmount } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadNextPage();
      });
      unmount();
      await act(async () => {
        resolveNext(page(['b'], 'c2'));
        await pending;
      });

      expect(signalOf(1).aborted).toBe(true);
      expect(keysOf(result)).toEqual(['a']);
    });
  });

  describe('access denied', () => {
    const changeCurrentView = vi.fn();
    type Options = { signal: AbortSignal; rejectAction?: (output?: { body?: { accessDenied?: boolean } }) => void };
    const optionsOf = (call: number) => mockIPC().mock.calls[call][2] as Options;

    beforeEach(() => {
      changeCurrentView.mockClear();
      useTabListStore.setState({ changeCurrentView });
    });

    it('goes back to the bucket list when the listing is denied', async () => {
      mockIPC().mockResolvedValue(null);
      setup();
      await waitFor(() => expect(callIPC).toHaveBeenCalled());

      optionsOf(0).rejectAction?.({ body: { accessDenied: true } });

      expect(changeCurrentView).toHaveBeenCalledExactlyOnceWith('tab-1', 'bucketList');
    });

    it.each([
      ['access is not denied', { body: { accessDenied: false } }],
      ['there is no body', {}],
      ['there is no output', undefined],
    ])('keeps the view when %s', async (_name, output) => {
      mockIPC().mockResolvedValue(null);
      setup();
      await waitFor(() => expect(callIPC).toHaveBeenCalled());

      optionsOf(0).rejectAction?.(output);

      expect(changeCurrentView).not.toHaveBeenCalled();
    });

    it('keeps the view when the request was already aborted', async () => {
      mockIPC().mockReturnValue(new Promise(() => {}));
      const { unmount } = setup();
      await waitFor(() => expect(callIPC).toHaveBeenCalled());
      unmount();

      optionsOf(0).rejectAction?.({ body: { accessDenied: true } });

      expect(changeCurrentView).not.toHaveBeenCalled();
    });

    it('does not pass rejectAction to search', async () => {
      mockIPC().mockResolvedValue(page(['a']));
      setup({ keyword: 'abc' });
      await waitFor(() => expect(callIPC).toHaveBeenCalled());

      expect(optionsOf(0)).not.toHaveProperty('rejectAction');
    });

    it('keeps the view when a next page is denied', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(null);
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      await act(async () => {
        await result.current.loadNextPage();
      });
      optionsOf(1).rejectAction?.({ body: { accessDenied: true } });

      expect(changeCurrentView).not.toHaveBeenCalled();
    });
  });

  it('reloads from the first page on refresh', async () => {
    mockIPC()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['z']));
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    scrollTo.mockClear();

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(keysOf(result)).toEqual(['z']);
    expect(result.current.nextCursor).toBe('');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('works when the scroll container is not mounted', async () => {
    mockIPC().mockResolvedValue(page(['a']));
    const { result } = setup({ scrollRef: { current: null } });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await act(async () => {
      await result.current.onRefresh();
    });
    expect(keysOf(result)).toEqual(['a']);
  });

  describe('when the tab is only hidden (Activity)', () => {
    const tabState = { currentView: 'objectList' as const, prefix: '', selectionItem: {}, deletingItems: {} };
    let mode: 'visible' | 'hidden' = 'visible';
    const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;
    const setupActivity = () => renderHook(p => useObjectPaging(p), { initialProps: baseParams(), wrapper });
    const hide = (rerender: (p: Params) => void) => {
      useTabListStore.setState({ activeTab: 'tab-2' });
      mode = 'hidden';
      rerender(baseParams());
    };
    const show = (rerender: (p: Params) => void) => {
      useTabListStore.setState({ activeTab: 'tab-1' });
      mode = 'visible';
      rerender(baseParams());
    };

    beforeEach(() => {
      mode = 'visible';
      useTabListStore.setState({ activeTab: 'tab-1', tabList: { 'tab-1': tabState, 'tab-2': tabState } });
    });

    it('does not abort the running request, and its page is there when the tab is shown', async () => {
      let resolve: (v: Page) => void = () => {};
      mockIPC().mockReturnValueOnce(new Promise<Page>(r => (resolve = r)));
      const { result, rerender } = setupActivity();
      await waitFor(() => expect(callIPC).toHaveBeenCalledTimes(1));

      hide(rerender);
      expect(signalOf(0).aborted).toBe(false);

      await act(async () => resolve(page(['a', 'b'], 'c1')));
      show(rerender);
      await waitFor(() => expect(keysOf(result)).toEqual(['a', 'b']));
      expect(callIPC).toHaveBeenCalledTimes(1);
      expect(result.current.isLoaded).toBe(true);
      expect(result.current.nextCursor).toBe('c1');
    });

    it('keeps the loaded list and does not load the first page again when shown', async () => {
      mockIPC().mockResolvedValue(page(['a'], 'c1'));
      const { result, rerender } = setupActivity();
      await waitFor(() => expect(result.current.isLoaded).toBe(true));
      scrollTo.mockClear();

      hide(rerender);
      show(rerender);

      expect(callIPC).toHaveBeenCalledTimes(1);
      expect(keysOf(result)).toEqual(['a']);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('loads the first page again when the list source changed while hidden', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a']))
        .mockResolvedValueOnce(page(['z']));
      const { result, rerender } = setupActivity();
      await waitFor(() => expect(result.current.isLoaded).toBe(true));

      hide(rerender);
      useTabListStore.setState({ activeTab: 'tab-1' });
      mode = 'visible';
      rerender(baseParams({ prefix: 'other/', listKey: 'list-2' }));

      await waitFor(() => expect(keysOf(result)).toEqual(['z']));
      expect(callIPC).toHaveBeenCalledTimes(2);
    });

    it('still aborts when the tab is closed while visible', async () => {
      mockIPC().mockReturnValue(new Promise(() => {}));
      const { unmount } = setupActivity();
      await waitFor(() => expect(callIPC).toHaveBeenCalled());

      useTabListStore.setState({ tabList: { 'tab-2': tabState } });
      unmount();

      expect(signalOf(0).aborted).toBe(true);
    });

    it('loads the first page again when remounted after a real unmount', async () => {
      mockIPC().mockResolvedValue(page(['a']));
      const first = setupActivity();
      await waitFor(() => expect(first.result.current.isLoaded).toBe(true));
      first.unmount();

      const second = setupActivity();
      await waitFor(() => expect(second.result.current.isLoaded).toBe(true));
      expect(callIPC).toHaveBeenCalledTimes(2);
    });

    it('aborts the running request when a hidden tab is closed', async () => {
      mockIPC().mockReturnValue(new Promise(() => {}));
      const { rerender, unmount } = setupActivity();
      await waitFor(() => expect(callIPC).toHaveBeenCalled());

      hide(rerender);
      useTabListStore.setState({ tabList: { 'tab-2': tabState } });
      unmount();

      expect(signalOf(0).aborted).toBe(true);
    });
  });
});
