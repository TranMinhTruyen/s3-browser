import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelAllDownloads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDownloaderStore } from '@/common/stores/downloaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import DownloaderWindow from '@/components/layouts/downloader/DownloaderWindow';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@wailsio/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>();
  return { ...actual, Events: { ...actual.Events, On: vi.fn() } };
});
// jsdom has no layout: report a fixed size for the measured element.
vi.mock('@mantine/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@mantine/hooks')>()),
  useElementSize: () => ({ ref: { current: null }, width: 300, height: 120 }),
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  CancelAllDownloads: vi.fn(),
  CancelDownloadOne: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
// The REAL virtualizer is used; jsdom has no layout, so give every element a viewport.
const sizes = [
  ['offsetHeight', 260],
  ['offsetWidth', 400],
  ['clientHeight', 260],
  ['clientWidth', 400],
] as const;
const state = () => useDownloaderStore.getState();

const downloading = (id: string, fileName = `${id}.bin`) => ({ id, fileName, status: 'DOWNLOADING', version: 1 });

describe('DownloaderWindow', () => {
  const unsubscribe = vi.fn();
  let handlers: Record<string, (e: { data: unknown }) => void>;
  const emit = (name: string, data: unknown) => act(() => handlers[name]({ data }));

  beforeEach(() => {
    handlers = {};
    vi.mocked(Events.On).mockImplementation(((name: string, cb: (e: { data: unknown }) => void) => {
      handlers[name] = cb;
      return unsubscribe;
    }) as never);
    callIPCMock.mockResolvedValue(null as never);
    for (const [prop, value] of sizes) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    }
    state().reset();
  });

  afterEach(() => {
    for (const [prop] of sizes) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  });

  it('renders nothing and publishes an empty size while nothing is downloading', () => {
    useDownloaderStore.setState({ windowSize: { width: 50, height: 50 } });
    renderWithProviders(<DownloaderWindow />);

    expect(document.querySelector('.mantine-Affix-root')).not.toBeInTheDocument();
    expect(screen.queryByText('Downloading')).not.toBeInTheDocument();
    expect(state().windowSize).toEqual({ width: 0, height: 0 });
  });

  it('opens the window and lists the item when a download starts, publishing the measured size', () => {
    renderWithProviders(<DownloaderWindow />);

    emit('downloader:load-download-history', downloading('d1', 'a.bin'));

    expect(state().windowVisible).toBe(true);
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
    expect(state().windowSize).toEqual({ width: 300, height: 120 });
  });

  it('lays the items out in the virtual list with a 10px gap', async () => {
    renderWithProviders(<DownloaderWindow />);

    emit('downloader:load-download-history', downloading('d1', 'a.bin'));
    emit('downloader:load-download-history', downloading('d2', 'b.bin'));

    const wrapper = (name: string) => screen.getByText(name).closest('[style*="translateY"]') as HTMLElement;
    expect((await screen.findByText('Object: b.bin')).isConnected).toBe(true);
    expect(wrapper('Object: a.bin').style.transform).toBe('translateY(0px)');
    expect(wrapper('Object: b.bin').style.transform).toBe('translateY(90px)');
  });

  it('ignores a history event without data', () => {
    renderWithProviders(<DownloaderWindow />);

    emit('downloader:load-download-history', null);

    expect(state().windowVisible).toBe(false);
    expect(state().downloadItems).toEqual({});
  });

  it('only lists items that are downloading', () => {
    renderWithProviders(<DownloaderWindow />);

    emit('downloader:load-download-history', downloading('d1', 'a.bin'));
    emit('downloader:load-download-history', { id: 'd2', fileName: 'done.bin', status: 'DONE', version: 1 });

    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
    expect(screen.queryByText('Object: done.bin')).not.toBeInTheDocument();
  });

  it('applies progress events to the matching item and ignores an empty one', () => {
    renderWithProviders(<DownloaderWindow />);
    emit('downloader:load-download-history', downloading('d1'));

    emit('downloader:download-progress', { downloadId: 'd1', downloaded: 512, total: 2048 });
    expect(state().downloadItems.d1).toMatchObject({ downloaded: 512, total: 2048 });
    expect(screen.getByText('25%')).toBeInTheDocument();

    emit('downloader:download-progress', null);
    expect(state().downloadItems.d1).toMatchObject({ downloaded: 512, total: 2048 });
  });

  it('collapses to a button on close and reopens the window from it', async () => {
    renderWithProviders(<DownloaderWindow />);
    emit('downloader:load-download-history', downloading('d1'));

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state().windowVisible).toBe(false);
    expect(screen.queryByText('Downloading')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-download')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Downloading' }));
    expect(state().windowVisible).toBe(true);
    expect(screen.getByText('Downloading')).toBeInTheDocument();
  });

  it('cancels every download from the window', async () => {
    renderWithProviders(<DownloaderWindow />);
    emit('downloader:load-download-history', downloading('d1'));

    await userEvent.click(screen.getByTitle('Cancel all'));

    expect(callIPCMock).toHaveBeenCalledWith(CancelAllDownloads, []);
  });

  it('unsubscribes from the events on unmount', () => {
    const { unmount } = renderWithProviders(<DownloaderWindow />);

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
