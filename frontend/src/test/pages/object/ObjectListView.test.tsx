import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DeleteObject,
  DeletePrefix,
  DownloadObject,
  GetListObject,
  SearchObject,
  UploadObject,
} from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { Activity, createRef, RefObject } from 'react';
import { toast } from 'sonner';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import UploadLimitModal from '@/components/modals/upload/UploadLimitModal';
import { OBJECT_ROW_HEIGHT } from '@/pages/object/ObjectItem';
import ObjectListView, { ObjectListViewRef } from '@/pages/object/ObjectListView';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
// `endIndex` is the last row the user "sees"; null means the end of the list.
const virtual = vi.hoisted(() => ({
  endIndex: null as number | null,
  scrollElement: null as unknown,
  estimate: null as number | null,
  // Height of the viewport; null means the virtualizer has not measured it yet.
  scrollHeight: null as number | null,
}));
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
    // The real virtualizer asks for these itself; record them so a test can check what it would get.
    getVirtualItems: () => {
      virtual.scrollElement = getScrollElement();
      virtual.estimate = estimateSize();
      return Array.from({ length: count }, (_, index) => ({ key: getItemKey(index), index, start: 0 }));
    },
    getTotalSize: () => count * 100,
    measureElement: () => {},
    scrollRect: virtual.scrollHeight === null ? null : { width: 0, height: virtual.scrollHeight },
    range: count === 0 ? null : { startIndex: 0, endIndex: virtual.endIndex ?? count - 1 },
  }),
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  GetListObject: vi.fn(),
  SearchObject: vi.fn(),
  DeleteObject: vi.fn(),
  DeletePrefix: vi.fn(),
  DownloadObject: vi.fn(),
  UploadObject: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/ipcUtils')>()),
  callIPC: vi.fn(),
}));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/components/modals/upload/UploadLimitModal', () => ({ default: { show: vi.fn() } }));

const TAB_ID = 'tab-1';
const profile = { id: 'conn', name: 'my-profile' } as ConnectionProfileOutput;
const fileA = new ObjectItem({ key: 'a.txt', name: 'a.txt', size: 1, etag: 'ea' });
const fileB = new ObjectItem({ key: 'b.txt', name: 'b.txt', size: 2, etag: 'eb' });
const folder = new ObjectItem({ key: 'dir/', name: 'dir', isFolder: true });

const callIPCMock = vi.mocked(callIPC);
const listMock = vi.mocked(GetListObject);
const confirmMock = vi.mocked(ConfirmModal.show);

const page = (objectList: ObjectItem[], nextCursor = '') => ({ objectList, nextCursor }) as never;

function renderList({
  withProfile = true,
  bucket = 'bkt' as string | null,
  keyword = undefined as string | undefined,
} = {}) {
  const scrollRef = { current: document.createElement('div') } as RefObject<HTMLElement | null>;
  const ref = createRef<ObjectListViewRef>();
  const element = (kw?: string, connected = withProfile, bkt = bucket) => (
    <ObjectListView
      tabId={TAB_ID}
      bucket={bkt ?? undefined}
      profile={connected ? profile : null}
      scrollRef={scrollRef}
      keyword={kw}
      ref={ref}
    />
  );
  const view = renderWithProviders(element(keyword));
  const setKeyword = (kw?: string) => view.rerender(element(kw));
  const disconnect = (kw?: string) => view.rerender(element(kw, false));
  const setBucket = (bkt: string) => view.rerender(element(keyword, withProfile, bkt));
  return { user: userEvent.setup(), ref, scrollRef, setKeyword, disconnect, setBucket, ...view };
}

const cardOf = (name: string) => screen.getByText(name).closest<HTMLElement>('.mantine-Card-root')!;
const tab = () => useTabListStore.getState().tabList[TAB_ID];

