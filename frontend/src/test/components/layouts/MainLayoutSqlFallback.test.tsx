import { waitFor, within } from '@testing-library/react';
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

const gate = vi.hoisted(() => ({ release: () => {} }));
vi.mock('@/pages/sql/SqlWorkspace', async () => {
  await new Promise<void>(resolve => {
    gate.release = resolve;
  });
  throw new Error('chunk failed');
});

describe('MainLayout shared failed chunk', () => {
  it('renders the empty fallback in an instance that still has the mode visited', async () => {
    const a = renderWithProviders(<MainLayout />);
    const b = renderWithProviders(<MainLayout />);
    // Only the first instance's onFail is bound to the cached lazy component, so the second keeps SQL visited.
    await userEvent.click(within(a.container).getByRole('radio', { name: 'SQL' }));
    await userEvent.click(within(b.container).getByRole('radio', { name: 'SQL' }));
    await waitFor(() => expect(gate.release).not.toBe(undefined));
    gate.release();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(b.container).queryByRole('progressbar')).not.toBeInTheDocument());
  });
});
