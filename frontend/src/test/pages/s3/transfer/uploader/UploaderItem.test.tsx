import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelUploadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploaderStore } from '@/common/stores/uploaderStore';
import { callIPC } from '@/common/utils/ipcUtils';
import UploaderItem from '@/pages/s3/transfer/uploader/UploaderItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

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
    expect(screen.getByText('1.50 KiB')).toBeInTheDocument();
  });

  it('caps the percentage at 99 while nearly complete and not yet finalizing', () => {
    setItem(1999, 2000);
    const { container } = renderWithProviders(<UploaderItem id="u1" />);

    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('1 bytes')).toBeInTheDocument();
    expect(screen.queryByText('Finalizing…')).not.toBeInTheDocument();
    expect(container.querySelector('.mantine-Loader-root')).toBeNull();
  });

  it('shows 0% and the normal layout while the total is unknown', () => {
    setItem(0, 0);
    const { container } = renderWithProviders(<UploaderItem id="u1" />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.queryByText('Finalizing…')).not.toBeInTheDocument();
    expect(container.querySelector('.mantine-Loader-root')).toBeNull();
  });

  it.each([
    ['uploaded equals total', 2048, 2048],
    ['uploaded exceeds total', 3000, 2048],
  ])('shows the finalizing state when %s', (_name, uploaded, total) => {
    setItem(uploaded, total);
    const { container } = renderWithProviders(<UploaderItem id="u1" />);

    expect(container.querySelector('.mantine-Loader-root')).not.toBeNull();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText('Finalizing…')).toBeInTheDocument();
    expect(screen.getByText('2.00 KiB')).toBeInTheDocument();
    expect(screen.queryByText('Uploaded')).not.toBeInTheDocument();
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
  });

  it('cancels the upload through IPC while finalizing', async () => {
    setItem(2048, 2048);
    renderWithProviders(<UploaderItem id="u1" />);

    await userEvent.hover(screen.getByText('Object: a.bin'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));

    expect(callIPC).toHaveBeenCalledWith(CancelUploadOne, ['u1']);
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
