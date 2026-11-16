import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const gate = vi.hoisted(() => ({ release: () => {} }));

vi.mock('@/pages/sql/SqlWorkspace', async () => {
  await new Promise<void>(resolve => {
    gate.release = resolve;
  });
  return { default: () => <div>sql workspace</div> };
});

describe('MainLayout SQL mode while loading', () => {
  it('shows a Loader until the SQL chunk arrives', async () => {
    const { container } = renderLayout();
    await userEvent.click(mode('SQL'));

    expect(container.ownerDocument.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();

    gate.release();

    expect(await screen.findByText('sql workspace')).toBeInTheDocument();
    await waitFor(() => expect(container.ownerDocument.querySelector('.mantine-Loader-root')).not.toBeInTheDocument());
  });
});
