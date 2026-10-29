import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetListBucket, SearchBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { Bucket } from '@wails/S3Browser/models/bucket';
import { createRef, RefObject } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';
import BucketListView, { BucketListViewRef } from '@/pages/bucket/BucketListView';
import { renderWithProviders } from '@/test/renderWithProviders';

// jsdom has no layout, so render every row; `endIndex` is the last row the user "sees" (null = end of list).
const virtual = vi.hoisted(() => ({ endIndex: null as number | null }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
    getScrollElement,
    estimateSize,
  }: {
    count: number;
    getItemKey: (i: number) => string;
    getScrollElement: () => unknown;
    estimateSize: () => number;
  }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: getItemKey(index), index, start: 0 })),
    getTotalSize: () => (getScrollElement(), count * estimateSize()),
    measureElement: () => {},
    range: count === 0 ? null : { startIndex: 0, endIndex: virtual.endIndex ?? count - 1 },
  }),
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ GetListBucket: vi.fn(), SearchBucket: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn() }));

const profile = { id: 'conn', name: 'my-profile' } as ConnectionProfileOutput;
const other = { id: 'conn-2', name: 'other' } as ConnectionProfileOutput;
const b = (name?: string) => new Bucket({ name, creationDate: '2026-01-02T03:04:05' });
const page = (bucketList: Bucket[], nextCursor = '') => ({ bucketList, nextCursor });

const callIPCMock = vi.mocked(callIPC);
// Each call resolves with the next queued value (the last one repeats); null means a failed request.
let queue: unknown[] = [];

function renderList({
  profile: p = profile,
  active = true,
  keyword,
}: {
  profile?: ConnectionProfileOutput | null;
  active?: boolean;
  keyword?: string;
} = {}) {
  const scrollRef = { current: document.createElement('div') } as RefObject<HTMLElement | null>;
  const ref = createRef<BucketListViewRef>();
  const onSelectBucket = vi.fn();
  const ui = (pr: ConnectionProfileOutput | null | undefined, kw = keyword) => (
    <BucketListView
      profile={pr}
      active={active}
      scrollRef={scrollRef}
      keyword={kw}
      onSelectBucket={onSelectBucket}
      ref={ref}
    />
  );
  const view = renderWithProviders(ui(p));
  return {
    ...view,
    ref,
    scrollRef,
    onSelectBucket,
    rerenderWith: (pr: ConnectionProfileOutput | null) => view.rerender(ui(pr)),
    setKeyword: (kw?: string) => view.rerender(ui(p, kw)),
  };
}

