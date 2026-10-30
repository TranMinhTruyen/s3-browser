import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectDetailOutput, ObjectItem } from '@wails/S3Browser/models/bucket';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ObjectDetailDrawer from '@/components/layouts/tab/components/ObjectDetailDrawer';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ GetObjectDetail: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/ipcUtils')>()),
  callIPC: vi.fn(),
}));

const TAB_ID = 'tab-1';
const callIPCMock = vi.mocked(callIPC);

const itemA = new ObjectItem({
  key: 'a.txt',
  name: 'a.txt',
  size: 2048,
  lastModified: '2026-01-02T03:04:05Z',
  etag: 'etag-a',
});
const itemB = new ObjectItem({ key: 'b.txt', name: 'b.txt', size: 1, etag: '' });

const detail = new ObjectDetailOutput({
  key: 'a.txt',
  contentType: 'text/plain',
  storageClass: 'GLACIER',
  metadata: { zeta: 'last', alpha: 'first' },
});

function renderDrawer() {
  return renderWithProviders(<ObjectDetailDrawer tabId={TAB_ID} connectionId="conn" profileName="p" bucket="bkt" />);
}

// [key, value] pairs of the nested metadata DataList, in rendered order.
function metadataEntries() {
  const metadataTerm = screen.getByText('Metadata');
  const nested = metadataTerm.nextElementSibling!.querySelector('dl')!;
  return Array.from(nested.querySelectorAll(':scope > div')).map(item => [
    item.querySelector('dt')!.textContent,
    item.querySelector('dd')!.textContent,
  ]);
}

function openItem(item: ObjectItem) {
  act(() => useTabListStore.getState().openDetail(TAB_ID, item));
}

describe('ObjectDetailDrawer', () => {
  beforeEach(() => {
    callIPCMock.mockReset();
    useTabListStore.setState({
      tabList: { [TAB_ID]: { currentView: 'objectList', prefix: '', selectionItem: [], deletingItems: [] } },
    });
  });

  it('renders nothing when no item is open', () => {
    renderDrawer();
    expect(screen.queryByText('Object details')).not.toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('shows list fields immediately, then content type and sorted metadata', async () => {
    callIPCMock.mockResolvedValue(detail);
    openItem(itemA);
    renderDrawer();

    expect(screen.getByText('etag-a')).toBeInTheDocument();
    expect(screen.getByText('2.00 KB (2048 bytes)')).toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledWith(
      expect.anything(),
      [{ connectionId: 'conn', profileName: 'p', bucket: 'bkt', key: 'a.txt' }],
      { signal: expect.any(AbortSignal) }
    );

    expect(await screen.findByText('text/plain')).toBeInTheDocument();
    expect(screen.getByText('GLACIER')).toBeInTheDocument();
    expect(metadataEntries()).toEqual([
      ['alpha', 'first'],
      ['zeta', 'last'],
    ]);
  });

  it('shows "-" for empty values and empty metadata, and hides empty storage class', async () => {
    callIPCMock.mockResolvedValue(new ObjectDetailOutput({ key: 'b.txt', contentType: 'x/y' }));
    openItem(itemB);
    renderDrawer();

    expect(await screen.findByText('x/y')).toBeInTheDocument();
    expect(screen.queryByText('Storage class')).not.toBeInTheDocument();
    // etag, lastModified and metadata are all empty.
    expect(screen.getAllByText('-')).toHaveLength(3);
  });

  it('aborts the previous request when the item changes and ignores its late result', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((v: ObjectDetailOutput) => void)[] = [];
    callIPCMock.mockImplementation((_b, _a, options) => {
      signals.push(options!.signal!);
      return new Promise(resolve => resolvers.push(resolve as (v: ObjectDetailOutput) => void));
    });
    openItem(itemA);
    renderDrawer();
    openItem(itemB);

    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    await act(async () => {
      resolvers[0](new ObjectDetailOutput({ contentType: 'old/type' }));
      resolvers[1](new ObjectDetailOutput({ contentType: 'new/type' }));
    });
    expect(screen.getByText('new/type')).toBeInTheDocument();
    expect(screen.queryByText('old/type')).not.toBeInTheDocument();
  });

  it('does not show the previous item detail while the next item loads', async () => {
    callIPCMock.mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise(() => {}));
    openItem(itemA);
    renderDrawer();
    expect(await screen.findByText('text/plain')).toBeInTheDocument();

    openItem(itemB);
    expect(screen.queryByText('text/plain')).not.toBeInTheDocument();
    expect(screen.queryByText('GLACIER')).not.toBeInTheDocument();
  });

  it('aborts the request and hides the drawer when closed', async () => {
    let signal: AbortSignal | undefined;
    callIPCMock.mockImplementation((_b, _a, options) => {
      signal = options!.signal;
      return new Promise(() => {});
    });
    openItem(itemA);
    renderDrawer();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    expect(signal?.aborted).toBe(true);
    expect(useTabListStore.getState().tabList[TAB_ID].detailItem).toBeUndefined();
    expect(screen.queryByText('Object details')).not.toBeInTheDocument();
  });

  it('does not show the old detail when the same item is reopened after closing', async () => {
    callIPCMock.mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise(() => {}));
    openItem(itemA);
    renderDrawer();
    expect(await screen.findByText('text/plain')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    openItem(itemA);
    expect(screen.queryByText('text/plain')).not.toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledTimes(2);
  });

  it('shows an error and retries', async () => {
    callIPCMock.mockResolvedValueOnce(null).mockResolvedValueOnce(detail);
    openItem(itemA);
    renderDrawer();

    expect(await screen.findByText('Could not load details')).toBeInTheDocument();
    expect(screen.getAllByText('a.txt')).toHaveLength(2);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('text/plain')).toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledTimes(2);
  });

  it('copies a value to the clipboard and shows it was copied', async () => {
    callIPCMock.mockResolvedValue(detail);
    openItem(itemA);
    renderDrawer();
    const user = userEvent.setup();

    const copyButton = screen.getAllByRole('button', { name: 'Copy' })[0];
    // The button sits next to the text holding the value.
    const value = copyButton.parentElement!.textContent;
    await user.click(copyButton);

    expect(value).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(value);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows "-" for a metadata entry with an empty value', async () => {
    callIPCMock.mockResolvedValue(new ObjectDetailOutput({ contentType: 'x/y', metadata: { empty: '' } }));
    openItem(itemA);
    renderDrawer();

    expect(await screen.findByText('empty')).toBeInTheDocument();
    expect(metadataEntries()).toEqual([['empty', '-']]);
  });
});
