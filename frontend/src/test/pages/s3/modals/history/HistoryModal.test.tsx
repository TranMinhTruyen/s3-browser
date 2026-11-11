import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetDownloadHistory, OpenDownloadDest } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DownloadHistoryItem, DownloadHistoryOutput } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import HistoryModal from '@/pages/s3/modals/history/HistoryModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
// `endIndex` is the last row the user "sees"; null means the end of the list.
const virtual = vi.hoisted(() => ({
  endIndex: null as number | null,
  estimates: [] as number[],
  scrollEls: [] as unknown[],
}));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
    estimateSize,
    getScrollElement,
  }: {
    count: number;
    getItemKey: (i: number) => string;
    estimateSize: () => number;
    getScrollElement: () => unknown;
  }) => ({
    getVirtualItems: () => {
      virtual.estimates.push(estimateSize());
      virtual.scrollEls.push(getScrollElement());
      return Array.from({ length: count }, (_, index) => ({ key: getItemKey(index), index, start: 0 }));
    },
    getTotalSize: () => count * 100,
    measureElement: () => {},
    range: count === 0 ? null : { startIndex: 0, endIndex: virtual.endIndex ?? count - 1 },
  }),
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  GetDownloadHistory: vi.fn(),
  OpenDownloadDest: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const flush = () => act(async () => {});

const item = (id: string, extra: Partial<DownloadHistoryItem> = {}) =>
  new DownloadHistoryItem({
    id,
    fileName: `${id}.bin`,
    destPath: `/dl/${id}.bin`,
    status: 'DONE',
    size: 2048,
    updatedAt: '2026-01-02T03:04:05.000Z',
    ...extra,
  });

const pageOf = (items: DownloadHistoryItem[], afterID = '') =>
  new DownloadHistoryOutput({ downloadHistoryList: items, afterID });

function open() {
  const view = renderWithProviders(<div />);
  act(() => {
    HistoryModal.show();
  });
  return view;
}

