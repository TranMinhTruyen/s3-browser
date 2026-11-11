import { screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/transfer/downloader/DownloaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/transfer/uploader/UploaderWindow', () => ({ default: () => <div /> }));

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

vi.mock('@/pages/s3/S3Workspace', () => {
  throw new Error('chunk failed');
});

describe('MainLayout S3 workspace load failure', () => {
  it('toasts the error with its message and renders nothing for the S3 workspace, the shell keeps working', async () => {
    renderLayout();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not open S3 mode. Please try again.', {
        description: expect.stringContaining('error when mocking a module'),
      })
    );
    expect(screen.getByText('S3Browser')).toBeInTheDocument();
    expect(screen.queryByText('s3 workspace')).not.toBeInTheDocument();
  });
});
