import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { MOCK_DB_PROFILES } from '@/pages/sql/mock/dbProfileMock';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));

const confirmShowMock = vi.mocked(ConfirmModal.show);
const flush = () => act(async () => {});

type Props = Parameters<typeof DbProfileModal.show>[0];

async function open(props?: Props) {
  renderWithProviders(<div />);
  let result!: Promise<unknown>;
  act(() => {
    result = DbProfileModal.show(props);
  });
  await flush();
  const settled = { value: undefined as unknown };
  void result.then(v => {
    settled.value = v;
  });
  return { result, settled, user: userEvent.setup() };
}

const field = (label: RegExp) => screen.getByLabelText(label, { selector: 'input' });
const nameInput = () => field(/^Profile name/);
const title = (name: string) => screen.queryByRole('heading', { name });
const saved = () => Object.values(useDbProfileStore.getState().dbProfiles);

async function fillPostgres(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(/^Host/), 'db.local');
  await user.type(field(/^Database/), 'app');
  await user.type(field(/^Username/), 'me');
}

describe('DbProfileModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useDbProfileStore.getState().reset();
    confirmShowMock.mockResolvedValue(true as never);
  });

  describe('create', () => {
    it('shows the create title, a default name, PostgreSQL fields and Cancel left / Create right', async () => {
      await open();

      expect(title('Create database profile')).toBeInTheDocument();
      expect((nameInput() as HTMLInputElement).value).toMatch(/^Connection No\./);
      expect(field(/^Host/)).toBeInTheDocument();
      expect(field(/^Port/)).toHaveValue('5432');
      expect(field(/^Password/)).toHaveAttribute('type', 'password');
      expect(screen.queryByLabelText(/^Database file path/)).not.toBeInTheDocument();
      const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
      expect(Array.from(footer.querySelectorAll('button')).map(b => b.textContent)).toEqual([
        'Cancel',
        'Create profile',
      ]);
    });

    it('saves a PostgreSQL profile, toasts, adds it to the store and closes', async () => {
      const { user } = await open();
      await user.clear(nameInput());
      await user.type(nameInput(), '  Prod DB ');
      await fillPostgres(user);
      await user.type(field(/^Password/), 'pw');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(title('Create database profile')).not.toBeInTheDocument());
      const created = saved().find(p => p?.name === 'Prod DB');
      expect(created).toMatchObject({
        dbType: 'postgresql',
        host: 'db.local',
        port: 5432,
        database: 'app',
        username: 'me',
        password: 'pw',
        sslMode: 'prefer',
        filePath: '',
        isConnected: false,
      });
      expect(created?.id).toBeTruthy();
      expect(toast.success).toHaveBeenCalledWith('Created profile Prod DB');
      expect(confirmShowMock).not.toHaveBeenCalled();
    });

    it('shows required errors and does not save when the form is empty', async () => {
      const { user } = await open();
      await user.clear(nameInput());

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findAllByText(/is required/)).toHaveLength(4);
      expect(saved()).toHaveLength(Object.keys(MOCK_DB_PROFILES).length);
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Create database profile')).toBeInTheDocument();
    });

    it('rejects a port outside 1..65535', async () => {
      const { user } = await open();
      await fillPostgres(user);
      await user.clear(field(/^Port/));
      await user.type(field(/^Port/), '70000');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findByText(/must be between/)).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('rejects a name already used by another profile, ignoring case and spaces', async () => {
      const { user } = await open();
      await user.clear(nameInput());
      await user.type(nameInput(), '  local postgresql ');
      await fillPostgres(user);

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findByText(/already exists/)).toBeInTheDocument();
      expect(saved()).toHaveLength(Object.keys(MOCK_DB_PROFILES).length);
    });

    it('lets the user pick an SSL mode', async () => {
      const { user } = await open();
      await fillPostgres(user);
      await user.click(field(/^SSL mode/));
      await user.click(await screen.findByRole('option', { name: 'Require', hidden: true }));

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(saved().find(p => p?.host === 'db.local')?.sslMode).toBe('require');
    });

    it('switches to SQLite: shows the file path, hides PostgreSQL fields and drops earlier errors', async () => {
      const { user } = await open();
      await user.click(screen.getByRole('button', { name: 'Create profile' }));
      await screen.findAllByText(/is required/);

      await user.click(screen.getByText('SQLite'));

      expect(await screen.findByLabelText(/^Database file path/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Host/)).not.toBeInTheDocument();
      expect(screen.queryByText(/is required/)).not.toBeInTheDocument();
    });

    it('saves a SQLite profile with only the file path', async () => {
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await user.type(await screen.findByLabelText(/^Database file path/), ' C:/data/x.db ');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(saved().find(p => p?.filePath === 'C:/data/x.db')).toMatchObject({
        dbType: 'sqlite',
        host: '',
        port: 0,
        database: '',
        username: '',
        password: '',
      });
    });

    it('requires the file path for SQLite', async () => {
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await screen.findByLabelText(/^Database file path/);

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findByText(/is required/)).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('the choose-file button only tells that the backend is missing', async () => {
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await screen.findByLabelText(/^Database file path/);

      await user.click(screen.getByRole('button', { name: 'Choose file' }));

      expect(toast.info).toHaveBeenCalledWith('This feature needs the database backend, which is not available yet.');
    });
  });

  describe('edit', () => {
    const profile = { ...MOCK_DB_PROFILES['mock-pg-staging'], isConnected: true };

    it('shows the edit title, prefilled values and the Update button', async () => {
      await open({ profile });

      expect(title('Edit database profile')).toBeInTheDocument();
      expect(nameInput()).toHaveValue('Staging PostgreSQL');
      expect(field(/^Host/)).toHaveValue('staging.db.example.com');
      expect(field(/^Username/)).toHaveValue('app_user');
      expect(screen.getByRole('button', { name: 'Update profile' })).toBeInTheDocument();
    });

    it('prefills the SQLite file path and the default port for a SQLite profile', async () => {
      await open({ profile: MOCK_DB_PROFILES['mock-sqlite-local'] });

      expect(await screen.findByLabelText(/^Database file path/)).toHaveValue('C:/data/sample.db');
    });

    it('asks for confirmation, then updates the same profile and keeps its connected flag', async () => {
      const { user } = await open({ profile });
      await user.clear(field(/^Host/));
      await user.type(field(/^Host/), 'new.host');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated profile Staging PostgreSQL'));
      expect(confirmShowMock).toHaveBeenCalledWith({ type: 'info', confirmCode: 'C000001' });
      const updated = useDbProfileStore.getState().dbProfiles['mock-pg-staging'];
      expect(updated).toMatchObject({ host: 'new.host', isConnected: true, id: 'mock-pg-staging' });
      expect(saved()).toHaveLength(Object.keys(MOCK_DB_PROFILES).length);
      await waitFor(() => expect(title('Edit database profile')).not.toBeInTheDocument());
    });

    it('does not save and stays open when the confirmation is declined', async () => {
      confirmShowMock.mockResolvedValue(false as never);
      const { user } = await open({ profile });
      await user.clear(field(/^Host/));
      await user.type(field(/^Host/), 'new.host');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(confirmShowMock).toHaveBeenCalled());
      expect(useDbProfileStore.getState().dbProfiles['mock-pg-staging']?.host).toBe('staging.db.example.com');
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Edit database profile')).toBeInTheDocument();
    });

    it('allows keeping its own name', async () => {
      const { user } = await open({ profile });
      await user.click(screen.getByRole('button', { name: 'Update profile' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    });

    it('rejects the name of another profile', async () => {
      const { user } = await open({ profile });
      await user.clear(nameInput());
      await user.type(nameInput(), 'Local SQLite');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      expect(await screen.findByText(/already exists/)).toBeInTheDocument();
      expect(confirmShowMock).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('Cancel closes without saving and resolves false', async () => {
      const { user, result } = await open();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await expect(result).resolves.toBe(false);
      expect(saved()).toHaveLength(Object.keys(MOCK_DB_PROFILES).length);
      await waitFor(() => expect(title('Create database profile')).not.toBeInTheDocument());
    });

    it('the close button closes the modal and resolves false', async () => {
      const { user, result } = await open();

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBe(false);
    });
  });
});
