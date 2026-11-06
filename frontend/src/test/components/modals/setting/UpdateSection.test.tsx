import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UpdateStateOutput } from '@wails/S3Browser/models';
import { Browser } from '@wailsio/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '@/common/stores/updateStore';
import UpdateSection from '@/components/modals/setting/UpdateSection';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wailsio/runtime', async () =>
  (await import('@/test/_helpers/wailsRuntimeMock')).wailsRuntimeMock({ Browser: { OpenURL: vi.fn() } })
);
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const set = (patch: Partial<UpdateStateOutput> = {}) =>
  useUpdateStore.setState({
    supported: true,
    state: 'idle',
    currentVersion: '1.0.0',
    version: '1.1.0',
    written: 0,
    total: 0,
    ...patch,
  } as never);

describe('UpdateSection', () => {
  const check = vi.fn();
  const download = vi.fn();
  const install = vi.fn();

  beforeEach(() => {
    useUpdateStore.getState().reset();
    vi.clearAllMocks();
    useUpdateStore.setState({ check, download, install });
  });

  it('renders nothing when updates are not supported', () => {
    useUpdateStore.setState({ supported: false });
    renderWithProviders(<UpdateSection />);

    expect(screen.queryByText('Update')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the current version and the idle status with an enabled check button', async () => {
    const user = userEvent.setup();
    set();
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Current version: 1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Updates have not been checked yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View on GitHub' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('shows up to date', () => {
    set({ state: 'upToDate' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('You are on the latest version.')).toBeInTheDocument();
  });

  it('disables the check button while checking', () => {
    set({ state: 'checking' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Checking for updates...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });

  it('offers Download for an available version', async () => {
    const user = userEvent.setup();
    set({ state: 'available' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Version 1.1.0 is available.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('shows progress and disables check while downloading', () => {
    set({ state: 'downloading', written: 1024, total: 2048 });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Downloading version 1.1.0...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });

  it('offers Update now when the download is ready', async () => {
    const user = userEvent.setup();
    set({ state: 'ready' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Version 1.1.0 is downloaded and ready to install.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('shows the backend message of the error code', () => {
    set({ state: 'error', errorCode: 'UPE002' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('GitHub is limiting requests, try again later.')).toBeInTheDocument();
  });

  it('replaces the version placeholder of the error message', () => {
    set({ state: 'error', errorCode: 'UPE006', version: '1.1.0' });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('Version 1.1.0 has no installer for this machine.')).toBeInTheDocument();
    expect(screen.queryByText(/\{version\}/)).not.toBeInTheDocument();
  });

  it('shows the general text for an error without code', () => {
    set({ state: 'error', errorCode: undefined });
    renderWithProviders(<UpdateSection />);

    expect(screen.getByText('The update failed.')).toBeInTheDocument();
  });

  it('opens the release page when the release url is known', async () => {
    const user = userEvent.setup();
    set({ state: 'available', releaseUrl: 'https://github.com/x/releases/v1.1.0' });
    renderWithProviders(<UpdateSection />);

    await user.click(screen.getByRole('button', { name: 'View on GitHub' }));

    expect(Browser.OpenURL).toHaveBeenCalledExactlyOnceWith('https://github.com/x/releases/v1.1.0');
  });
});
