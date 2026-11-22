import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetAllDbProfile } from '@wails/S3Browser/internal/handlers/dbhandler';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import SqlHeaderButtonGroup from '@/pages/sql/navbar/SqlHeaderButtonGroup';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { pgProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({ GetAllDbProfile: vi.fn() }));
vi.mock('@/pages/sql/modals/dbProfile/DbProfileModal', () => ({ default: { show: vi.fn() } }));

const NO_BACKEND = 'This feature needs the database backend, which is not available yet.';

describe('SqlHeaderButtonGroup', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useDbProfileStore.setState({
      dbProfiles: toProfileMap(
        pgProfile('mock-pg-local', { name: 'Local PostgreSQL' }),
        pgProfile('mock-pg-staging', { name: 'Staging PostgreSQL' })
      ),
    });
  });

  it('opens the create-profile modal without a profile', async () => {
    renderWithProviders(<SqlHeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Create database profile' }));

    expect(DbProfileModal.show).toHaveBeenCalledWith();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each(['Connect', 'Import database profile'])('%s only tells that the backend is missing', async name => {
    renderWithProviders(<SqlHeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name }));

    expect(toast.info).toHaveBeenCalledWith(NO_BACKEND);
    expect(DbProfileModal.show).not.toHaveBeenCalled();
    expect(callIPC).not.toHaveBeenCalled();
  });

  it('Refresh reloads the profiles from the backend without the no-backend toast', async () => {
    vi.mocked(callIPC).mockResolvedValue({
      dbProfiles: [
        {
          id: 's1',
          name: 'Disk',
          color: '#fff',
          provider: 'sqlite',
          config: { filePath: 'C:/a.db', readOnly: true },
          hasSecret: false,
        },
      ],
    } as never);
    renderWithProviders(<SqlHeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh database profile list' }));

    await waitFor(() => expect(useDbProfileStore.getState().dbProfiles.s1?.name).toBe('Disk'));
    expect(callIPC).toHaveBeenCalledWith(GetAllDbProfile, [], expect.anything());
    expect(toast.info).not.toHaveBeenCalled();
    expect(DbProfileModal.show).not.toHaveBeenCalled();
  });

  it('Refresh keeps the current profiles when the backend fails', async () => {
    vi.mocked(callIPC).mockResolvedValue(null);
    renderWithProviders(<SqlHeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh database profile list' }));

    await waitFor(() => expect(callIPC).toHaveBeenCalled());
    expect(Object.keys(useDbProfileStore.getState().dbProfiles)).toEqual(['mock-pg-local', 'mock-pg-staging']);
  });

  it('shows the four buttons with create second', () => {
    renderWithProviders(<SqlHeaderButtonGroup />);
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Connect',
      'Create database profile',
      'Import database profile',
      'Refresh database profile list',
    ]);
  });
});