describe('ObjectListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    virtual.endIndex = null;
    virtual.scrollHeight = null;
    // Mimics the real callIPC: an Output ({ result, ... }) runs resolveAction/rejectAction and yields its body;
    // any other resolved value is treated as the body itself.
    callIPCMock.mockImplementation((async (
      binding: (...a: unknown[]) => Promise<unknown>,
      args: unknown[],
      options: { resolveAction?: (o: unknown) => void; rejectAction?: (o: unknown) => void } = {}
    ) => {
      let out: unknown;
      try {
        out = await binding(...args);
      } catch {
        // Exception: the real callIPC toasts and calls rejectAction(undefined).
        options.rejectAction?.(undefined);
        return null;
      }
      if (!out || typeof out !== 'object' || !('result' in out)) return out;
      (out.result ? options.resolveAction : options.rejectAction)?.(out);
      return out.result ? (out as unknown as { body: unknown }).body : null;
    }) as unknown as typeof callIPC);
    listMock.mockResolvedValue(page([fileA, fileB, folder]));
    useTabListStore.setState({
      activeTab: TAB_ID,
      tabList: { [TAB_ID]: { currentView: 'objectList', prefix: 'dir/', selectionItem: {}, deletingItems: {} } },
    });
  });

  it('loads the first page with the tab parameters and renders the rows', async () => {
    renderList();
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('dir')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledExactlyOnceWith({
      connectionId: 'conn',
      profileName: 'my-profile',
      bucket: 'bkt',
      prefix: 'dir/',
      nextCursor: '',
      limit: 200,
    });
  });

  it('virtualizes the rows against the tab scroll container with the row size estimate', async () => {
    const { scrollRef } = renderList();
    await screen.findByText('a.txt');
    expect(virtual.scrollElement).toBe(scrollRef.current);
    expect(virtual.estimate).toBe(OBJECT_ROW_HEIGHT);
    expect(OBJECT_ROW_HEIGHT).toBe(88);
  });

  it('loads the next page when the end of the list is reached', async () => {
    listMock.mockResolvedValueOnce(page([fileA], 'cursor-1')).mockResolvedValueOnce(page([fileB]));
    renderList();
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ nextCursor: 'cursor-1' }));
  });

  it('does not load the next page while the end is far below the viewport', async () => {
    virtual.endIndex = 0;
    const many = Array.from({ length: 6 }, (_, i) => new ObjectItem({ key: `f${i}`, name: `f${i}` }));
    listMock.mockResolvedValue(page(many, 'cursor-1'));
    renderList();
    expect(await screen.findByText('f5')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  describe('prefetching the next page', () => {
    // 6 rows: the last index is 5. The threshold index is 5 - max(2, ceil(2 * height / (88 + 8))).
    const many = Array.from({ length: 6 }, (_, i) => new ObjectItem({ key: `f${i}`, name: `f${i}` }));

    it.each([
      ['no viewport measured yet, last row 2 away', null, 3, true],
      ['no viewport measured yet, last row 3 away', null, 2, false],
      ['tiny viewport still prefetches 2 rows ahead', 10, 3, true],
      ['tiny viewport, last row 3 away', 10, 2, false],
      ['viewport of 2 screens = 4 rows ahead', 184, 1, true],
      ['viewport of 2 screens = 4 rows ahead, 5 away', 184, 0, false],
      ['a tall viewport covers the whole list', 460, 0, true],
    ])('%s', async (_name, scrollHeight, endIndex, loads) => {
      virtual.endIndex = endIndex;
      virtual.scrollHeight = scrollHeight;
      listMock.mockResolvedValueOnce(page(many, 'cursor-1')).mockResolvedValueOnce(page([fileB]));
      renderList();
      await screen.findByText('f5');
      await act(async () => {});

      expect(listMock).toHaveBeenCalledTimes(loads ? 2 : 1);
      if (loads) {
        expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ nextCursor: 'cursor-1', limit: 1000 }));
      }
    });

    it('does not ask for a page while the previous one is still loading', async () => {
      listMock.mockResolvedValueOnce(page(many, 'cursor-1')).mockReturnValueOnce(new Promise(() => {}) as never);
      const { setKeyword } = renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();

      // Something else re-renders the list while the page is pending.
      setKeyword(undefined);
      await act(async () => {});

      expect(listMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry in a loop after a failed page', async () => {
      listMock.mockResolvedValueOnce(page(many, 'cursor-1')).mockResolvedValueOnce(null as never);
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      await act(async () => {});

      expect(listMock).toHaveBeenCalledTimes(2);
    });

    it('does not ask for a page when the list has no cursor', async () => {
      listMock.mockResolvedValue(page(many));
      renderList();
      await screen.findByText('f5');
      await act(async () => {});

      expect(listMock).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the detail of the clicked object in the store', async () => {
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('selects an object with its checkbox without opening the detail', async () => {
    const { user } = renderList();
    await screen.findByText('a.txt');
    await user.click(within(cardOf('a.txt')).getByRole('checkbox'));
    expect(tab().selectionItem).toEqual({ 'a.txt': true });
    expect(tab().detailItem).toBeUndefined();
  });

  // Result is false as soon as one key failed (backend contract).
  const deleteOutput = (...messages: [code: string, key: string][]) =>
    ({
      result: messages.every(([code]) => code === 'S3S005'),
      body: null,
      messageList: messages.map(([messageCode, key]) => ({ messageCode, params: { object: key } })),
    }) as never;

  const deleteViaMenu = async (user: ReturnType<typeof renderList>['user'], name: string) => {
    await user.click(within(cardOf(name)).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
  };

  it('closes the drawer when its object is deleted in a partially failed delete', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockResolvedValue(deleteOutput(['S3S005', 'a.txt'], ['S3E013', 'b.txt']));
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    await deleteViaMenu(user, 'a.txt');
    await waitFor(() => expect(tab().detailItem).toBeUndefined());
  });

  // Without the filter these messages would be stringified to 'undefined' / 'null' / '' and match a drawer with that key.
  it.each([
    ['undefined', [{ messageCode: 'S3S005' }, { messageCode: 'S3S005', params: {} }]],
    ['null', [{ messageCode: 'S3S005', params: { object: null } }]],
    ['', [{ messageCode: 'S3S005', params: { object: '' } }]],
  ])('ignores success messages without a usable object param (drawer key "%s")', async (detailKey, messageList) => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockResolvedValue({ result: true, body: null, messageList } as never);
    const { user } = renderList();
    await screen.findByText('a.txt');
    useTabListStore.getState().openDetail(TAB_ID, new ObjectItem({ key: detailKey, name: 'x' }));

    await deleteViaMenu(user, 'a.txt');
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem?.key).toBe(detailKey);
  });

  it('keeps the drawer open when its object failed in a partially failed delete', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockResolvedValue(deleteOutput(['S3E013', 'a.txt'], ['S3S005', 'b.txt']));
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    await deleteViaMenu(user, 'a.txt');
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('keeps the drawer open when the delete call throws', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockRejectedValue(new Error('boom'));
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    await deleteViaMenu(user, 'a.txt');
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('closes the drawer when its own object is deleted', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockResolvedValue(deleteOutput(['S3S005', 'a.txt']));
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));
    expect(tab().detailItem).toEqual(fileA);

    listMock.mockResolvedValue(page([fileB]));
    await user.click(within(cardOf('a.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(tab().detailItem).toBeUndefined());
  });

  it('keeps the drawer open when deleting its object failed', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeleteObject).mockResolvedValue(deleteOutput(['S3E013', 'a.txt']));
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    await user.click(within(cardOf('a.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('keeps the drawer open when another object is deleted', async () => {
    confirmMock.mockResolvedValue(true as never);
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    await user.click(within(cardOf('b.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(DeleteObject).toHaveBeenCalled());
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('keeps the drawer open after a refresh even if its object is not in the first page', async () => {
    confirmMock.mockResolvedValue(true as never);
    const { user } = renderList();
    await user.click(await screen.findByText('a.txt'));

    listMock.mockResolvedValue(page([fileB]));
    await user.click(within(cardOf('b.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem).toEqual(fileA);
  });

  it('keeps the drawer open when deleting a folder fails', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeletePrefix).mockResolvedValue({ result: false, body: { deleted: 0, failed: 1 } } as never);
    const { user } = renderList();
    await screen.findByText('dir');
    useTabListStore.getState().openDetail(TAB_ID, new ObjectItem({ key: 'dir/x.txt', name: 'x.txt' }));

    await user.click(within(cardOf('dir')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(tab().detailItem?.key).toBe('dir/x.txt');
  });

  it('closes the drawer when a folder containing its object is deleted', async () => {
    confirmMock.mockResolvedValue(true as never);
    vi.mocked(DeletePrefix).mockResolvedValue({ result: true, body: { deleted: 1, failed: 0 } } as never);
    const { user } = renderList();
    await screen.findByText('dir');
    useTabListStore.getState().openDetail(TAB_ID, new ObjectItem({ key: 'dir/x.txt', name: 'x.txt' }));

    await user.click(within(cardOf('dir')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    await waitFor(() => expect(tab().detailItem).toBeUndefined());
  });

  it('deletes an object after confirmation, then refreshes', async () => {
    confirmMock.mockResolvedValue(true as never);
    const { user } = renderList();
    await screen.findByText('a.txt');
    await user.click(within(cardOf('a.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ confirmCode: 'C000004' }));
    expect(DeleteObject).toHaveBeenCalledExactlyOnceWith({
      connectionId: 'conn',
      profileName: 'my-profile',
      bucket: 'bkt',
      objects: ['a.txt'],
    });
  });

  it('ignores a delete click on a folder that is already being deleted', async () => {
    const { user } = renderList();
    await screen.findByText('dir');
    await user.click(within(cardOf('dir')).getByRole('button'));
    const deleteItem = await screen.findByText('Delete');

    act(() => useTabListStore.getState().setDeleting(TAB_ID, ['dir/'], true));
    await user.click(deleteItem);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(DeletePrefix).not.toHaveBeenCalled();
  });

  it('does not delete when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false as never);
    const { user } = renderList();
    await screen.findByText('a.txt');
    await user.click(within(cardOf('a.txt')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(DeleteObject).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('deletes a folder with DeletePrefix', async () => {
    confirmMock.mockResolvedValue(true as never);
    const { user } = renderList();
    await screen.findByText('dir');
    await user.click(within(cardOf('dir')).getByRole('button'));
    await user.click(await screen.findByText('Delete'));

    await waitFor(() => expect(DeletePrefix).toHaveBeenCalled());
    expect(DeletePrefix).toHaveBeenCalledExactlyOnceWith({
      connectionId: 'conn',
      profileName: 'my-profile',
      bucket: 'bkt',
      prefix: 'dir/',
    });
    expect(DeleteObject).not.toHaveBeenCalled();
  });

  describe('file drop event', () => {
    const getHandler = () => vi.mocked(Events.On).mock.calls.at(-1)![1] as unknown as (e: { data: unknown }) => void;
    const dropped = (tabId: string) => ({
      data: {
        tabId,
        groups: [{ files: [{ path: 'C:/x.txt', relKey: 'x.txt' }] }],
        skipped: 0,
        overMaxTotal: false,
        capped: false,
      },
    });

    it('ignores a drop that belongs to another tab', async () => {
      renderList();
      await screen.findByText('a.txt');
      act(() => getHandler()(dropped('other-tab')));
      expect(UploadObject).not.toHaveBeenCalled();
    });

    it('uploads the files dropped on this tab, then refreshes', async () => {
      renderList();
      await screen.findByText('a.txt');
      act(() => getHandler()(dropped(TAB_ID)));
      await waitFor(() => expect(UploadObject).toHaveBeenCalledTimes(1));
      expect(UploadObject).toHaveBeenCalledWith({
        connectionId: 'conn',
        profileName: 'my-profile',
        bucket: 'bkt',
        prefix: 'dir/',
        objList: [{ path: 'C:/x.txt', relKey: 'x.txt' }],
      });
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    });
  });

  it('cancels the running list request when unmounted', async () => {
    let signal: AbortSignal | undefined;
    callIPCMock.mockImplementation(((_b: unknown, _a: unknown, options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {});
    }) as unknown as typeof callIPC);
    const { unmount } = renderList();
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  describe('without a connection', () => {
    it('requests nothing without a profile', () => {
      renderList({ withProfile: false });
      expect(listMock).not.toHaveBeenCalled();
    });

    it('requests nothing without a bucket', () => {
      renderList({ bucket: null });
      expect(listMock).not.toHaveBeenCalled();
    });

    it('ignores menu actions', async () => {
      const { ref } = renderList({ withProfile: false });
      await act(async () => ref.current?.onClickMenuButton?.(['a.txt'], 'download'));
      expect(DownloadObject).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it('treats a tab missing from the store as the bucket root', async () => {
      useTabListStore.setState({ tabList: {} });
      renderList();
      expect(await screen.findByText('a.txt')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: '' }));
    });
  });

  describe('list requests', () => {
    it('keeps the list empty when the first page fails', async () => {
      listMock.mockRejectedValue(new Error('boom'));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalled());
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('accepts a page without a cursor', async () => {
      listMock.mockResolvedValue({ objectList: [fileA] } as never);
      renderList();
      expect(await screen.findByText('a.txt')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry in a loop after the next page fails', async () => {
      listMock.mockResolvedValueOnce(page([fileA], 'c1')).mockRejectedValueOnce(new Error('boom'));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(listMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('a.txt')).toBeInTheDocument();
    });

    it('ignores a next page cancelled by a refresh', async () => {
      const pending: ((v: unknown) => void)[] = [];
      listMock
        .mockResolvedValueOnce(page([fileA], 'c1'))
        .mockImplementationOnce(() => new Promise(r => pending.push(r)) as never);
      const { ref } = renderList();
      await waitFor(() => expect(pending).toHaveLength(1));
      listMock.mockResolvedValue(page([fileB]));
      await act(async () => ref.current?.onRefresh?.());
      await act(async () => pending[0](page([folder])));
      expect(screen.getByText('b.txt')).toBeInTheDocument();
      expect(screen.queryByText('dir')).not.toBeInTheDocument();
    });

    it('shows an empty list for a folder without objects', async () => {
      listMock.mockResolvedValue(page([]));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('accepts a next page without a cursor and stops paging', async () => {
      listMock.mockResolvedValueOnce(page([fileA], 'c1')).mockResolvedValueOnce({ objectList: [fileB] } as never);
      renderList();
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      await act(async () => {});
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    it('refresh without a profile requests nothing', async () => {
      const { ref } = renderList({ withProfile: false });
      await act(async () => ref.current?.onRefresh?.());
      expect(listMock).not.toHaveBeenCalled();
    });

    it('refreshes even without a scroll element', async () => {
      const { ref, scrollRef } = renderList();
      await screen.findByText('a.txt');
      scrollRef.current = null;
      await act(async () => ref.current?.onRefresh?.());
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('selection and navigation', () => {
    it('unselects an object when its checkbox is unchecked', async () => {
      const { user } = renderList();
      await screen.findByText('a.txt');
      const box = within(cardOf('a.txt')).getByRole('checkbox');
      await user.click(box);
      await user.click(box);
      expect(tab().selectionItem).toEqual({});
    });

    it('opens a folder as the new prefix', async () => {
      const { user } = renderList();
      await user.click(await screen.findByText('dir'));
      expect(tab().prefix).toBe('dir/');
    });
  });

  describe('menu actions through the ref', () => {
    it('downloads the given objects', async () => {
      const { ref } = renderList();
      await screen.findByText('a.txt');
      await act(async () => ref.current?.onClickMenuButton?.(['a.txt', 'b.txt'], 'download'));
      expect(DownloadObject).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'conn',
        profileName: 'my-profile',
        bucket: 'bkt',
        objects: ['a.txt', 'b.txt'],
      });
    });

    it('never sends folder keys and does nothing when only folders are given', async () => {
      const { ref } = renderList();
      await screen.findByText('a.txt');
      await act(async () => ref.current?.onClickMenuButton?.(['dir/'], 'download'));
      expect(DownloadObject).not.toHaveBeenCalled();
      await act(async () => ref.current?.onClickMenuButton?.(['dir/', 'a.txt'], 'download'));
      expect(DownloadObject).toHaveBeenCalledWith(expect.objectContaining({ objects: ['a.txt'] }));
    });

    it('warns instead of acting on more than 5 objects', async () => {
      const { ref } = renderList();
      await screen.findByText('a.txt');
      await act(async () => ref.current?.onClickMenuButton?.(['1', '2', '3', '4', '5', '6'], 'delete'));
      expect(confirmMock).toHaveBeenCalledExactlyOnceWith({ type: 'warning', confirmCode: 'C000005' });
      expect(DeleteObject).not.toHaveBeenCalled();
      expect(DownloadObject).not.toHaveBeenCalled();
    });
  });

  describe('folder delete', () => {
    it('does nothing when the confirmation is declined', async () => {
      confirmMock.mockResolvedValue(false as never);
      const { user } = renderList();
      await screen.findByText('dir');
      await user.click(within(cardOf('dir')).getByRole('button'));
      await user.click(await screen.findByText('Delete'));
      await waitFor(() => expect(confirmMock).toHaveBeenCalled());
      expect(DeletePrefix).not.toHaveBeenCalled();
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    it('is not blocked by an inherited property name used as the folder key', async () => {
      confirmMock.mockResolvedValue(false as never);
      listMock.mockResolvedValue(page([new ObjectItem({ key: 'constructor', name: 'constructor', isFolder: true })]));
      const { user } = renderList();
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByText('Delete'));
      await waitFor(() =>
        expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ params: { object: 'constructor' } }))
      );
    });

    it('confirms with the folder key when the folder has no name', async () => {
      confirmMock.mockResolvedValue(false as never);
      listMock.mockResolvedValue(page([new ObjectItem({ key: 'x//', name: '', isFolder: true })]));
      const { user } = renderList();
      await user.click(await screen.findByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByText('Delete'));
      await waitFor(() =>
        expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ params: { object: 'x//' } }))
      );
    });
  });

  describe('search', () => {
    const searchMock = vi.mocked(SearchObject);
    const searchArgs = (patch: Record<string, unknown> = {}) => ({
      connectionId: 'conn',
      profileName: 'my-profile',
      bucket: 'bkt',
      prefix: 'dir/',
      keyword: 'kw',
      nextCursor: '',
      ...patch,
    });

    beforeEach(() => {
      searchMock.mockResolvedValue(page([fileA]));
    });

    it('searches with the keyword instead of listing', async () => {
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('a.txt')).toBeInTheDocument();
      expect(searchMock).toHaveBeenCalledExactlyOnceWith(searchArgs());
      expect(listMock).not.toHaveBeenCalled();
    });

    it('reloads the first page when the keyword is applied and when it is cleared', async () => {
      const { setKeyword } = renderList();
      await screen.findByText('a.txt');
      searchMock.mockResolvedValue(page([fileB]));
      setKeyword('kw');
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
      setKeyword(undefined);
      expect(await screen.findByText('a.txt')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    it('follows nextCursor and drops keys that overlap the previous page', async () => {
      searchMock.mockResolvedValueOnce(page([fileA], 'c1')).mockResolvedValueOnce(page([fileA, fileB]));
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      expect(screen.getAllByText('a.txt')).toHaveLength(1);
      expect(searchMock).toHaveBeenLastCalledWith(searchArgs({ nextCursor: 'c1' }));
      expect(searchMock).toHaveBeenCalledTimes(2);
    });

    it('shows the empty message when nothing matches and no cursor is left', async () => {
      searchMock.mockResolvedValue(page([]));
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('No matching objects')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    });

    it('does not show the empty message for a normal empty folder', async () => {
      listMock.mockResolvedValue(page([]));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByText('No matching objects')).not.toBeInTheDocument();
    });

    it('does not show the empty message while the first search page is loading', async () => {
      searchMock.mockImplementation(() => new Promise(() => {}) as never);
      renderList({ keyword: 'kw' });
      await waitFor(() => expect(searchMock).toHaveBeenCalled());
      expect(screen.queryByText('No matching objects')).not.toBeInTheDocument();
      expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    });

    it('treats a next cursor equal to the one just sent as the end', async () => {
      searchMock.mockResolvedValueOnce(page([fileA], 'c1')).mockResolvedValueOnce(page([fileB], 'c1'));
      renderList({ keyword: 'kw' });
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      await act(async () => {});
      expect(searchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    });

    it('treats an empty search page with the same cursor as the end', async () => {
      searchMock.mockResolvedValueOnce(page([fileA], 'c1')).mockResolvedValueOnce(page([], 'c1'));
      renderList({ keyword: 'kw' });
      await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(searchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('a.txt')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    });

    it('hides the first-page loader when the connection is lost', async () => {
      searchMock.mockImplementation(() => new Promise(() => {}) as never);
      const { disconnect } = renderList({ keyword: 'kw' });
      await waitFor(() => expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument());
      disconnect('kw');
      expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    // The old cursor still sits in state for one render after the source changes, with the list near its end.
    const many = Array.from({ length: 6 }, (_, i) => new ObjectItem({ key: `f${i}`, name: `f${i}` }));
    const searchCursors = () => searchMock.mock.calls.map(c => (c[0] as { nextCursor: string }).nextCursor);
    const listCursors = () => listMock.mock.calls.map(c => (c[0] as { nextCursor: string }).nextCursor);

    it('never sends the list cursor to the search when the keyword is applied', async () => {
      virtual.endIndex = 0;
      listMock.mockResolvedValue(page(many, 'list-cursor'));
      searchMock.mockResolvedValue(page([fileB]));
      const { setKeyword } = renderList();
      await screen.findByText('f5');
      virtual.endIndex = null;
      setKeyword('kw');
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      await act(async () => {});
      expect(searchCursors()).toEqual(['']);
      expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    it('never sends the search cursor to the list when the keyword is cleared', async () => {
      virtual.endIndex = 0;
      searchMock.mockResolvedValue(page(many, 'search-cursor'));
      listMock.mockResolvedValue(page([fileB]));
      const { setKeyword } = renderList({ keyword: 'kw' });
      await screen.findByText('f5');
      virtual.endIndex = null;
      setKeyword(undefined);
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      await act(async () => {});
      expect(listCursors()).toEqual(['']);
    });

    it.each([['prefix', () => useTabListStore.getState().changePrefix(TAB_ID, 'other/')]])(
      'never sends the old cursor to the new %s',
      async (_name, change) => {
        virtual.endIndex = 0;
        listMock.mockResolvedValueOnce(page(many, 'old-cursor')).mockResolvedValue(page([fileB]));
        renderList();
        await screen.findByText('f5');
        virtual.endIndex = null;
        act(() => change());
        expect(await screen.findByText('b.txt')).toBeInTheDocument();
        await act(async () => {});
        expect(listCursors()).toEqual(['', '']);
        expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: 'other/' }));
      }
    );

    it('never sends the old cursor to the new bucket', async () => {
      virtual.endIndex = 0;
      listMock.mockResolvedValueOnce(page(many, 'old-cursor')).mockResolvedValue(page([fileB]));
      const { setBucket } = renderList();
      await screen.findByText('f5');
      virtual.endIndex = null;
      setBucket('bkt2');
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      await act(async () => {});
      expect(listCursors()).toEqual(['', '']);
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'bkt2' }));
    });

    it('does not auto-load an empty search page with a cursor; the button continues it', async () => {
      searchMock.mockResolvedValueOnce(page([], 'c1')).mockResolvedValueOnce(page([fileB]));
      const { user } = renderList({ keyword: 'kw' });
      const more = await screen.findByRole('button', { name: 'Search more' });
      await act(async () => {});
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('No matching objects')).not.toBeInTheDocument();

      await user.click(more);
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      expect(searchMock).toHaveBeenLastCalledWith(searchArgs({ nextCursor: 'c1' }));
      expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    });

    it('offers the button after the next page failed and retries with it', async () => {
      searchMock.mockResolvedValueOnce(page([fileA], 'c1')).mockRejectedValueOnce(new Error('boom'));
      const { user } = renderList({ keyword: 'kw' });
      const more = await screen.findByRole('button', { name: 'Search more' });
      expect(searchMock).toHaveBeenCalledTimes(2);

      searchMock.mockResolvedValueOnce(page([fileB]));
      await user.click(more);
      expect(await screen.findByText('b.txt')).toBeInTheDocument();
      expect(searchMock).toHaveBeenCalledTimes(3);
      expect(searchMock).toHaveBeenLastCalledWith(searchArgs({ nextCursor: 'c1' }));
    });

    it('has no search button when not searching, even after a failed page', async () => {
      listMock.mockResolvedValueOnce(page([fileA], 'c1')).mockRejectedValueOnce(new Error('boom'));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(screen.queryByRole('button', { name: 'Search more' })).not.toBeInTheDocument();
    });

    it('refresh searches again from the first page', async () => {
      const { ref } = renderList({ keyword: 'kw' });
      await screen.findByText('a.txt');
      await act(async () => ref.current?.onRefresh?.());
      expect(searchMock).toHaveBeenCalledTimes(2);
      expect(searchMock).toHaveBeenLastCalledWith(searchArgs());
      expect(listMock).not.toHaveBeenCalled();
    });

    it('searches nothing without a connection', () => {
      renderList({ keyword: 'kw', withProfile: false });
      expect(searchMock).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    const searchMock = vi.mocked(SearchObject);
    const EMPTY_FOLDER = 'This folder is empty';
    const NO_MATCH = 'No matching objects';
    const pending = () => new Promise(() => {}) as never;

    it('shows the empty folder message once an empty folder has loaded without a cursor', async () => {
      listMock.mockResolvedValue(page([]));
      renderList();
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
    });

    it('shows the search message instead when a keyword is applied', async () => {
      searchMock.mockResolvedValue(page([]));
      renderList({ keyword: 'kw' });
      expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it while loading', async () => {
      listMock.mockImplementation(pending);
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalled());
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it when the first page failed', async () => {
      listMock.mockRejectedValue(new Error('boom'));
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it while a cursor is left', async () => {
      listMock.mockResolvedValueOnce(page([], 'c1')).mockImplementation(pending);
      renderList();
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it for the previous list right after the prefix changes', async () => {
      listMock.mockResolvedValueOnce(page([])).mockImplementation(pending);
      renderList();
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
      act(() => useTabListStore.getState().changePrefix(TAB_ID, 'other/'));
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it for the previous list right after the keyword changes', async () => {
      listMock.mockResolvedValue(page([]));
      searchMock.mockImplementation(pending);
      const { setKeyword } = renderList();
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
      setKeyword('kw');
      await waitFor(() => expect(searchMock).toHaveBeenCalled());
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
    });

    it('does not show it without a profile', () => {
      renderList({ withProfile: false });
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('does not show it without a bucket', () => {
      renderList({ bucket: null });
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });

    it('shows it after a refresh finds the folder empty, but not while the refresh is pending', async () => {
      let finish: (v: unknown) => void = () => {};
      listMock.mockResolvedValueOnce(page([fileA]));
      const { ref } = renderList();
      await screen.findByText('a.txt');
      listMock.mockImplementationOnce(() => new Promise(r => (finish = r)) as never);
      act(() => {
        ref.current?.onRefresh?.();
      });
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
      await act(async () => finish(page([])));
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('shows it after the last object is deleted', async () => {
      confirmMock.mockResolvedValue(true as never);
      listMock.mockResolvedValueOnce(page([fileA])).mockResolvedValue(page([]));
      const { user } = renderList();
      await screen.findByText('a.txt');
      await user.click(within(cardOf('a.txt')).getByRole('button'));
      await user.click(await screen.findByText('Delete'));
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
    });

    it('hides it when the connection is lost', async () => {
      listMock.mockResolvedValue(page([]));
      const { disconnect } = renderList();
      expect(await screen.findByText(EMPTY_FOLDER)).toBeInTheDocument();
      disconnect();
      expect(screen.queryByText(EMPTY_FOLDER)).not.toBeInTheDocument();
    });
  });

  describe('file drop limits', () => {
    const getHandler = () => vi.mocked(Events.On).mock.calls.at(-1)![1] as unknown as (e: { data: unknown }) => void;
    const file = { path: 'C:/x.txt', relKey: 'x.txt' };
    const drop = (patch: Record<string, unknown> = {}) => ({
      data: { tabId: TAB_ID, groups: [{ files: [file] }], skipped: 0, overMaxTotal: false, capped: false, ...patch },
    });
    const send = async (patch?: Record<string, unknown>) => {
      await screen.findByText('a.txt');
      await act(async () => getHandler()(drop(patch)));
    };
    const uploadMock = vi.mocked(UploadObject);
    const modalMock = vi.mocked(UploadLimitModal.show);

    beforeEach(() => {
      useTabListStore.setState({ uploadingTabId: null });
    });

    it('ignores an event without data', async () => {
      renderList();
      await screen.findByText('a.txt');
      act(() => getHandler()({ data: undefined }));
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('ignores a drop when there is no connection', async () => {
      renderList({ bucket: null });
      await act(async () => getHandler()(drop()));
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('warns about skipped items and uploads the rest', async () => {
      renderList();
      await send({ skipped: 2 });
      expect(toast.warning).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    });

    it('warns when over the total max and uploads nothing if no file is left', async () => {
      renderList();
      await send({ overMaxTotal: true, maxTotalFiles: 100, groups: [{ files: [] }] });
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('warns and skips when another upload is running', async () => {
      useTabListStore.setState({ uploadingTabId: 'other' });
      renderList();
      await send();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('warns about capped files and still uploads', async () => {
      renderList();
      await send({ capped: true });
      expect(toast.warning).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    });

    it.each([
      ['cancelled', undefined],
      ['empty', []],
    ])('uploads nothing when the limit dialog is %s', async (_name, chosen) => {
      modalMock.mockResolvedValue(chosen as never);
      renderList();
      await send({ groups: [{ files: [file], overMaxFiles: true }] });
      expect(modalMock).toHaveBeenCalledTimes(1);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('uploads the files chosen in the limit dialog', async () => {
      const chosen = [{ path: 'C:/y.txt', relKey: 'y.txt' }];
      modalMock.mockResolvedValue(chosen as never);
      renderList();
      await send({ groups: [{ files: [file], overLargeCount: true }] });
      await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ objList: chosen }));
    });

    it('warns when another upload started while the limit dialog was open', async () => {
      modalMock.mockImplementation((async () => {
        useTabListStore.setState({ uploadingTabId: 'other' });
        return [file];
      }) as never);
      renderList();
      await send({ groups: [{ files: [file], overMaxFiles: true }] });
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('does not refresh when the view was unmounted during the upload', async () => {
      let finish: (v: unknown) => void = () => {};
      uploadMock.mockImplementation(() => new Promise(r => (finish = r)) as never);
      const { unmount } = renderList();
      await send();
      await waitFor(() => expect(uploadMock).toHaveBeenCalled());
      unmount();
      await act(async () => finish({ result: true }));
      expect(listMock).toHaveBeenCalledTimes(1);
      expect(useTabListStore.getState().uploadingTabId).toBeNull();
    });
  });

  describe('when the tab is only hidden (Activity)', () => {
    const tabState = (patch: Record<string, unknown> = {}) => ({
      currentView: 'objectList' as const,
      prefix: 'dir/',
      selectionItem: {} as Record<string, true>,
      deletingItems: {} as Record<string, true>,
      ...patch,
    });
    const ui = (scrollRef: RefObject<HTMLElement | null>, mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <ObjectListView tabId={TAB_ID} bucket="bkt" profile={profile} scrollRef={scrollRef} />
      </Activity>
    );
    const setup = () => {
      const scrollRef = { current: document.createElement('div') } as RefObject<HTMLElement | null>;
      const view = renderWithProviders(ui(scrollRef, 'visible'));
      return {
        ...view,
        hide: () => {
          useTabListStore.setState({ activeTab: 'tab-2' });
          view.rerender(ui(scrollRef, 'hidden'));
        },
        show: () => {
          useTabListStore.setState({ activeTab: TAB_ID });
          view.rerender(ui(scrollRef, 'visible'));
        },
      };
    };
    // Captures the signal of the first request and never answers it.
    const hangAndCapture = () => {
      const captured: { signal?: AbortSignal } = {};
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, options: { signal?: AbortSignal }) => {
        captured.signal = options.signal;
        return new Promise(() => {});
      }) as unknown as typeof callIPC);
      return captured;
    };

    beforeEach(() => {
      useTabListStore.setState({
        activeTab: TAB_ID,
        tabList: { [TAB_ID]: tabState({ selectionItem: { 'a.txt': true as const } }), 'tab-2': tabState() },
      });
    });

    it('keeps the selection and the loaded rows, and does not load the first page again when shown', async () => {
      const { hide, show } = setup();
      await screen.findByText('a.txt');

      hide();
      expect(tab().selectionItem).toEqual({ 'a.txt': true });
      show();

      expect(tab().selectionItem).toEqual({ 'a.txt': true });
      expect(screen.getByText('b.txt')).toBeInTheDocument();
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    it('does not cancel the running list request when hidden', async () => {
      const captured = hangAndCapture();
      const { hide } = setup();
      await waitFor(() => expect(captured.signal).toBeDefined());

      hide();

      expect(captured.signal?.aborted).toBe(false);
    });

    it('clears the selection when the view is unmounted while its tab is the active one', async () => {
      const { unmount } = setup();
      await screen.findByText('a.txt');

      unmount();

      expect(tab().selectionItem).toEqual({});
    });

    it('cancels the running list request when a hidden tab is closed', async () => {
      const captured = hangAndCapture();
      const { hide, unmount } = setup();
      await waitFor(() => expect(captured.signal).toBeDefined());

      hide();
      useTabListStore.setState({ tabList: { 'tab-2': tabState() } });
      unmount();

      expect(captured.signal?.aborted).toBe(true);
    });
  });
});
