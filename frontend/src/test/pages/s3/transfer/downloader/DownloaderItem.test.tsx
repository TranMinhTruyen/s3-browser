import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelDownloadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import { useDownloaderStore } from '@/pages/s3/stores/downloaderStore';
import DownloaderItem from '@/pages/s3/transfer/downloader/DownloaderItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ CancelDownloadOne: vi.fn() }));

const setItem = (downloaded: number, total: number) =>
  useDownloaderStore.setState({
    downloadItems: { d1: { id: 'd1', downloadId: 'd1', fileName: 'b.bin', downloaded, total } as never },
  });

describe('DownloaderItem', () => {
  beforeEach(() => {
    vi.mocked(callIPC).mockResolvedValue(null as never);
    useDownloaderStore.setState({ downloadItems: {} });
  });

  it('shows the file name, the percentage and the sizes', () => {
    setItem(512, 2048);
    renderWithProviders(<DownloaderItem id="d1" />);

    expect(screen.getByText('Object: b.bin')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('512 bytes')).toBeInTheDocument();
    expect(screen.getByText('1.50 KiB')).toBeInTheDocument();
  });

  it('caps the percentage at 99 while the transfer is still running', () => {
    setItem(2000, 2000);
    renderWithProviders(<DownloaderItem id="d1" />);
    expect(screen.getByText('99%')).toBeInTheDocument();
  });

  it('shows 100% when the total is unknown', () => {
    setItem(0, 0);
    renderWithProviders(<DownloaderItem id="d1" />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('cancels the download through IPC after hovering the card', async () => {
    setItem(1, 10);
    renderWithProviders(<DownloaderItem id="d1" />);

    await userEvent.hover(screen.getByText('Object: b.bin'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));

    expect(callIPC).toHaveBeenCalledWith(CancelDownloadOne, ['d1']);
  });

  it('keeps the card visible when the pointer leaves', async () => {
    setItem(1, 10);
    renderWithProviders(<DownloaderItem id="d1" />);

    await userEvent.hover(screen.getByText('Object: b.bin'));
    await userEvent.unhover(screen.getByText('Object: b.bin'));

    expect(screen.getByText('Object: b.bin')).toBeInTheDocument();
  });

  it('renders nothing when the id is not in the store', () => {
    setItem(1, 10);
    renderWithProviders(<DownloaderItem id="missing" />);

    expect(screen.queryByRole('button', { name: 'Cancel', hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Object: b.bin')).not.toBeInTheDocument();
  });
});