describe('HistoryModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    virtual.endIndex = null;
    virtual.estimates = [];
    virtual.scrollEls = [];
  });

  it('requests the first page and renders every column of the items', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a'), item('b', { destPath: '', size: undefined })]));
    open();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(callIPCMock.mock.calls[0][0]).toBe(GetDownloadHistory);
    expect(callIPCMock.mock.calls[0][1]).toEqual([{ afterID: '', pageSize: 10 }]);

    expect(screen.getByText('Download history')).toBeInTheDocument();
    expect(screen.getByText('a.bin')).toBeInTheDocument();
    expect(screen.getByText('b.bin')).toBeInTheDocument();
    expect(screen.getByText('2.00 KiB')).toBeInTheDocument();
    expect(screen.getByText('0 bytes')).toBeInTheDocument();
    expect(screen.getAllByText(dayjs('2026-01-02T03:04:05.000Z').format(FULL_DATE_TIME_FORMAT))).toHaveLength(2);
    expect(screen.getAllByText('DONE')).toHaveLength(2);
    expect(screen.getByText('/dl/a.bin')).toBeInTheDocument();
    // An item without a destination shows the placeholder instead of a link.
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('loads nothing more when the backend returns an empty afterID', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a')], ''));
    open();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('copes with a page that has neither a list nor an afterID', async () => {
    callIPCMock.mockResolvedValueOnce({} as never);
    open();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/\.bin/)).not.toBeInTheDocument();
  });

  it('keeps the list empty when the first page fails', async () => {
    callIPCMock.mockResolvedValueOnce(null);
    open();
    await flush();

    expect(screen.queryByText(/\.bin/)).not.toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('loads the next page with the cursor when the end of the list is in view and appends it', async () => {
    callIPCMock
      .mockResolvedValueOnce(pageOf([item('a'), item('b')], 'cursor-1'))
      .mockResolvedValueOnce(pageOf([item('c')], ''));
    open();
    await flush();

    await waitFor(() => expect(screen.getByText('c.bin')).toBeInTheDocument());
    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(callIPCMock.mock.calls[1][1]).toEqual([{ afterID: 'cursor-1', pageSize: 10 }]);
    expect(screen.getByText('a.bin')).toBeInTheDocument();
    expect(screen.getByText('b.bin')).toBeInTheDocument();
  });

  it('appends nothing and clears the cursor when the next page has no list and no afterID', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a')], 'cursor-1')).mockResolvedValueOnce({} as never);
    open();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/\.bin/)).toHaveLength(2); // file name + destination path of "a" only
  });

  it('does not load the next page while the end of the list is far from the viewport', async () => {
    virtual.endIndex = 0;
    const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`));
    callIPCMock.mockResolvedValueOnce(pageOf(items, 'cursor-1'));
    open();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('shows a loader while the next page loads', async () => {
    let resolveNext!: (v: DownloadHistoryOutput) => void;
    callIPCMock
      .mockResolvedValueOnce(pageOf([item('a')], 'cursor-1'))
      .mockReturnValueOnce(new Promise(resolve => (resolveNext = resolve)) as never);
    open();
    await flush();

    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();

    await act(async () => resolveNext(pageOf([item('b')])));
    expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    expect(screen.getByText('b.bin')).toBeInTheDocument();
  });

  it('stops requesting after a failed next page instead of retrying in a loop', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a')], 'cursor-1')).mockResolvedValueOnce(null);
    open();
    await flush();
    await flush();

    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    expect(screen.getByText('a.bin')).toBeInTheDocument();
  });

  it('ignores a page that arrives after the modal was unmounted', async () => {
    let resolveFirst!: (v: DownloadHistoryOutput) => void;
    callIPCMock.mockReturnValueOnce(new Promise(resolve => (resolveFirst = resolve)) as never);
    const { unmount } = open();
    await flush();
    const signal = (callIPCMock.mock.calls[0][2] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolveFirst(pageOf([item('late')], 'cursor-1')));

    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('drops a next page that was aborted while it loaded', async () => {
    let resolveNext!: (v: DownloadHistoryOutput) => void;
    callIPCMock
      .mockResolvedValueOnce(pageOf([item('a')], 'cursor-1'))
      .mockReturnValueOnce(new Promise(resolve => (resolveNext = resolve)) as never);
    const { unmount } = open();
    await flush();

    unmount();
    await act(async () => resolveNext(pageOf([item('late')])));

    expect(callIPCMock).toHaveBeenCalledTimes(2);
  });

  it('opens the destination of an item through the backend', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a')]));
    open();
    await flush();
    callIPCMock.mockResolvedValue(null);

    await userEvent.click(screen.getByText('/dl/a.bin'));

    expect(callIPCMock).toHaveBeenLastCalledWith(OpenDownloadDest, ['a.bin', '/dl/a.bin']);
  });

  it('does not open anything when the item has no file name', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a', { fileName: undefined })]));
    open();
    await flush();

    await userEvent.click(screen.getByText('/dl/a.bin'));

    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholder and opens nothing for an item without destination', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a', { destPath: '' })]));
    open();
    await flush();

    await userEvent.click(screen.getByText('EMPTY'));

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('/dl/a.bin')).not.toBeInTheDocument();
  });

  it('does not open anything when the file name is empty', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a', { fileName: '' })]));
    open();
    await flush();

    await userEvent.click(screen.getByText('/dl/a.bin'));

    expect(callIPCMock).toHaveBeenCalledTimes(1);
  });

  it('closes the modal after Cancel', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([]));
    renderWithProviders(<div />);
    act(() => {
      HistoryModal.show();
    });
    await flush();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Download history')).not.toBeInTheDocument());
  });

  it('puts the Cancel button alone on the left of a non-wrapping footer', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([]));
    open();
    await flush();

    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(footer.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    expect(footer.style.getPropertyValue('--group-justify')).toBe('space-between');
    expect(footer.querySelectorAll('button')).toHaveLength(1);
  });

  it('resolves false from the Cancel button', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([]));
    renderWithProviders(<div />);
    let result!: Promise<false | null>;
    act(() => {
      result = HistoryModal.show();
    });
    await flush();

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBe(false);
  });

  it('resolves null when closed with the X button', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([]));
    renderWithProviders(<div />);
    let result!: Promise<false | null>;
    act(() => {
      result = HistoryModal.show();
    });
    await flush();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await expect(result).resolves.toBeNull();
  });

  it('gives the virtualizer the row estimate and the modal scroll container', async () => {
    callIPCMock.mockResolvedValueOnce(pageOf([item('a')]));
    open();
    await flush();

    expect(virtual.estimates).toContain(100);
    expect(virtual.scrollEls.at(-1)).toBeInstanceOf(HTMLElement);
  });
});
