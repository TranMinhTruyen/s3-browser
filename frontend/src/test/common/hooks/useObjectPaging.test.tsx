import { act, renderHook, waitFor } from '@testing-library/react';
import { GetListObject, SearchObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { describe, expect, it, vi } from 'vitest';
import { OBJECT_PAGE_SIZE, useObjectPaging } from '@/common/hooks/useObjectPaging';
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
  it('exposes the page size', () => {
    expect(OBJECT_PAGE_SIZE).toBe(20);
  });

  it('loads the first page of the folder listing', async () => {
    mockIPC().mockResolvedValue(page(['a', 'b'], 'c1'));
    const { result } = setup();

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(
      GetListObject,
      [{ connectionId: 'conn', profileName: 'prof', bucket: 'bkt', prefix: 'dir/', nextCursor: '', limit: 20 }],
      { signal: expect.any(AbortSignal) }
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

  it('aborts the running request on unmount', async () => {
    mockIPC().mockReturnValue(new Promise(() => {}));
    const { unmount } = setup();
    await waitFor(() => expect(callIPC).toHaveBeenCalled());
    unmount();
    expect(signalOf(0).aborted).toBe(true);
  });

  describe('next page', () => {
    it('appends new keys only and follows the new cursor', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
        .mockResolvedValueOnce(page(['b', 'c'], 'c2'));
      const { result } = setup();
      await waitFor(() => expect(result.current.nextCursor).toBe('c1'));

      await act(async () => {
        await result.current.loadNextPage();
      });

      expect(mockIPC().mock.calls[1][1]).toEqual([expect.objectContaining({ nextCursor: 'c1', limit: 20 })]);
      expect(keysOf(result)).toEqual(['a', 'b', 'c']);
      expect(result.current.nextCursor).toBe('c2');
      expect(result.current.isLoadingMore).toBe(false);
    });

    it('keeps the same array when the page has nothing new', async () => {
      mockIPC()
        .mockResolvedValueOnce(page(['a'], 'c1'))
        .mockResolvedValueOnce(page(['a'], 'c2'));
      const { result } = setup();
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
});
