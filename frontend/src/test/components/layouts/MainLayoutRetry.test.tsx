import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const ctl = vi.hoisted(() => ({ s3Mounts: 0 }));

vi.mock('@/pages/s3/transfer/downloader/DownloaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/transfer/uploader/UploaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/S3Workspace', () => ({
  default: function S3Workspace() {
    useEffect(() => {
      ctl.s3Mounts += 1;
    }, []);
    return <div>s3 workspace</div>;
  },
}));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@wailsio/runtime', () => ({
  Window: {
    IsMaximised: () => Promise.resolve(false),
    Minimise: vi.fn(),
    ToggleMaximise: vi.fn(),
    Close: vi.fn(),
  },
  Events: {
    On: () => () => {},
    Types: { Common: { WindowMaximise: 'max', WindowUnMaximise: 'unmax', WindowRestore: 'restore' } },
  },
}));

// The workspace cache is module-level, so every test loads a fresh MainLayout.
const renderLayout = async (failures: number) => {
  vi.resetModules();
  ctl.s3Mounts = 0;
  // Re-registered per test: the mock registry (and a cached successful factory result) survives resetModules.
  let failuresLeft = failures;
  vi.doMock('@/pages/sql/SqlWorkspace', () => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('chunk failed');
    }
    return { default: () => <div>sql workspace</div> };
  });
  ({ toast } = await import('sonner'));
  const { default: MainLayout } = await import('@/components/layouts/MainLayout');
  return renderWithProviders(<MainLayout />);
};

const mode = (name: string) => screen.getByRole('radio', { name });
const retryButton = () => screen.queryByRole('button', { name: 'Retry' });
let toast: typeof import('sonner').toast;
const toastCalls = () => vi.mocked(toast.error).mock.calls.length;

describe('MainLayout retry after a failed workspace chunk', () => {
  it('shows no retry button when nothing failed', async () => {
    await renderLayout(0);
    expect(await screen.findByText('s3 workspace')).toBeVisible();
    expect(retryButton()).not.toBeInTheDocument();
    await userEvent.click(mode('SQL'));
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(retryButton()).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts and shows Retry on failure; Retry succeeding loads the workspace and hides the button', async () => {
    await renderLayout(1);
    await userEvent.click(mode('SQL'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Could not open SQL mode. Please try again.', {
      description: expect.any(String),
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();

    await userEvent.click(retry);
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(retryButton()).not.toBeInTheDocument();
    expect(toastCalls()).toBe(1);
  });

  it('toasts again and keeps Retry when the second attempt also fails', async () => {
    await renderLayout(2);
    await userEvent.click(mode('SQL'));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(toastCalls()).toBe(2));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(retryButton()).not.toBeInTheDocument();
  });

  it('does not remount the other mode while retrying', async () => {
    await renderLayout(1);
    expect(await screen.findByText('s3 workspace')).toBeVisible();
    await userEvent.click(mode('SQL'));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(ctl.s3Mounts).toBe(1);
  });

  it('reselecting the failed mode on the SegmentedControl also loads it again', async () => {
    await renderLayout(1);
    await userEvent.click(mode('SQL'));
    await screen.findByRole('button', { name: 'Retry' });

    await userEvent.click(mode('S3'));
    expect(retryButton()).not.toBeInTheDocument();
    expect(screen.getByText('s3 workspace')).toBeVisible();

    await userEvent.click(mode('SQL'));
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(retryButton()).not.toBeInTheDocument();
    expect(toastCalls()).toBe(1);
  });
});
