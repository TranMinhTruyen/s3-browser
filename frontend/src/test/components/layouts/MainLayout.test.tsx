import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const rt = vi.hoisted(() => ({ toggleMaximise: vi.fn() }));
const sql = vi.hoisted(() => ({ fail: false }));

vi.mock('@/pages/s3/transfer/downloader/DownloaderWindow', () => ({
  default: () => <div>downloader window</div>,
}));
vi.mock('@/pages/s3/transfer/uploader/UploaderWindow', () => ({ default: () => <div>uploader window</div> }));
vi.mock('@/pages/s3/S3Workspace', () => ({ default: () => <div>s3 workspace</div> }));
vi.mock('@/pages/sql/SqlWorkspace', () => {
  if (sql.fail) throw new Error('chunk failed');
  return { default: () => <div>sql workspace</div> };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));

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

describe('MainLayout', () => {
  beforeEach(() => {
    rt.toggleMaximise.mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('renders the S3 workspace and the transfer windows, SQL is not loaded yet', async () => {
    renderLayout();

    expect(await screen.findByText('s3 workspace')).toBeInTheDocument();
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();
    expect(screen.getByText('downloader window')).toBeInTheDocument();
    expect(screen.getByText('uploader window')).toBeInTheDocument();
  });

  it('labels the mode switch with the appMode.s3 / appMode.sql translations', () => {
    renderLayout();

    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'S3' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'SQL' })).toBeInTheDocument();
  });

  it('opens the download history modal from the header button', async () => {
    renderLayout();

    await userEvent.click(screen.getByRole('button', { name: 'Download history' }));

    expect(showHistoryModal).toHaveBeenCalledTimes(1);
  });

  it('opens the setting modal from the header button and no longer shows the language switch', async () => {
    renderLayout();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(showSettingModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('VI')).not.toBeInTheDocument();
  });

  it('places the setting button before the history button', () => {
    renderLayout();

    const buttons = screen.getAllByRole('button');
    const setting = buttons.indexOf(screen.getByRole('button', { name: 'Settings' }));
    const history = buttons.indexOf(screen.getByRole('button', { name: 'Download history' }));
    expect(setting).toBeLessThan(history);
  });

  it('has no empty group in the header', () => {
    renderLayout();

    const header = screen.getByRole('banner');
    const groups = Array.from(header.querySelectorAll('.mantine-Group-root'));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group).not.toBeEmptyDOMElement();
  });

  it('shows the app name and the window controls in the header', async () => {
    renderLayout();

    expect(screen.getByText('S3Browser')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Maximise' })).toBeInTheDocument();
  });

  it('toggles maximise when the empty header area is double-clicked', async () => {
    renderLayout();
    await screen.findByRole('button', { name: 'Maximise' });

    fireEvent.doubleClick(screen.getByText('S3Browser'));

    expect(rt.toggleMaximise).toHaveBeenCalledTimes(1);
  });

  it('does not toggle maximise when a header button is double-clicked', async () => {
    renderLayout();
    const button = await screen.findByRole('button', { name: 'Settings' });

    fireEvent.doubleClick(button);

    expect(rt.toggleMaximise).not.toHaveBeenCalled();
  });

  // lazyWorkspaces is module-level state: this test leaves SQL cached as loaded, so it must run before any other SQL test.
  it('shows a toast when the SQL chunk fails, then loads it when SQL is selected again', async () => {
    sql.fail = true;
    renderLayout();

    await userEvent.click(screen.getByRole('radio', { name: 'SQL' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not open SQL mode. Please try again.', {
        description: expect.any(String),
      })
    );
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();

    sql.fail = false;
    vi.doMock('@/pages/sql/SqlWorkspace', () => ({ default: () => <div>sql workspace</div> }));
    await userEvent.click(screen.getByRole('radio', { name: 'S3' }));
    await userEvent.click(screen.getByRole('radio', { name: 'SQL' }));

    expect(await screen.findByText('sql workspace')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('loads the SQL workspace on the first visit and keeps S3 mounted', async () => {
    renderLayout();

    await userEvent.click(screen.getByRole('radio', { name: 'SQL' }));

    expect(await screen.findByText('sql workspace')).toBeInTheDocument();
    expect(screen.getByText('s3 workspace')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
