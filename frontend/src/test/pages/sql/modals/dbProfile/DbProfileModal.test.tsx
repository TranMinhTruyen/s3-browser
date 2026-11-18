import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseDbFile, CreateDbProfile, UpdateDbProfileById } from '@wails/S3Browser/internal/handlers/dbhandler';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { pgProfile, sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  ChooseDbFile: vi.fn(),
  ConnectDb: vi.fn(),
  CreateDbProfile: vi.fn(),
  DeleteDbProfileById: vi.fn(),
  DisconnectDb: vi.fn(),
  GetAllDbProfile: vi.fn(),
  UpdateDbProfileById: vi.fn(),
}));

const confirmShowMock = vi.mocked(ConfirmModal.show);
const callIPCMock = vi.mocked(callIPC);

const sqliteOutput = (extra: Record<string, unknown> = {}) => ({
  id: 'sqlite-1',
  name: 'Sample',
  color: '#fff',
  provider: 'sqlite',
  config: { filePath: 'C:/data/sample.db', readOnly: false },
  hasSecret: false,
  ...extra,
});

const pgOutput = (extra: Record<string, unknown> = {}) => ({
  id: 'pg-new',
  name: 'Prod DB',
  color: '#fff',
  provider: 'postgres',
  config: { host: 'db.local', port: 5432, database: 'app', username: 'me', sslMode: 'prefer' },
  hasSecret: true,
  ...extra,
});

const localPg = pgProfile('mock-pg-local', { name: 'Local PostgreSQL' });
const stagingPg = pgProfile('mock-pg-staging', {
  name: 'Staging PostgreSQL',
  config: { host: 'staging.db.example.com', port: 5432, database: 'app', username: 'app_user', sslMode: 'require' },
  hasSecret: true,
  isConnected: true,
});
const sampleSqlite = (extra: Partial<DbProfile> = {}) =>
  sqliteProfile('sqlite-1', { name: 'Sample', config: { filePath: 'C:/data/sample.db', readOnly: false }, ...extra });
const SEEDED = 2;

/** Puts the profiles in the store, like the backend load does. */
const seed = (...profiles: DbProfile[]) => useDbProfileStore.setState({ dbProfiles: toProfileMap(...profiles) });

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
  // Paste instead of per-key typing: keeps the case well under the 5s timeout when coverage slows the run.
  for (const [label, value] of [
    [/^Host/, 'db.local'],
    [/^Database/, 'app'],
    [/^Username/, 'me'],
  ] as const) {
    await user.click(field(label));
    await user.paste(value);
  }
}

