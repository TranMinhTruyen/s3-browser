import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelUploadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploaderStore } from '@/common/stores/uploaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import UploaderItem from '@/components/layouts/uploader/UploaderItem';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ CancelUploadOne: vi.fn() }));

const setItem = (uploaded: number, total: number) =>
  useUploaderStore.setState({
    uploadItems: { u1: { uploadId: 'u1', fileName: 'a.bin', uploaded, total } as never },
  });

describe('UploaderItem', () => {
  beforeEach(() => {
    vi.mocked(callIPC).mockResolvedValue(null as never);
    useUploaderStore.setState({ uploadItems: {}, finishedIds: [] });
  });

  it('renders nothing for an unknown upload', () => {
    renderWithProviders(<UploaderItem id="nope" />);
    expect(screen.queryByText(/Object:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { hidden: true })).not.toBeInTheDocument();
  });

  it('shows the file name, the percentage and the sizes', () => {
    setItem(512, 2048);
    renderWithProviders(<UploaderItem id="u1" />);

    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('512 bytes')).toBeInTheDocument();
    expect(screen.getByText('1.50 KB')).toBeInTheDocument();
  });

  it('caps the percentage at 99 and never shows a negative remainder', () => {
    setItem(3000, 2000);
    renderWithProviders(<UploaderItem id="u1" />);

    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByText('0 bytes')).toBeInTheDocument();
  });

  it('shows 0% while the total is unknown', () => {
    setItem(0, 0);
    renderWithProviders(<UploaderItem id="u1" />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('cancels the upload through IPC after hovering the card', async () => {
    setItem(1, 10);
    renderWithProviders(<UploaderItem id="u1" />);

    await userEvent.hover(screen.getByText('Object: a.bin'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));

    expect(callIPC).toHaveBeenCalledWith(CancelUploadOne, ['u1']);
  });

  it('collapses the cancel button again when the pointer leaves', async () => {
    setItem(1, 10);
    renderWithProviders(<UploaderItem id="u1" />);

    await userEvent.hover(screen.getByText('Object: a.bin'));
    await userEvent.unhover(screen.getByText('Object: a.bin'));

    expect(screen.getByText('Object: a.bin')).toBeInTheDocument();
  });
});
