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
      expect.any(AbortSignal)
    );

    await act(() => result.current.loadMore());
    expect(result.current.rows).toEqual([['1'], ['2'], ['3'], ['4']]);
    expect(result.current.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenLastCalledWith('sqlite', 'tab-1', expect.anything(), 5, 3, expect.any(AbortSignal));

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
      expect.any(AbortSignal)
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
});
