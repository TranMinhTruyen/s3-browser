import { screen, waitFor } from '@testing-library/react';
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

const gate = vi.hoisted(() => ({ release: () => {}, started: false }));

vi.mock('@/pages/s3/S3Workspace', async () => {
  await new Promise<void>(resolve => {
    gate.release = resolve;
    gate.started = true;
  });
  return { default: () => <div>s3 workspace</div> };
});

describe('MainLayout S3 workspace while loading', () => {
  it('shows a Loader until the S3Workspace chunk arrives', async () => {
    const { container } = renderLayout();
    expect(container.ownerDocument.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByText('s3 workspace')).not.toBeInTheDocument();

    await waitFor(() => expect(gate.started).toBe(true));
    gate.release();

    expect(await screen.findByText('s3 workspace')).toBeInTheDocument();
    await waitFor(() => expect(container.ownerDocument.querySelector('.mantine-Loader-root')).not.toBeInTheDocument());
  });
});
