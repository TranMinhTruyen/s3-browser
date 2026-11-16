import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/transfer/downloader/DownloaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/transfer/uploader/UploaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/S3Workspace', () => ({ default: () => <div>s3 workspace</div> }));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const rt = vi.hoisted(() => ({ toggleMaximise: vi.fn() }));

vi.mock('@wailsio/runtime', () => ({
  Window: {
    IsMaximised: () => Promise.resolve(false),
    Minimise: vi.fn(),
    ToggleMaximise: rt.toggleMaximise,
    Close: vi.fn(),
  },
  Events: {
    On: () => () => {},
    Types: { Common: { WindowMaximise: 'max', WindowUnMaximise: 'unmax', WindowRestore: 'restore' } },
  },
}));

const renderLayout = () => renderWithProviders(<MainLayout />);

const mode = (name: string) => screen.getByRole('radio', { name });

const chunk = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/pages/sql/SqlWorkspace', () => {
  chunk.calls += 1;
  if (chunk.calls === 1) throw new Error('chunk failed');
  return { default: () => <div>sql workspace</div> };
});

describe('MainLayout SQL mode load failure', () => {
  it('toasts the error, renders nothing for SQL, S3 keeps working, and a later SQL selection retries', async () => {
    renderLayout();
    await userEvent.click(mode('SQL'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not open SQL mode. Please try again.', {
        description: expect.stringContaining('error when mocking a module'),
      })
    );
    await userEvent.click(mode('S3'));
    expect(screen.getByText('s3 workspace')).toBeVisible();
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();

    // The failed mode is un-visited and its cache dropped, so selecting it again loads the chunk again.
    await userEvent.click(mode('SQL'));
    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
