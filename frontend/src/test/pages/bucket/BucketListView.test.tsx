import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetListBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
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
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ GetListBucket: vi.fn() }));
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
}: {
  profile?: ConnectionProfileOutput | null;
  active?: boolean;
} = {}) {
  const scrollRef = { current: document.createElement('div') } as RefObject<HTMLElement | null>;
  const ref = createRef<BucketListViewRef>();
  const onSelectBucket = vi.fn();
  const ui = (pr: ConnectionProfileOutput | null | undefined) => (
    <BucketListView profile={pr} active={active} scrollRef={scrollRef} onSelectBucket={onSelectBucket} ref={ref} />
  );
  const view = renderWithProviders(ui(p));
  return {
    ...view,
    ref,
    scrollRef,
    onSelectBucket,
    rerenderWith: (pr: ConnectionProfileOutput | null) => view.rerender(ui(pr)),
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
});
