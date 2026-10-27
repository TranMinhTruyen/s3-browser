import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '@/common/stores/profileStore';
import HeaderButtonGroup from '@/components/layouts/navbar/components/HeaderButtonGroup';
import ConnectModal from '@/components/modals/ConnectModal';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/modals/ConnectModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({}));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

describe('HeaderButtonGroup', () => {
  const loadConnectionProfiles = vi.fn();

  beforeEach(() => {
    loadConnectionProfiles.mockResolvedValue(undefined);
    useProfileStore.setState({ loadConnectionProfiles });
  });

  it('opens the connect modal in connect mode', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(ConnectModal.show).toHaveBeenCalledWith({ mode: 'connect' });
  });

  it('opens the connect modal in createProfile mode', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Create connection profile' }));

    expect(ConnectModal.show).toHaveBeenCalledWith({ mode: 'createProfile' });
  });

  it('reloads the connection profiles on refresh', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh connection profile list' }));

    expect(loadConnectionProfiles).toHaveBeenCalledTimes(1);
  });
});
