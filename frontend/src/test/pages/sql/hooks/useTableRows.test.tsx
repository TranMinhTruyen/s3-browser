import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableRows } from '@/pages/sql/hooks/useTableRows';
import { fetchTableRows, openTableRows } from '@/pages/sql/utils/dbObjectSource';

vi.mock('@/pages/sql/utils/dbObjectSource', () => ({ openTableRows: vi.fn(), fetchTableRows: vi.fn() }));

const openMock = vi.mocked(openTableRows);
const fetchMock = vi.mocked(fetchTableRows);

const firstPage = { columns: ['id'], rows: [['1'], ['2']], done: false, cursorId: 5 };

const mount = (table = 'users') =>
  renderHook(({ t }) => useTableRows('tab-1', 'sqlite', 'p1', 'main', t), { initialProps: { t: table } });

/** A call that settles when the test says so. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  openMock.mockResolvedValue(firstPage);
});

describe('useTableRows', () => {
  it('starts loading, then holds the first page and says there is more', async () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ loading: true, rows: [], columns: [], hasMore: false });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({ columns: ['id'], rows: [['1'], ['2']], hasMore: true, loadingMore: false });
    expect(openMock).toHaveBeenCalledWith(
      'sqlite',
      'tab-1',
      { profileId: 'p1', schema: 'main', table: 'users' },
      expect.any(AbortSignal)
    );
  });

  it('has no more rows when the first page is done (even a short one)', async () => {
    openMock.mockResolvedValue({ ...firstPage, rows: [['1']], done: true, cursorId: null });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);
    await act(() => result.current.loadMore());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows no rows when the first load failed', async () => {
    openMock.mockResolvedValue(null);
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({ columns: [], rows: [], hasMore: false });
    await act(() => result.current.loadMore());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the next pages with the cursor and the number of loaded rows until done', async () => {
    fetchMock
      .mockResolvedValueOnce({ rows: [['3']], done: false })
      .mockResolvedValueOnce({ rows: [['4']], done: true });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.loadMore());
    expect(result.current.rows).toEqual([['1'], ['2'], ['3']]);
    expect(result.current.hasMore).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'sqlite',
      'tab-1',
      { profileId: 'p1', schema: 'main', table: 'users' },
      5,
      2,
      expect.any(AbortSignal),
      false
    );

    await act(() => result.current.loadMore());
    expect(result.current.rows).toEqual([['1'], ['2'], ['3'], ['4']]);
    expect(result.current.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'sqlite',
      'tab-1',
      expect.anything(),
      5,
      3,
      expect.any(AbortSignal),
      false
    );

    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps asking for the next page when a page is shorter than the page size but not done', async () => {
    fetchMock.mockResolvedValueOnce({ rows: [['3']], done: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.loadMore());

    expect(result.current.hasMore).toBe(true);
    fetchMock.mockResolvedValueOnce({ rows: [['4']], done: true });
    await act(() => result.current.loadMore());
    expect(result.current.rows).toHaveLength(4);
  });

  it('ignores loadMore while a page is loading and reports loadingMore', async () => {
    const page = deferred<{ rows: (string | null)[][]; done: boolean }>();
    fetchMock.mockReturnValueOnce(page.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: Promise<void>;
    act(() => {
      first = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    page.resolve({ rows: [['3']], done: true });
    await act(() => first);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.rows).toHaveLength(3);
  });

  it('stops asking for more when a page fails, and keeps the rows it has', async () => {
    fetchMock.mockResolvedValueOnce(null);
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.loadMore());

    expect(result.current.rows).toEqual([['1'], ['2']]);
    expect(result.current.hasMore).toBe(false);
    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a page that arrives after unmount and aborts the calls in flight', async () => {
    const page = deferred<{ rows: (string | null)[][]; done: boolean }>();
    fetchMock.mockReturnValueOnce(page.promise);
    const { result, unmount } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    const signal = fetchMock.mock.calls[0][5];

    unmount();
    expect(signal.aborted).toBe(true);
    page.resolve({ rows: [['9']], done: true });
    await pending;
  });

  it('ignores the first page when it arrives after unmount', async () => {
    const page = deferred<typeof firstPage>();
    openMock.mockReturnValueOnce(page.promise);
    const { result, unmount } = mount();
    const signal = openMock.mock.calls[0][3];

    unmount();
    expect(signal.aborted).toBe(true);
    page.resolve(firstPage);
    await act(async () => {});

    expect(result.current.loading).toBe(true);
  });

  const otherPage = { columns: ['x'], rows: [['a']], done: false, cursorId: 9 };

  it.each([
    ['table', { t: 'orders', p: 'p1' }],
    ['profileId', { t: 'users', p: 'p2' }],
  ])('resets at once when the %s changes mid loadMore and drops the late page', async (_name, next) => {
    const late = deferred<{ rows: (string | null)[][]; done: boolean }>();
    fetchMock.mockReturnValueOnce(late.promise);
    const second = deferred<typeof otherPage>();
    const { result, rerender } = renderHook(({ t, p }) => useTableRows('tab-1', 'sqlite', p, 'main', t), {
      initialProps: { t: 'users', p: 'p1' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    openMock.mockReturnValueOnce(second.promise);

    rerender(next);
    expect(result.current).toMatchObject({ rows: [], loading: true, loadingMore: false, hasMore: false });
    // The first page of the new table has not arrived: loadMore does nothing.
    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    late.resolve({ rows: [['late']], done: true });
    await act(() => pending);
    expect(result.current.rows).toEqual([]);
    expect(result.current.loadingMore).toBe(false);

    second.resolve(otherPage);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([['a']]);

    fetchMock.mockResolvedValueOnce({ rows: [['b']], done: true });
    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenLastCalledWith(
      'sqlite',
      'tab-1',
      { profileId: next.p, schema: 'main', table: next.t },
      9,
      1,
      expect.any(AbortSignal),
      false
    );
    expect(result.current.rows).toEqual([['a'], ['b']]);
  });

  it('does not warn when unmounted while loadMore is running', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = deferred<{ rows: (string | null)[][]; done: boolean }>();
    fetchMock.mockReturnValueOnce(page.promise);
    const { result, unmount } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    unmount();
    page.resolve({ rows: [['9']], done: true });
    await pending;
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reloads from the first page when the table changes and drops the old cursor', async () => {
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const second = deferred<Awaited<ReturnType<typeof openTableRows>>>();
    openMock.mockReturnValueOnce(second.promise);

    rerender({ t: 'orders' });
    second.resolve({ columns: ['x'], rows: [['a']], done: true, cursorId: null });

    await waitFor(() => expect(result.current.columns).toEqual(['x']));
    expect(result.current.rows).toEqual([['a']]);
    expect(result.current.hasMore).toBe(false);
    expect(openMock).toHaveBeenLastCalledWith(
      'sqlite',
      'tab-1',
      { profileId: 'p1', schema: 'main', table: 'orders' },
      expect.any(AbortSignal)
    );
  });

  it('gives a resetKey made of the tab and table that changes with the table', async () => {
    const { result, rerender } = mount();
    expect(result.current.resetKey).toBe('tab-1|sqlite|p1|main|users');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resetKey).toBe('tab-1|sqlite|p1|main|users');

    rerender({ t: 'orders' });
    expect(result.current.resetKey).toBe('tab-1|sqlite|p1|main|orders');
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
  describe('fetch all rows', () => {
    type Page = { rows: (string | null)[][]; done: boolean };
    const ready = async () => {
      const hook = mount();
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      return hook;
    };

    it('starts unticked', async () => {
      const { result } = await ready();
      expect(result.current.fetchAll).toBe(false);
    });

    it('ticking reads every remaining row in one call, appends them and ends the cursor', async () => {
      fetchMock.mockResolvedValueOnce({ rows: [['3'], ['4'], ['5']], done: true });
      const { result } = await ready();

      await act(async () => result.current.setFetchAllRows(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'sqlite',
        'tab-1',
        { profileId: 'p1', schema: 'main', table: 'users' },
        5,
        2,
        expect.any(AbortSignal),
        true
      );
      expect(result.current).toMatchObject({ fetchAll: true, hasMore: false, loadingMore: false });
      expect(result.current.rows).toEqual([['1'], ['2'], ['3'], ['4'], ['5']]);
      await act(() => result.current.loadMore());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports loadingMore while it runs and ignores loadMore meanwhile', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result } = await ready();

      act(() => result.current.setFetchAllRows(true));
      expect(result.current).toMatchObject({ fetchAll: true, loadingMore: true });
      await act(() => result.current.loadMore());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => page.resolve({ rows: [['3']], done: true }));
      expect(result.current.loadingMore).toBe(false);
      expect(result.current.rows).toHaveLength(3);
    });

    it('ticking twice does not start a second fetch', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result } = await ready();

      act(() => result.current.setFetchAllRows(true));
      act(() => result.current.setFetchAllRows(true));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => page.resolve({ rows: [], done: true }));
    });

    it('ticking while a normal page loads does not start a second fetch', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result } = await ready();

      act(() => {
        void result.current.loadMore();
      });
      act(() => result.current.setFetchAllRows(true));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][6]).toBe(false);

      await act(async () => page.resolve({ rows: [['3']], done: false }));
    });

    it('ticking with no cursor left reads nothing', async () => {
      openMock.mockResolvedValue({ ...firstPage, done: true, cursorId: null });
      const { result } = await ready();

      await act(async () => result.current.setFetchAllRows(true));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.fetchAll).toBe(true);
    });

    it('unticking while it runs aborts it, keeps loaded rows and ends the cursor', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result } = await ready();
      act(() => result.current.setFetchAllRows(true));
      const signal = fetchMock.mock.calls[0][5];

      act(() => result.current.setFetchAllRows(false));
      expect(signal.aborted).toBe(true);
      expect(result.current).toMatchObject({ fetchAll: false, loadingMore: false, hasMore: false });
      expect(result.current.rows).toEqual([['1'], ['2']]);

      await act(async () => page.resolve({ rows: [['late']], done: true }));
      expect(result.current.rows).toEqual([['1'], ['2']]);
      expect(result.current.hasMore).toBe(false);
      await act(() => result.current.loadMore());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a new fetch can start after an aborted one and the old one does not clear its loading flag', async () => {
      const first = deferred<Page>();
      fetchMock.mockReturnValueOnce(first.promise);
      const { result } = await ready();
      act(() => result.current.setFetchAllRows(true));
      act(() => result.current.setFetchAllRows(false));
      // Cursor is gone, so ticking again reads nothing and the old settle must not touch state.
      act(() => result.current.setFetchAllRows(true));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => first.resolve({ rows: [['x']], done: true }));
      expect(result.current.rows).toHaveLength(2);
    });

    it('unticking when nothing runs only clears the checkbox', async () => {
      const { result } = await ready();
      act(() => result.current.setFetchAllRows(true));
      await act(async () => result.current.setFetchAllRows(false));
      expect(result.current).toMatchObject({ fetchAll: false });
    });

    it('unticking with nothing running keeps hasMore', async () => {
      openMock.mockResolvedValue(firstPage);
      const { result } = await ready();
      act(() => result.current.setFetchAllRows(false));
      expect(result.current.hasMore).toBe(true);
      await act(async () => {});
    });

    it('stops asking for more when the read fails, and keeps the rows', async () => {
      fetchMock.mockResolvedValueOnce(null);
      const { result } = await ready();

      await act(async () => result.current.setFetchAllRows(true));

      expect(result.current.rows).toEqual([['1'], ['2']]);
      expect(result.current).toMatchObject({ hasMore: false, loadingMore: false });
    });

    it('unticks when the table changes', async () => {
      fetchMock.mockResolvedValueOnce({ rows: [['3']], done: true });
      const { result, rerender } = await ready();
      await act(async () => result.current.setFetchAllRows(true));
      expect(result.current.fetchAll).toBe(true);

      rerender({ t: 'orders' });
      expect(result.current.fetchAll).toBe(false);
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('refresh reloads the first page, keeps resetKey and unticks fetch all', async () => {
      const { result } = await ready();
      fetchMock.mockResolvedValueOnce({ rows: [['3']], done: true });
      await act(async () => result.current.setFetchAllRows(true));
      expect(result.current.fetchAll).toBe(true);
      const key = result.current.resetKey;
      const second = deferred<typeof firstPage>();
      openMock.mockReturnValueOnce(second.promise);

      act(() => result.current.refresh());
      expect(result.current).toMatchObject({ loading: true, rows: [], fetchAll: false, loadingMore: false });
      expect(result.current.resetKey).toBe(key);
      expect(openMock).toHaveBeenCalledTimes(2);

      second.resolve({ columns: ['id'], rows: [['9']], done: false, cursorId: 8 });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.rows).toEqual([['9']]);
      expect(result.current.hasMore).toBe(true);
    });

    it('refresh aborts a running read and drops its late page', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result } = await ready();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadMore();
      });
      const signal = fetchMock.mock.calls[0][5];
      expect(result.current.loadingMore).toBe(true);

      act(() => result.current.refresh());
      expect(signal.aborted).toBe(true);
      expect(result.current.loadingMore).toBe(false);
      await waitFor(() => expect(result.current.loading).toBe(false));

      page.resolve({ rows: [['late']], done: true });
      await act(() => pending);
      expect(result.current.rows).toEqual([['1'], ['2']]);
      expect(result.current.hasMore).toBe(true);
    });

    it('after refresh the next page loads from the new cursor', async () => {
      const { result } = await ready();
      openMock.mockResolvedValueOnce({ columns: ['id'], rows: [['7']], done: false, cursorId: 11 });
      act(() => result.current.refresh());
      await waitFor(() => expect(result.current.loading).toBe(false));
      fetchMock.mockResolvedValueOnce({ rows: [['8']], done: true });

      await act(() => result.current.loadMore());

      expect(fetchMock).toHaveBeenLastCalledWith(
        'sqlite',
        'tab-1',
        expect.anything(),
        11,
        1,
        expect.any(AbortSignal),
        false
      );
      expect(result.current.rows).toEqual([['7'], ['8']]);
    });

    it('aborts the read on unmount and drops its rows', async () => {
      const page = deferred<Page>();
      fetchMock.mockReturnValueOnce(page.promise);
      const { result, unmount } = await ready();
      act(() => result.current.setFetchAllRows(true));
      const signal = fetchMock.mock.calls[0][5];

      unmount();
      expect(signal.aborted).toBe(true);
      page.resolve({ rows: [['9']], done: true });
      await act(async () => {});
    });
  });
});
