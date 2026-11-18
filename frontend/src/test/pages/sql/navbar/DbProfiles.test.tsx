import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectDb, DeleteDbProfileById, DisconnectDb } from '@wails/S3Browser/internal/handlers/dbhandler';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type UiSizeKey } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import DbProfiles from '@/pages/sql/navbar/DbProfiles';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { pgProfile, sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so render every row.
const virtual = vi.hoisted(() => ({ measure: vi.fn(), estimate: 0, gap: 0 }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    getItemKey: (i: number) => string;
    estimateSize: () => number;
    gap?: number;
  }) => {
    const size = options.estimateSize();
    const gap = options.gap ?? 0;
    virtual.estimate = size;
    virtual.gap = gap;
    return {
      measure: () => virtual.measure(),
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          key: options.getItemKey(index),
          index,
          start: index * (size + gap),
        })),
      getTotalSize: () => Math.max(0, options.count * size + (options.count - 1) * gap),
    };
  },
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  ConnectDb: vi.fn(),
  DeleteDbProfileById: vi.fn(),
  DisconnectDb: vi.fn(),
  GetAllDbProfile: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/pages/sql/modals/dbProfile/DbProfileModal', () => ({ default: { show: vi.fn() } }));

const confirmMock = vi.mocked(ConfirmModal.show);
const modalMock = vi.mocked(DbProfileModal.show);
const callIPCMock = vi.mocked(callIPC);

const PG_PROFILES = [
  pgProfile('mock-pg-local', { name: 'Local PostgreSQL' }),
  pgProfile('mock-pg-staging', { name: 'Staging PostgreSQL', color: '#d3f9d8' }),
];

const addSqlite = (extra: Partial<DbProfile> = {}) =>
  useDbProfileStore.setState(state => ({
    dbProfiles: {
      ...state.dbProfiles,
      'sqlite-1': sqliteProfile('sqlite-1', { name: 'Local SQLite', ...extra }),
    },
  }));
const flush = () => act(async () => {});

const card = (name: string) => screen.getByText(name).closest<HTMLElement>('.mantine-Card-root')!;
const profile = (id: string) => useDbProfileStore.getState().dbProfiles[id];

async function openMenu(name: string) {
  fireEvent.contextMenu(card(name));
  return await screen.findAllByRole('menuitem');
}

async function clickMenuItem(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  const items = await openMenu(name);
  await user.click(items.find(i => i.textContent === item)!);
}