describe('BucketListView', () => {
  beforeEach(() => {
    virtual.endIndex = null;
    queue = [page([b('alpha'), b('beta')])];
    callIPCMock.mockImplementation((async () => (queue.length > 1 ? queue.shift() : queue[0])) as never);
  });

  it('loads the first page with the profile parameters and renders the rows', async () => {
    renderList();
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      GetListBucket,
      [{ connectionId: 'conn', profileName: 'my-profile', nextCursor: '', limit: 10 }],
      { signal: expect.any(AbortSignal) }
    );
  });

  it('does not request anything without a connected profile', () => {
    renderList({ profile: null });
    expect(callIPCMock).not.toHaveBeenCalled();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('shows an empty list when the output has no buckets or cursor', async () => {
    queue = [{}];
    renderList();
    await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('keeps the list empty when the request fails', async () => {
    queue = [null];
    renderList();
    await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('reports the selected bucket name', async () => {
    const { onSelectBucket } = renderList();
    await userEvent.click(await screen.findByText('beta'));
    expect(onSelectBucket).toHaveBeenCalledExactlyOnceWith('beta');
  });

  it('renders a bucket without a name', async () => {
    queue = [page([b(undefined)])];
    renderList();
    await waitFor(() => expect(document.querySelectorAll('[data-index]')).toHaveLength(1));
  });

  it('loads the next page with the cursor and appends it', async () => {
    queue = [page([b('alpha')], 'c1'), page([b('beta')], '')];
    renderList();
    expect(await screen.findByText('beta')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(callIPCMock.mock.calls[1][1]).toEqual([
      { connectionId: 'conn', profileName: 'my-profile', nextCursor: 'c1', limit: 10 },
    ]);
  });

  it('appends a next page that has no bucket list and ends paging', async () => {
    queue = [page([b('alpha')], 'c1'), {}];
    renderList();
    await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('shows a loader while the next page loads', async () => {
    let finish: (v: unknown) => void = () => {};
    callIPCMock.mockImplementation((async (_f: unknown, args: [{ nextCursor: string }]) =>
      args[0].nextCursor ? new Promise(r => (finish = r)) : page([b('alpha')], 'c1')) as never);
    renderList();
    await waitFor(() => expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument());
    await act(async () => finish(page([b('beta')])));
    await waitFor(() => expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument());
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('does not retry in a loop after the next page fails', async () => {
    queue = [page([b('alpha')], 'c1'), null];
    renderList();
    await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('does not load the next page while the end is far below the viewport', async () => {
    virtual.endIndex = 0;
    queue = [page(['a', 'b', 'c', 'd', 'e'].map(b), 'c1')];
    renderList();
    expect(await screen.findByText('e')).toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('does not load the next page while inactive', async () => {
    queue = [page([b('alpha')], 'c1')];
    renderList({ active: false });
    await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('reloads from the first page when the profile changes', async () => {
    queue = [page([b('alpha')]), page([b('gamma')])];
    const { rerenderWith } = renderList();
    await screen.findByText('alpha');
    rerenderWith(other);
    expect(await screen.findByText('gamma')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('hides the list when the profile is removed', async () => {
    const { rerenderWith } = renderList();
    await screen.findByText('alpha');
    rerenderWith(null);
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });

  it('refresh clears, reloads and scrolls to the top', async () => {
    queue = [page([b('alpha')]), page([b('delta')])];
    const { ref, scrollRef } = renderList();
    await screen.findByText('alpha');
    const scrollTo = vi.fn();
    scrollRef.current!.scrollTo = scrollTo;
    await act(async () => ref.current?.onRefresh?.());
    expect(await screen.findByText('delta')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });
  });

  it('refresh works when the scroll element is gone', async () => {
    const { ref, scrollRef } = renderList();
    await screen.findByText('alpha');
    scrollRef.current = null;
    await act(async () => ref.current?.onRefresh?.());
    expect(await screen.findByText('alpha')).toBeInTheDocument();
  });

  it('cancels the running request when unmounted', async () => {
    let signal: AbortSignal | undefined;
    callIPCMock.mockImplementation((async (_f: unknown, _a: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => {});
    }) as never);
    const { unmount } = renderList();
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('ignores a stale first-page response after a newer request', async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    callIPCMock.mockImplementation((async () => new Promise(r => resolvers.push(r))) as never);
    const { ref } = renderList();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    act(() => {
      ref.current?.onRefresh?.();
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[0](page([b('stale')])));
    await act(async () => resolvers[1](page([b('fresh')])));
    expect(await screen.findByText('fresh')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('refresh without a profile requests nothing', async () => {
    const { ref } = renderList({ profile: null });
    await act(async () => ref.current?.onRefresh?.());
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('ignores a next-page response that was cancelled by a refresh', async () => {
    const pending: ((v: unknown) => void)[] = [];
    callIPCMock.mockImplementation((async (_f: unknown, args: [{ nextCursor: string }]) =>
      args[0].nextCursor ? new Promise(r => pending.push(r)) : page([b('alpha')], 'c1')) as never);
    const { ref } = renderList();
    await waitFor(() => expect(pending).toHaveLength(1));
    callIPCMock.mockImplementation((async () => page([b('fresh')])) as never);
    await act(async () => ref.current?.onRefresh?.());
    await act(async () => pending[0](page([b('stale')])));
    expect(screen.getByText('fresh')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  describe('empty state', () => {
    const EMPTY = 'No buckets yet';
    const NO_MATCH = 'No matching buckets';
    const pending = () => new Promise(() => {}) as never;

    it('shows the empty message once an empty list has loaded without a cursor', async () => {
      queue = [page([])];
      renderList();
      expect(await screen.findByText(EMPTY)).toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
    });

    it('shows the search message instead when a keyword is applied', async () => {
      queue = [page([])];
      renderList({ keyword: 'kw' });
      expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('does not show it while loading', async () => {
      callIPCMock.mockImplementation(pending);
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('does not show it when the first page failed', async () => {
      queue = [null];
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('does not show it while a cursor is left', async () => {
      callIPCMock.mockImplementationOnce((async () => page([], 'c1')) as never).mockImplementation(pending);
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('does not show it for the previous list right after the keyword changes', async () => {
      queue = [page([])];
      const { setKeyword } = renderList();
      expect(await screen.findByText(EMPTY)).toBeInTheDocument();
      callIPCMock.mockImplementation(pending);
      setKeyword('kw');
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
    });

    it('does not show it without a profile', () => {
      renderList({ profile: null });
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('shows it after a refresh finds no buckets, but not while the refresh is pending', async () => {
      queue = [page([b('alpha')])];
      const { ref } = renderList();
      await screen.findByText('alpha');
      let finish: (v: unknown) => void = () => {};
      callIPCMock.mockImplementation((async () => new Promise(r => (finish = r))) as never);
      act(() => {
        ref.current?.onRefresh?.();
      });
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
      await act(async () => finish(page([])));
      expect(await screen.findByText(EMPTY)).toBeInTheDocument();
      expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    });

    it('hides it when the connection is lost', async () => {
      queue = [page([])];
      const { rerenderWith } = renderList();
      expect(await screen.findByText(EMPTY)).toBeInTheDocument();
      rerenderWith(null);
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    const args = (nextCursor = '') => [{ connectionId: 'conn', profileName: 'my-profile', keyword: 'kw', nextCursor }];
    const searchCalls = () => callIPCMock.mock.calls.filter(c => c[0] === SearchBucket);
    const noMoreButton = () => expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    const loader = () => document.querySelector('.mantine-Loader-root');

    it('searches with the keyword instead of listing', async () => {
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('alpha')).toBeInTheDocument();
      expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(SearchBucket, args(), { signal: expect.any(AbortSignal) });
    });

    it('lists again when the keyword is cleared and searches when it is applied', async () => {
      queue = [page([b('alpha')])];
      const { setKeyword } = renderList();
      await screen.findByText('alpha');
      queue = [page([b('found')])];
      setKeyword('kw');
      expect(await screen.findByText('found')).toBeInTheDocument();
      expect(screen.queryByText('alpha')).not.toBeInTheDocument();
      expect(callIPCMock.mock.calls.at(-1)?.[0]).toBe(SearchBucket);
      queue = [page([b('alpha')])];
      setKeyword('');
      expect(await screen.findByText('alpha')).toBeInTheDocument();
      expect(callIPCMock.mock.calls.at(-1)?.[0]).toBe(GetListBucket);
    });

    it('cancels the previous request when the keyword changes', async () => {
      const signals: AbortSignal[] = [];
      callIPCMock.mockImplementation((async (_f: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signals.push(o.signal);
        return new Promise(() => {});
      }) as never);
      const { setKeyword } = renderList();
      await waitFor(() => expect(signals).toHaveLength(1));
      setKeyword('kw');
      await waitFor(() => expect(signals).toHaveLength(2));
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it('follows nextCursor and drops names already shown', async () => {
      queue = [page([b('alpha')], 'c1'), page([b('alpha'), b('beta')])];
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('beta')).toBeInTheDocument();
      expect(screen.getAllByText('alpha')).toHaveLength(1);
      expect(searchCalls()).toHaveLength(2);
      expect(searchCalls()[1][1]).toEqual(args('c1'));
    });

    it('treats a returned cursor equal to the one sent as the end', async () => {
      queue = [page([b('alpha')], 'c1'), page([b('beta')], 'c1')];
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('beta')).toBeInTheDocument();
      await act(async () => {});
      expect(callIPCMock).toHaveBeenCalledTimes(2);
      noMoreButton();
    });

    it('treats an empty page with the same cursor as the end', async () => {
      queue = [page([b('alpha')], 'c1'), page([], 'c1')];
      renderList({ keyword: 'kw' });
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(callIPCMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('alpha')).toBeInTheDocument();
      noMoreButton();
    });

    it('shows the empty message when nothing matches and no cursor is left', async () => {
      queue = [page([])];
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('No matching buckets')).toBeInTheDocument();
      noMoreButton();
    });

    it('does not show the empty message when not searching', async () => {
      queue = [page([])];
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByText('No matching buckets')).not.toBeInTheDocument();
    });

    it('does not show the empty message while the first search page loads', async () => {
      callIPCMock.mockImplementation((() => new Promise(() => {})) as never);
      renderList({ keyword: 'kw' });
      await waitFor(() => expect(loader()).toBeInTheDocument());
      expect(screen.queryByText('No matching buckets')).not.toBeInTheDocument();
    });

    it('shows no first-page loader when not searching', async () => {
      callIPCMock.mockImplementation((() => new Promise(() => {})) as never);
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      expect(loader()).not.toBeInTheDocument();
    });

    it('hides the first-page loader when the connection is lost', async () => {
      callIPCMock.mockImplementation((() => new Promise(() => {})) as never);
      const { rerenderWith } = renderList({ keyword: 'kw' });
      await waitFor(() => expect(loader()).toBeInTheDocument());
      rerenderWith(null);
      expect(loader()).not.toBeInTheDocument();
    });

    // The old cursor still sits in state for one render after the source changes, with the list near its end.
    it('never sends the list cursor to the search when the keyword is applied', async () => {
      virtual.endIndex = 0;
      callIPCMock.mockImplementation((async (f: unknown) =>
        f === SearchBucket ? page([b('found')]) : page(['a', 'b', 'c', 'd', 'e'].map(b), 'list-cursor')) as never);
      const { setKeyword } = renderList();
      await screen.findByText('e');
      virtual.endIndex = null;
      setKeyword('kw');
      expect(await screen.findByText('found')).toBeInTheDocument();
      await act(async () => {});
      expect(searchCalls()).toHaveLength(1);
      expect(searchCalls()[0][1]).toEqual(args());
      expect(loader()).not.toBeInTheDocument();
    });

    it('never sends the search cursor to the list when the keyword is cleared', async () => {
      virtual.endIndex = 0;
      callIPCMock.mockImplementation((async (f: unknown) =>
        f === SearchBucket ? page(['a', 'b', 'c', 'd', 'e'].map(b), 'search-cursor') : page([b('listed')])) as never);
      const { setKeyword } = renderList({ keyword: 'kw' });
      await screen.findByText('e');
      virtual.endIndex = null;
      setKeyword('');
      expect(await screen.findByText('listed')).toBeInTheDocument();
      await act(async () => {});
      const listCalls = callIPCMock.mock.calls.filter(c => c[0] === GetListBucket);
      expect(listCalls).toHaveLength(1);
      expect(listCalls[0][1]).toEqual([{ connectionId: 'conn', profileName: 'my-profile', nextCursor: '', limit: 10 }]);
      expect(loader()).not.toBeInTheDocument();
    });

    it('does not auto-load an empty search page with a cursor; the button continues it', async () => {
      queue = [page([], 'c1'), page([b('beta')])];
      const user = userEvent.setup();
      renderList({ keyword: 'kw' });
      const more = await screen.findByRole('button', { name: 'Search more' });
      await act(async () => {});
      expect(callIPCMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('No matching buckets')).not.toBeInTheDocument();
      await user.click(more);
      expect(await screen.findByText('beta')).toBeInTheDocument();
      expect(callIPCMock.mock.calls[1][1]).toEqual(args('c1'));
      noMoreButton();
    });

    it('offers the button after the next page failed and retries with it', async () => {
      queue = [page([b('alpha')], 'c1'), null, page([b('beta')])];
      const user = userEvent.setup();
      renderList({ keyword: 'kw' });
      const more = await screen.findByRole('button', { name: 'Search more' });
      expect(callIPCMock).toHaveBeenCalledTimes(2);
      await user.click(more);
      expect(await screen.findByText('beta')).toBeInTheDocument();
      expect(callIPCMock).toHaveBeenCalledTimes(3);
      expect(callIPCMock.mock.calls[2][1]).toEqual(args('c1'));
    });

    it('has no search button when not searching, even after a failed page', async () => {
      queue = [page([b('alpha')], 'c1'), null];
      renderList();
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      noMoreButton();
    });

    it('refresh searches again from the first page', async () => {
      const { ref } = renderList({ keyword: 'kw' });
      await screen.findByText('alpha');
      await act(async () => ref.current?.onRefresh?.());
      expect(searchCalls()).toHaveLength(2);
      expect(searchCalls()[1][1]).toEqual(args());
    });

    it('searches nothing without a connection', () => {
      renderList({ keyword: 'kw', profile: null });
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });
});