describe('DbProfileModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useDbProfileStore.getState().reset();
    seed(localPg, stagingPg);
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

    it('saves a PostgreSQL profile through CreateDbProfile (password as secret), toasts, stores it and closes', async () => {
      callIPCMock.mockResolvedValue(pgOutput() as never);
      const { user } = await open();
      await user.clear(nameInput());
      await user.type(nameInput(), '  Prod DB ');
      await fillPostgres(user);
      await user.type(field(/^Password/), 'pw');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(title('Create database profile')).not.toBeInTheDocument());
      expect(callIPCMock).toHaveBeenCalledWith(CreateDbProfile, [
        {
          id: undefined,
          name: 'Prod DB',
          color: expect.any(String),
          provider: 'postgres',
          config: { host: 'db.local', port: 5432, database: 'app', username: 'me', sslMode: 'prefer' },
          secret: 'pw',
        },
      ]);
      expect(useDbProfileStore.getState().dbProfiles['pg-new']).toEqual({
        id: 'pg-new',
        name: 'Prod DB',
        color: '#fff',
        provider: 'postgres',
        config: pgOutput().config,
        hasSecret: true,
        isConnected: false,
      });
      expect(toast.success).toHaveBeenCalledWith('Created profile Prod DB');
      expect(confirmShowMock).not.toHaveBeenCalled();
    });

    it('shows required errors and does not save when the form is empty', async () => {
      const { user } = await open();
      await user.clear(nameInput());

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findAllByText(/is required/)).toHaveLength(4);
      expect(saved()).toHaveLength(SEEDED);
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
      expect(saved()).toHaveLength(SEEDED);
    });

    it('lets the user pick an SSL mode', async () => {
      callIPCMock.mockResolvedValue(pgOutput() as never);
      const { user } = await open();
      await fillPostgres(user);
      await user.click(field(/^SSL mode/));
      await user.click(await screen.findByRole('option', { name: 'Require', hidden: true }));

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(callIPCMock.mock.calls[0][1]).toEqual([
        expect.objectContaining({ config: expect.objectContaining({ host: 'db.local', sslMode: 'require' }) }),
      ]);
    });

    it('labels the DB type control and its options from the translations', async () => {
      await open();

      expect(screen.getByRole('radiogroup', { name: 'Database type' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'PostgreSQL' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'SQLite' })).not.toBeChecked();
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

    it('saves a SQLite profile through CreateDbProfile with only the file path, then closes', async () => {
      callIPCMock.mockResolvedValue(
        sqliteOutput({ id: 'new-id', name: 'My file', config: { filePath: 'C:/data/x.db', readOnly: false } }) as never
      );
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await user.clear(nameInput());
      await user.type(nameInput(), 'My file');
      await user.type(await screen.findByLabelText(/^Database file path/), ' C:/data/x.db ');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Created profile My file'));
      expect(callIPCMock).toHaveBeenCalledWith(CreateDbProfile, [
        {
          id: undefined,
          name: 'My file',
          color: expect.any(String),
          provider: 'sqlite',
          config: { filePath: 'C:/data/x.db', readOnly: false },
        },
      ]);
      expect(useDbProfileStore.getState().dbProfiles['new-id']).toMatchObject({ provider: 'sqlite' });
      await waitFor(() => expect(title('Create database profile')).not.toBeInTheDocument());
    });

    it('keeps the modal open and stores nothing when the backend refuses the SQLite profile', async () => {
      callIPCMock.mockResolvedValue(null);
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await user.type(await screen.findByLabelText(/^Database file path/), 'C:/data/x.db');

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Create database profile')).toBeInTheDocument();
      expect(saved()).toHaveLength(SEEDED);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create profile' })).toBeEnabled());
    });

    it('sends readOnly when the switch is turned on', async () => {
      callIPCMock.mockResolvedValue(sqliteOutput({ config: { filePath: 'C:/data/x.db', readOnly: true } }) as never);
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await user.type(await screen.findByLabelText(/^Database file path/), 'C:/data/x.db');
      await user.click(screen.getByRole('switch', { name: /Open read-only/ }));

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(callIPCMock.mock.calls[0][1]).toEqual([
        expect.objectContaining({ config: { filePath: 'C:/data/x.db', readOnly: true } }),
      ]);
    });

    it('shows the read-only switch (off by default) only for SQLite', async () => {
      const { user } = await open();
      expect(screen.queryByRole('switch', { name: /Open read-only/ })).not.toBeInTheDocument();

      await user.click(screen.getByText('SQLite'));

      const readOnly = await screen.findByRole('switch', { name: /Open read-only/ });
      expect(readOnly).not.toBeChecked();
      expect(screen.getByText('Changes are rejected, so the file stays untouched.')).toBeInTheDocument();

      await user.click(screen.getByText('PostgreSQL'));

      await waitFor(() => expect(screen.queryByRole('switch', { name: /Open read-only/ })).not.toBeInTheDocument());
    });

    it('keeps the modal open and stores nothing when the backend refuses the PostgreSQL profile', async () => {
      callIPCMock.mockResolvedValue(null);
      const { user } = await open();
      await fillPostgres(user);

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(CreateDbProfile, expect.anything()));
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Create database profile')).toBeInTheDocument();
      expect(saved()).toHaveLength(SEEDED);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create profile' })).toBeEnabled());
    });

    it('requires the file path for SQLite', async () => {
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await screen.findByLabelText(/^Database file path/);

      await user.click(screen.getByRole('button', { name: 'Create profile' }));

      expect(await screen.findByText(/is required/)).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it.each([
      ['a path', 'C:/picked.db', 'C:/picked.db'],
      ['an empty path (dialog canceled)', '', 'C:/old.db'],
      ['null (the call failed)', null, 'C:/old.db'],
    ])('the choose-file button asks the backend; %s', async (_n, picked, expected) => {
      callIPCMock.mockResolvedValue(picked as never);
      const { user } = await open();
      await user.click(screen.getByText('SQLite'));
      await user.type(await screen.findByLabelText(/^Database file path/), 'C:/old.db');

      await user.click(screen.getByRole('button', { name: 'Choose file' }));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ChooseDbFile, []));
      await waitFor(() => expect(screen.getByLabelText(/^Database file path/)).toHaveValue(expected));
    });
  });

  describe('edit', () => {
    const profile = stagingPg;

    it('shows the edit title, prefilled values and the Update button', async () => {
      await open({ profile });

      expect(title('Edit database profile')).toBeInTheDocument();
      expect(nameInput()).toHaveValue('Staging PostgreSQL');
      expect(field(/^Host/)).toHaveValue('staging.db.example.com');
      expect(field(/^Username/)).toHaveValue('app_user');
      expect(screen.getByRole('button', { name: 'Update profile' })).toBeInTheDocument();
    });

    it('prefills the SQLite file path and the read-only switch for a SQLite profile', async () => {
      const readOnlyProfile = sampleSqlite({ config: { filePath: 'C:/data/sample.db', readOnly: true } });
      seed(readOnlyProfile);
      await open({ profile: readOnlyProfile });

      expect(await screen.findByLabelText(/^Database file path/)).toHaveValue('C:/data/sample.db');
      expect(screen.getByRole('switch', { name: /Open read-only/ })).toBeChecked();
    });

    it('updates a SQLite profile through UpdateDbProfileById with its id, keeping the connected flag', async () => {
      seed(localPg, stagingPg, sampleSqlite({ isConnected: true }));
      callIPCMock.mockResolvedValue(sqliteOutput() as never);
      const { user } = await open({ profile: sampleSqlite({ isConnected: true }) });

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated profile Sample'));
      expect(confirmShowMock).toHaveBeenCalledWith({ type: 'info', confirmCode: 'C000001' });
      expect(callIPCMock).toHaveBeenCalledWith(UpdateDbProfileById, [
        expect.objectContaining({
          id: 'sqlite-1',
          provider: 'sqlite',
          config: { filePath: 'C:/data/sample.db', readOnly: false },
        }),
      ]);
      expect(useDbProfileStore.getState().dbProfiles['sqlite-1']?.isConnected).toBe(true);
    });

    it('keeps the modal open when the backend refuses the SQLite update', async () => {
      callIPCMock.mockResolvedValue(null);
      const { user } = await open({ profile: sampleSqlite() });

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Edit database profile')).toBeInTheDocument();
    });

    it('asks for confirmation, then updates the same profile through UpdateDbProfileById and keeps its connected flag', async () => {
      callIPCMock.mockResolvedValue(
        pgOutput({
          id: 'mock-pg-staging',
          name: 'Staging PostgreSQL',
          config: { ...profile.config, host: 'new.host' },
        }) as never
      );
      const { user } = await open({ profile });
      await user.clear(field(/^Host/));
      await user.type(field(/^Host/), 'new.host');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated profile Staging PostgreSQL'));
      expect(confirmShowMock).toHaveBeenCalledWith({ type: 'info', confirmCode: 'C000001' });
      expect(callIPCMock).toHaveBeenCalledWith(UpdateDbProfileById, [
        expect.objectContaining({ id: 'mock-pg-staging', provider: 'postgres', secret: '' }),
      ]);
      const updated = useDbProfileStore.getState().dbProfiles['mock-pg-staging'];
      expect(updated?.config.host).toBe('new.host');
      expect(updated).toMatchObject({ isConnected: true, id: 'mock-pg-staging' });
      expect(saved()).toHaveLength(SEEDED);
      await waitFor(() => expect(title('Edit database profile')).not.toBeInTheDocument());
    });

    it('does not save and stays open when the confirmation is declined', async () => {
      confirmShowMock.mockResolvedValue(false as never);
      const { user } = await open({ profile });
      await user.clear(field(/^Host/));
      await user.type(field(/^Host/), 'new.host');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(confirmShowMock).toHaveBeenCalled());
      expect(callIPCMock).not.toHaveBeenCalled();
      expect(useDbProfileStore.getState().dbProfiles['mock-pg-staging']?.config.host).toBe('staging.db.example.com');
      expect(toast.success).not.toHaveBeenCalled();
      expect(title('Edit database profile')).toBeInTheDocument();
    });

    it('allows keeping its own name', async () => {
      callIPCMock.mockResolvedValue(pgOutput({ id: 'mock-pg-staging', name: 'Staging PostgreSQL' }) as never);
      const { user } = await open({ profile });
      await user.click(screen.getByRole('button', { name: 'Update profile' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    });

    it('rejects the name of another profile', async () => {
      const { user } = await open({ profile });
      await user.clear(nameInput());
      await user.type(nameInput(), 'Local PostgreSQL');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      expect(await screen.findByText(/already exists/)).toBeInTheDocument();
      expect(confirmShowMock).not.toHaveBeenCalled();
    });
  });

  describe('edit: provider change, password hint and lock', () => {
    const radio = (name: string) => screen.getByRole('radio', { name });
    const hint = 'Disconnect to edit the file path, read-only mode and database type.';

    it('shows the keep-password hint when the profile has a saved password and the provider is unchanged', async () => {
      const pgSaved = { ...stagingPg, isConnected: false };
      seed(localPg, pgSaved);
      await open({ profile: pgSaved });
      expect(screen.getByText('Leave empty to keep the saved password.')).toBeInTheDocument();
    });

    it('hides the keep-password hint when the profile has no saved password', async () => {
      seed(localPg, stagingPg);
      await open({ profile: localPg });
      expect(field(/^Password/)).toBeInTheDocument();
      expect(screen.queryByText('Leave empty to keep the saved password.')).not.toBeInTheDocument();
    });

    it('lets a disconnected profile change provider; the hint disappears and the input has the new config only', async () => {
      const pgSaved = { ...stagingPg, isConnected: false };
      seed(localPg, pgSaved);
      callIPCMock.mockResolvedValue(sqliteOutput({ id: 'mock-pg-staging', name: 'Staging PostgreSQL' }) as never);
      const { user } = await open({ profile: pgSaved });
      expect(radio('PostgreSQL')).toBeEnabled();

      await user.click(screen.getByText('SQLite'));
      await user.type(await screen.findByLabelText(/^Database file path/), 'C:/new.db');
      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated profile Staging PostgreSQL'));
      expect(callIPCMock).toHaveBeenCalledWith(UpdateDbProfileById, [
        {
          id: 'mock-pg-staging',
          name: 'Staging PostgreSQL',
          color: expect.any(String),
          provider: 'sqlite',
          config: { filePath: 'C:/new.db', readOnly: false },
        },
      ]);
      expect(useDbProfileStore.getState().dbProfiles['mock-pg-staging']?.provider).toBe('sqlite');
    });

    it('does not show the keep-password hint once the provider differs from the saved one', async () => {
      const saved = sampleSqlite({ hasSecret: true });
      seed(localPg, saved);
      const { user } = await open({ profile: saved });

      await user.click(screen.getByText('PostgreSQL'));

      expect(await screen.findByLabelText(/^Host/)).toBeInTheDocument();
      expect(screen.queryByText('Leave empty to keep the saved password.')).not.toBeInTheDocument();
    });

    it('locks the DB type, file path, choose-file button and read-only switch while connected, but not name and color', async () => {
      const connected = sampleSqlite({ isConnected: true });
      seed(localPg, connected);
      const { user } = await open({ profile: connected });

      expect(screen.getByText(hint)).toBeInTheDocument();
      expect(radio('PostgreSQL')).toBeDisabled();
      expect(radio('SQLite')).toBeDisabled();
      expect(screen.getByLabelText(/^Database file path/)).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled();
      expect(screen.getByRole('switch', { name: /Open read-only/ })).toBeDisabled();
      expect(nameInput()).toBeEnabled();
      expect(field(/^Profile color/)).toBeEnabled();

      await user.clear(nameInput());
      await user.type(nameInput(), 'Renamed');
      expect(nameInput()).toHaveValue('Renamed');
    });

    it('locks the DB type of a connected PostgreSQL profile but shows no disconnect hint', async () => {
      const connected = pgProfile('mock-pg-staging', { name: 'Staging PostgreSQL', isConnected: true });
      seed(localPg, connected);
      await open({ profile: connected });

      expect(radio('PostgreSQL')).toBeDisabled();
      expect(radio('SQLite')).toBeDisabled();
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    });

    it('saves a new name of a connected profile with the same config', async () => {
      const connected = sampleSqlite({ isConnected: true });
      seed(localPg, connected);
      callIPCMock.mockResolvedValue(sqliteOutput({ name: 'Renamed' }) as never);
      const { user } = await open({ profile: connected });
      await user.clear(nameInput());
      await user.type(nameInput(), 'Renamed');

      await user.click(screen.getByRole('button', { name: 'Update profile' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Updated profile Renamed'));
      expect(callIPCMock).toHaveBeenCalledWith(UpdateDbProfileById, [
        expect.objectContaining({
          id: 'sqlite-1',
          name: 'Renamed',
          config: { filePath: 'C:/data/sample.db', readOnly: false },
        }),
      ]);
    });

    it('does not lock a disconnected profile and shows no hint', async () => {
      const idle = sampleSqlite();
      seed(localPg, idle);
      await open({ profile: idle });

      expect(screen.queryByText(hint)).not.toBeInTheDocument();
      expect(radio('SQLite')).toBeEnabled();
      expect(screen.getByLabelText(/^Database file path/)).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled();
      expect(screen.getByRole('switch', { name: /Open read-only/ })).toBeEnabled();
    });

    it('follows the live connected flag: the lock appears when the profile connects while the modal is open', async () => {
      const idle = sampleSqlite();
      seed(localPg, idle);
      await open({ profile: idle });
      expect(screen.getByLabelText(/^Database file path/)).toBeEnabled();

      act(() => useDbProfileStore.getState().setConnected('sqlite-1', true));

      expect(await screen.findByText(hint)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Database file path/)).toBeDisabled();
    });

    it('is not locked in create mode', async () => {
      await open();
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
      expect(radio('PostgreSQL')).toBeEnabled();
    });
  });

  describe('dismiss', () => {
    it('Cancel closes without saving and resolves false', async () => {
      const { user, result } = await open();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await expect(result).resolves.toBe(false);
      expect(saved()).toHaveLength(SEEDED);
      await waitFor(() => expect(title('Create database profile')).not.toBeInTheDocument());
    });

    it('the close button closes the modal and resolves false', async () => {
      const { user, result } = await open();

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await expect(result).resolves.toBe(false);
    });
  });
});