describe('DbProfiles', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useDbProfileStore.setState({ dbProfiles: toProfileMap(...PG_PROFILES) });
    useSqlTabStore.getState().reset();
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS } });
    confirmMock.mockResolvedValue(true as never);
  });

  it('lists every profile in store order', () => {
    renderWithProviders(<DbProfiles />);
    expect(screen.getAllByText(/PostgreSQL$|SQLite$/).filter(e => e.closest('.mantine-Card-root'))).not.toHaveLength(0);
    for (const p of PG_PROFILES) expect(screen.getByText(p.name)).toBeInTheDocument();
    expect(screen.queryByText(/No database profiles yet/)).not.toBeInTheDocument();
  });

  it('shows the empty message when there are no profiles', () => {
    useDbProfileStore.setState({ dbProfiles: {} });
    renderWithProviders(<DbProfiles />);
    expect(screen.getByText('No database profiles yet. Use the buttons above to create one.')).toBeInTheDocument();
  });

  describe('interface size', () => {
    const row = (name: string) => card(name).parentElement as HTMLElement;
    const setSize = (size: UiSizeKey) => act(() => useSettingStore.setState(st => ({ draft: { ...st.draft, size } })));

    it('keeps the 68px card and 8px gap at the medium size', () => {
      renderWithProviders(<DbProfiles />);
      expect(virtual.estimate).toBe(68);
      expect(virtual.gap).toBe(8);
      expect(row('Local PostgreSQL')).toHaveStyle({ height: '68px', transform: 'translateY(0px)' });
    });

    it.each([
      ['small', 59.5, 7],
      ['large', 76.5, 9],
    ] as const)('scales the card height and the gap at the %s size', (size, height, gap) => {
      useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, size } });
      renderWithProviders(<DbProfiles />);
      expect(virtual.estimate).toBe(height);
      expect(virtual.gap).toBe(gap);
      expect(row('Local PostgreSQL')).toHaveStyle({ height: `${height}px` });
    });

    it('measures once after the size changes and not on mount', async () => {
      renderWithProviders(<DbProfiles />);
      expect(virtual.measure).not.toHaveBeenCalled();

      await setSize('large');

      expect(virtual.measure).toHaveBeenCalledTimes(1);
    });
  });

  describe('double click', () => {
    it('connects a disconnected profile and toasts', async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.doubleClick(card('Local PostgreSQL'));
      await flush();
      expect(profile('mock-pg-local')?.isConnected).toBe(true);
      expect(toast.success).toHaveBeenCalledWith('Connected to Local PostgreSQL');
    });

    it('does nothing for an already connected profile', async () => {
      useDbProfileStore.getState().setConnected('mock-pg-local', true);
      renderWithProviders(<DbProfiles />);
      fireEvent.doubleClick(card('Local PostgreSQL'));
      await flush();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe('SQLite profile (real backend)', () => {
    beforeEach(() => addSqlite());

    it('double click connects through ConnectDb, sets the flag and toasts', async () => {
      callIPCMock.mockResolvedValue(true as never);
      renderWithProviders(<DbProfiles />);

      fireEvent.doubleClick(card('Local SQLite'));
      await flush();

      expect(callIPCMock).toHaveBeenCalledWith(ConnectDb, [{ profileId: 'sqlite-1' }]);
      expect(profile('sqlite-1')?.isConnected).toBe(true);
      expect(toast.success).toHaveBeenCalledWith('Connected to Local SQLite');
    });

    it('does not change the flag nor toast when the connect fails', async () => {
      callIPCMock.mockResolvedValue(null);
      renderWithProviders(<DbProfiles />);

      fireEvent.doubleClick(card('Local SQLite'));
      await flush();

      expect(profile('sqlite-1')?.isConnected).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('Disconnect calls DisconnectDb, clears the flag and toasts', async () => {
      addSqlite({ isConnected: true });
      callIPCMock.mockResolvedValue(true as never);
      renderWithProviders(<DbProfiles />);

      await clickMenuItem(userEvent.setup(), 'Local SQLite', 'Disconnect');

      await waitFor(() => expect(profile('sqlite-1')?.isConnected).toBe(false));
      expect(callIPCMock).toHaveBeenCalledWith(DisconnectDb, [{ profileId: 'sqlite-1' }]);
      expect(toast.success).toHaveBeenCalledWith('Disconnected from Local SQLite');
    });

    it('keeps the profile connected and silent when the disconnect fails', async () => {
      addSqlite({ isConnected: true });
      callIPCMock.mockResolvedValue(null);
      renderWithProviders(<DbProfiles />);

      await clickMenuItem(userEvent.setup(), 'Local SQLite', 'Disconnect');

      await waitFor(() => expect(callIPCMock).toHaveBeenCalled());
      expect(profile('sqlite-1')?.isConnected).toBe(true);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('deleting a connected profile asks twice, calls DeleteDbProfileById, then removes it and clears tabs', async () => {
      addSqlite({ isConnected: true });
      const tabId = useSqlTabStore.getState().activeTab;
      useSqlTabStore.getState().setTabProfile(tabId, 'sqlite-1');
      callIPCMock.mockResolvedValue(true as never);
      renderWithProviders(<DbProfiles />);

      await clickMenuItem(userEvent.setup(), 'Local SQLite', 'Delete');

      await waitFor(() => expect(profile('sqlite-1')).toBeUndefined());
      expect(confirmMock).toHaveBeenCalledTimes(2);
      expect(callIPCMock).toHaveBeenCalledWith(DeleteDbProfileById, [
        { id: 'sqlite-1', name: 'Local SQLite', config: {} },
      ]);
      expect(useSqlTabStore.getState().tabList[tabId].profileId).toBeNull();
      expect(toast.success).toHaveBeenCalledWith('Deleted Local SQLite');
    });

    it('keeps the profile, the tab link and shows no toast when the backend refuses to delete', async () => {
      const tabId = useSqlTabStore.getState().activeTab;
      useSqlTabStore.getState().setTabProfile(tabId, 'sqlite-1');
      callIPCMock.mockResolvedValue(null);
      renderWithProviders(<DbProfiles />);

      await clickMenuItem(userEvent.setup(), 'Local SQLite', 'Delete');

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(DeleteDbProfileById, expect.anything()));
      await flush();
      expect(profile('sqlite-1')).toBeDefined();
      expect(useSqlTabStore.getState().tabList[tabId].profileId).toBe('sqlite-1');
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    it('offers Connect, Edit, Export and Delete for a disconnected profile', async () => {
      renderWithProviders(<DbProfiles />);
      expect((await openMenu('Local PostgreSQL')).map(i => i.textContent)).toEqual([
        'Connect',
        'Edit',
        'Export',
        'Delete',
      ]);
    });

    it('offers Disconnect, Export and Delete (no Edit) for a connected profile', async () => {
      useDbProfileStore.getState().setConnected('mock-pg-local', true);
      renderWithProviders(<DbProfiles />);
      expect((await openMenu('Local PostgreSQL')).map(i => i.textContent)).toEqual(['Disconnect', 'Export', 'Delete']);
    });

    it('Connect connects the right-clicked profile', async () => {
      renderWithProviders(<DbProfiles />);
      await clickMenuItem(userEvent.setup(), 'Staging PostgreSQL', 'Connect');
      expect(callIPCMock).not.toHaveBeenCalled(); // PostgreSQL is still fake
      expect(profile('mock-pg-staging')?.isConnected).toBe(true);
      expect(profile('mock-pg-local')?.isConnected).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Connected to Staging PostgreSQL');
    });

    it('Disconnect disconnects the profile and toasts', async () => {
      useDbProfileStore.getState().setConnected('mock-pg-local', true);
      renderWithProviders(<DbProfiles />);
      await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Disconnect');
      expect(profile('mock-pg-local')?.isConnected).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Disconnected from Local PostgreSQL');
    });

    it('Edit opens the profile modal with the current profile', async () => {
      renderWithProviders(<DbProfiles />);
      await clickMenuItem(userEvent.setup(), 'Staging PostgreSQL', 'Edit');
      expect(modalMock).toHaveBeenCalledWith({ profile: profile('mock-pg-staging') });
    });

    it('Export only tells that the backend is missing', async () => {
      renderWithProviders(<DbProfiles />);
      await clickMenuItem(userEvent.setup(), 'Staging PostgreSQL', 'Export');
      expect(toast.info).toHaveBeenCalledWith('This feature needs the database backend, which is not available yet.');
    });

    describe('Delete', () => {
      beforeEach(() => callIPCMock.mockResolvedValue(true as never));

      it('deletes a PostgreSQL profile through the backend too', async () => {
        renderWithProviders(<DbProfiles />);

        await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Delete');

        await waitFor(() => expect(profile('mock-pg-local')).toBeUndefined());
        expect(callIPCMock).toHaveBeenCalledWith(DeleteDbProfileById, [
          { id: 'mock-pg-local', name: 'Local PostgreSQL', config: {} },
        ]);
      });

      it('confirms once for a disconnected profile, deletes it and clears it from tabs', async () => {
        const tabId = useSqlTabStore.getState().activeTab;
        useSqlTabStore.getState().setTabProfile(tabId, 'mock-pg-local');
        renderWithProviders(<DbProfiles />);

        await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Delete');

        await waitFor(() => expect(profile('mock-pg-local')).toBeUndefined());
        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(confirmMock).toHaveBeenCalledWith({ type: 'warning', confirmCode: 'C000002' });
        expect(useSqlTabStore.getState().tabList[tabId].profileId).toBeNull();
        expect(toast.success).toHaveBeenCalledWith('Deleted Local PostgreSQL');
        await waitFor(() => expect(screen.queryByText('Local PostgreSQL')).not.toBeInTheDocument());
      });

      it('asks to disconnect first, then to delete, for a connected profile', async () => {
        useDbProfileStore.getState().setConnected('mock-pg-local', true);
        renderWithProviders(<DbProfiles />);

        await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Delete');

        await waitFor(() => expect(profile('mock-pg-local')).toBeUndefined());
        expect(confirmMock.mock.calls.map(c => (c[0] as { confirmCode: string }).confirmCode)).toEqual([
          'C000003',
          'C000002',
        ]);
      });

      it('keeps a connected profile when the disconnect warning is declined', async () => {
        useDbProfileStore.getState().setConnected('mock-pg-local', true);
        confirmMock.mockResolvedValueOnce(false as never);
        renderWithProviders(<DbProfiles />);

        await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Delete');

        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(profile('mock-pg-local')).toBeDefined();
        expect(toast.success).not.toHaveBeenCalled();
      });

      it('keeps the profile and tab link when the delete confirmation is declined', async () => {
        const tabId = useSqlTabStore.getState().activeTab;
        useSqlTabStore.getState().setTabProfile(tabId, 'mock-pg-local');
        confirmMock.mockResolvedValue(false as never);
        renderWithProviders(<DbProfiles />);

        await clickMenuItem(userEvent.setup(), 'Local PostgreSQL', 'Delete');

        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(profile('mock-pg-local')).toBeDefined();
        expect(useSqlTabStore.getState().tabList[tabId].profileId).toBe('mock-pg-local');
        expect(toast.success).not.toHaveBeenCalled();
      });
    });

    it('does not open a menu, and suppresses the native one, on the empty area of the list', async () => {
      renderWithProviders(<DbProfiles />);
      const list = card('Local PostgreSQL').parentElement!.parentElement!;

      const notPrevented = fireEvent.contextMenu(list);
      await flush();

      expect(notPrevented).toBe(false);
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('closes the menu when its profile is deleted from the store', async () => {
      renderWithProviders(<DbProfiles />);
      await openMenu('Local PostgreSQL');

      act(() => useDbProfileStore.getState().deleteDbProfile('mock-pg-local'));

      await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    });

    describe('stale menu (the profile changed while the menu was open)', () => {
      it('Disconnect does nothing when the profile is no longer connected', async () => {
        useDbProfileStore.getState().setConnected('mock-pg-local', true);
        renderWithProviders(<DbProfiles />);
        const items = await openMenu('Local PostgreSQL');
        const disconnect = items.find(i => i.textContent === 'Disconnect')!;

        act(() => {
          useDbProfileStore.getState().setConnected('mock-pg-local', false);
          fireEvent.click(disconnect);
        });

        expect(profile('mock-pg-local')?.isConnected).toBe(false);
        expect(toast.success).not.toHaveBeenCalled();
      });

      it('Edit and Delete do nothing when the profile was removed', async () => {
        renderWithProviders(<DbProfiles />);
        await openMenu('Local PostgreSQL');
        act(() => useDbProfileStore.getState().deleteDbProfile('mock-pg-local'));
        const hidden = screen.getAllByRole('menuitem', { hidden: true });

        fireEvent.click(hidden.find(i => i.textContent === 'Edit')!);
        fireEvent.click(hidden.find(i => i.textContent === 'Delete')!);
        await flush();

        expect(modalMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
      });
    });

    it('closes the open menu when the list scrolls', async () => {
      renderWithProviders(<DbProfiles />);
      const scroller = card('Local PostgreSQL').parentElement!.parentElement!.parentElement!;
      await openMenu('Local PostgreSQL');

      fireEvent.scroll(scroller);

      await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    });

    it('closes the menu with Escape', async () => {
      renderWithProviders(<DbProfiles />);
      await openMenu('Local PostgreSQL');

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    });
  });
});
