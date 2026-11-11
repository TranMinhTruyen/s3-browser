import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import SqlHeaderButtonGroup from '@/pages/sql/navbar/SqlHeaderButtonGroup';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));
vi.mock('@/pages/sql/modals/dbProfile/DbProfileModal', () => ({ default: { show: vi.fn() } }));

const NO_BACKEND = 'This feature needs the database backend, which is not available yet.';

describe('SqlHeaderButtonGroup', () => {
  it('opens the create-profile modal without a profile', async () => {
    renderWithProviders(<SqlHeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Create database profile' }));

    expect(DbProfileModal.show).toHaveBeenCalledWith();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each(['Connect', 'Import database profile', 'Refresh database profile list'])(
    '%s only tells that the backend is missing',
    async name => {
      renderWithProviders(<SqlHeaderButtonGroup />);

      await userEvent.click(screen.getByRole('button', { name }));

      expect(toast.info).toHaveBeenCalledWith(NO_BACKEND);
      expect(DbProfileModal.show).not.toHaveBeenCalled();
    }
  );

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
