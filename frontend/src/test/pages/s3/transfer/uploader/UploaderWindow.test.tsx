import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelAllUploads } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Events } from '@wailsio/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useDownloaderStore } from '@/pages/s3/stores/downloaderStore';
import { useUploaderStore } from '@/pages/s3/stores/uploaderStore';
import UploaderWindow from '@/pages/s3/transfer/uploader/UploaderWindow';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so the real virtualizer would render no row: render every row instead.
const virtual = vi.hoisted(() => ({ getScrollEl: null as null | (() => unknown), estimates: [] as number[] }));
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
      virtual.getScrollEl = getScrollElement;
      return Array.from({ length: count }, (_, index) => ({ key: getItemKey(index), index, start: 0 }));
    },
    getTotalSize: () => count * 80,
  }),
}));
vi.mock('@wailsio/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>();
  return { ...actual, Events: { ...actual.Events, On: vi.fn() } };
});
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  CancelAllUploads: vi.fn(),
  CancelUploadOne: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const started = (uploadId: string, fileName = `${uploadId}.bin`) => ({
  uploadId,
  fileName,
  key: fileName,
  bucket: 'bkt',
  total: 2048,
});

// Mantine writes the Affix position as rem values (1rem = 16px).
const affixPosition = () => {
  const affix = document.querySelector<HTMLElement>('.mantine-Affix-root')!;
  const rem = (v: string) => Number.parseFloat(/calc\(([\d.]+)rem/.exec(v)?.[1] ?? '0') * 16;
  return {
    bottom: rem(affix.style.getPropertyValue('--affix-bottom')),
    right: rem(affix.style.getPropertyValue('--affix-right')),
  };
};

describe('UploaderWindow', () => {
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
    useUploaderStore.getState().reset();
    useDownloaderStore.getState().reset();
  });

  it('renders nothing while no upload is running', () => {
    renderWithProviders(<UploaderWindow />);

    expect(document.querySelector('.mantine-Affix-root')).not.toBeInTheDocument();
  });

  it('shows a button first (not the window) when an upload is already tracked', () => {
    useUploaderStore.getState().startUpload(started('u1') as never);
    renderWithProviders(<UploaderWindow />);

    expect(screen.queryByText('Uploading')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-upload')).toBeInTheDocument();
  });

  it('opens the window and lists the item when an upload starts', () => {
    renderWithProviders(<UploaderWindow />);

    emit('uploader:upload-started', started('u1', 'a.bin'));

    expect(screen.getByText('Uploading')).toBeInTheDocument();
    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
    expect(useUploaderStore.getState().uploadItems.u1).toMatchObject({ fileName: 'a.bin', uploaded: 0 });
  });

  it('gives the virtualizer the scroll element, item keys and row size', () => {
    virtual.getScrollEl = null;
    virtual.estimates.length = 0;
    renderWithProviders(<UploaderWindow />);

    emit('uploader:upload-started', started('u1', 'a.bin'));

    expect(virtual.estimates).toContain(80);
    expect((virtual.getScrollEl as (() => unknown) | null)?.()).toBeInstanceOf(HTMLElement);
    expect(Object.keys(useUploaderStore.getState().uploadItems)).toEqual(['u1']);
  });

  it('ignores events without data', () => {
    renderWithProviders(<UploaderWindow />);

    emit('uploader:upload-started', null);
    emit('uploader:upload-progress-batch', null);
    emit('uploader:upload-finished', null);

    expect(useUploaderStore.getState().uploadItems).toEqual({});
    expect(useUploaderStore.getState().finishedIds).toEqual([]);
    expect(screen.queryByText('Uploading')).not.toBeInTheDocument();
  });

  it('shows the progress and removes the item when it finishes', () => {
    renderWithProviders(<UploaderWindow />);
    emit('uploader:upload-started', started('u1', 'a.bin'));
    emit('uploader:upload-started', started('u2', 'b.bin'));

    emit('uploader:upload-progress-batch', { items: [{ uploadId: 'u1', uploaded: 512, total: 2048 }] });
    expect(screen.getByText('25%')).toBeInTheDocument();

    emit('uploader:upload-finished', { uploadId: 'u1' });
    expect(screen.queryByText('Object: a.bin')).not.toBeInTheDocument();
    expect(screen.getByText('Object: b.bin')).toBeInTheDocument();
    expect(useUploaderStore.getState().finishedIds).toEqual(['u1']);

    emit('uploader:upload-finished', { uploadId: 'u2' });
    expect(screen.queryByText('Uploading')).not.toBeInTheDocument();
  });

  it('applies a batch to several items and shows finalizing at 100%', () => {
    renderWithProviders(<UploaderWindow />);
    emit('uploader:upload-started', started('u1', 'a.bin'));
    emit('uploader:upload-started', started('u2', 'b.bin'));

    emit('uploader:upload-progress-batch', {
      items: [
        { uploadId: 'u1', uploaded: 1024, total: 2048 },
        { uploadId: 'u2', uploaded: 2048, total: 2048 },
      ],
    });

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Finalizing…')).toBeInTheDocument();
  });

  it('collapses to a button on close and reopens the window from it', async () => {
    renderWithProviders(<UploaderWindow />);
    emit('uploader:upload-started', started('u1'));

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Uploading')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Uploading' }));
    expect(screen.getByText('Uploading')).toBeInTheDocument();
  });

  it('cancels every upload from the window', async () => {
    renderWithProviders(<UploaderWindow />);
    emit('uploader:upload-started', started('u1'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel all' }));

    expect(callIPCMock).toHaveBeenCalledWith(CancelAllUploads, []);
  });

  describe('placement next to the downloader', () => {
    it('sits in the bottom right corner when there is no downloader', () => {
      renderWithProviders(<UploaderWindow />);
      emit('uploader:upload-started', started('u1'));

      expect(affixPosition()).toEqual({ bottom: 16, right: 16 });
    });

    it('moves left of the downloader window', () => {
      useDownloaderStore.setState({ windowSize: { width: 400, height: 200 } });
      renderWithProviders(<UploaderWindow />);
      emit('uploader:upload-started', started('u1'));

      expect(affixPosition()).toEqual({ bottom: 16, right: 16 + 400 + 16 });
    });

    it('moves above the downloader button while collapsed', async () => {
      useDownloaderStore.setState({ windowSize: { width: 40, height: 40 } });
      renderWithProviders(<UploaderWindow />);
      emit('uploader:upload-started', started('u1'));
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(affixPosition()).toEqual({ bottom: 16 + 40 + 16, right: 16 });
    });

    it.each([
      { width: 400, height: 0 },
      { width: 0, height: 200 },
    ])('ignores a downloader with an empty size %j', size => {
      useDownloaderStore.setState({ windowSize: size });
      renderWithProviders(<UploaderWindow />);
      emit('uploader:upload-started', started('u1'));

      expect(affixPosition()).toEqual({ bottom: 16, right: 16 });
    });
  });

  it('unsubscribes from the events on unmount', () => {
    const { unmount } = renderWithProviders(<UploaderWindow />);

    unmount();

    expect(Object.keys(handlers)).toContain('uploader:upload-progress-batch');
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });
});
