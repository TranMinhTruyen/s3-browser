import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteDbProfileById, DisconnectDb, GetSchemaTree } from '@wails/S3Browser/internal/handlers/dbhandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type UiSizeKey } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import DbProfiles from '@/pages/sql/navbar/DbProfiles';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useDbTreeStore } from '@/pages/sql/stores/dbTreeStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { pgProfile, sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom không có layout nên render mọi hàng. Kích thước lấy từ `estimateSize(index)` như virtualizer thật.
const virtual = vi.hoisted(() => ({ sizes: [] as number[] }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    getItemKey: (i: number) => string;
    estimateSize: (i: number) => number;
  }) => {
    const sizes = Array.from({ length: options.count }, (_, index) => options.estimateSize(index));
    virtual.sizes = sizes;
    return {
      measure: () => {},
      getVirtualItems: () =>
        sizes.map((size, index) => ({
          key: options.getItemKey(index),
          index,
          size,
          start: sizes.slice(0, index).reduce((sum, s) => sum + s, 0),
        })),
      getTotalSize: () => sizes.reduce((sum, s) => sum + s, 0),
    };
  },
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  ConnectDb: vi.fn(),
  DeleteDbProfileById: vi.fn(),
  DisconnectDb: vi.fn(),
  GetAllDbProfile: vi.fn(),
  GetSchemaTree: vi.fn(),
  CloseDbTab: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/pages/sql/modals/dbProfile/DbProfileModal', () => ({ default: { show: vi.fn() } }));

const callIPCMock = vi.mocked(callIPC);
const confirmMock = vi.mocked(ConfirmModal.show);

const schema = {
  name: 'main',
  tables: ['users', 'orders'],
  views: ['v_users'],
  indexes: [{ name: 'idx_users', table: 'users' }],
  triggers: [{ name: 'trg_users', table: 'users' }],
};

/** Kết quả GetSchemaTree; các binding khác đều thành công. */
const answer = { schemas: [schema] as unknown };
const schemaCalls = () => callIPCMock.mock.calls.filter(c => c[0] === GetSchemaTree);

const flush = () => act(async () => {});
const card = (name: string) => screen.getByText(name).closest<HTMLElement>('.mantine-Card-root')!;
const chevron = (name: string, label = 'Show objects') => within(card(name)).getByRole('button', { name: label });
const row = (text: string) => screen.getByText(text).closest<HTMLElement>('div')!;
const tabs = () => useSqlTabStore.getState().tabList;
const tree = () => useDbTreeStore.getState();

const setProfiles = (...profiles: ReturnType<typeof sqliteProfile>[]) =>
  useDbProfileStore.setState({ dbProfiles: toProfileMap(...profiles) });

const connectedSqlite = (id = 's1', name = 'Local SQLite') => sqliteProfile(id, { name, isConnected: true });

beforeEach(() => {
  vi.clearAllMocks();
  useDbProfileStore.getState().reset();
  useDbTreeStore.getState().reset();
  useSqlTabStore.getState().reset();
  answer.schemas = [schema];
  callIPCMock.mockImplementation((async (binding: unknown) =>
    binding === GetSchemaTree ? { schemas: answer.schemas } : true) as never);
  confirmMock.mockResolvedValue(true as never);
  setProfiles(connectedSqlite(), sqliteProfile('s2', { name: 'Off SQLite', isConnected: false }));
});

describe('DbProfiles object tree', () => {
  it('shows a chevron only on a connected profile', () => {
    renderWithProviders(<DbProfiles />);
    expect(within(card('Local SQLite')).getByRole('button', { name: 'Show objects' })).toBeInTheDocument();
    expect(within(card('Off SQLite')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens the tree under the card: loading first, then the schema expanded with its collapsed groups', async () => {
    let finish: (v: unknown) => void = () => {};
    callIPCMock.mockImplementation((() => new Promise(r => (finish = r))) as never);
    renderWithProviders(<DbProfiles />);

    fireEvent.click(chevron('Local SQLite'));
    expect(await screen.findByText('Loading objects…')).toBeInTheDocument();
    expect(chevron('Local SQLite', 'Hide objects')).toBeInTheDocument();

    await act(async () => finish({ schemas: [schema] }));

    expect(screen.queryByText('Loading objects…')).not.toBeInTheDocument();
    for (const text of ['main', 'Tables', 'Views', 'Indexes', 'Triggers'])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('users')).not.toBeInTheDocument();
    expect(schemaCalls()).toHaveLength(1);
    expect(schemaCalls()[0][1]).toEqual([{ profileId: 's1' }]);
  });

  it('lists the objects of a group when its chevron is clicked, and hides them again', async () => {
    renderWithProviders(<DbProfiles />);
    fireEvent.click(chevron('Local SQLite'));
    await screen.findByText('Tables');

    fireEvent.click(row('Tables').querySelector('svg')!);
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();

    fireEvent.click(row('Tables').querySelector('svg')!);
    expect(screen.queryByText('users')).not.toBeInTheDocument();
  });

  it('collapses the whole tree with the card chevron and does not load it again on reopen', async () => {
    renderWithProviders(<DbProfiles />);
    fireEvent.click(chevron('Local SQLite'));
    await screen.findByText('Tables');

    fireEvent.click(chevron('Local SQLite', 'Hide objects'));
    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
    fireEvent.click(chevron('Local SQLite'));

    expect(await screen.findByText('Tables')).toBeInTheDocument();
    expect(schemaCalls()).toHaveLength(1);
  });

  it('opens the trees of several profiles at once', async () => {
    setProfiles(connectedSqlite('s1', 'Local SQLite'), connectedSqlite('s3', 'Other SQLite'));
    renderWithProviders(<DbProfiles />);

    fireEvent.click(chevron('Local SQLite'));
    fireEvent.click(chevron('Other SQLite'));

    await waitFor(() => expect(screen.getAllByText('main')).toHaveLength(2));
  });

  it('shows the database, then the schemas, for a PostgreSQL profile (mock)', async () => {
    setProfiles(pgProfile('pg', { name: 'My PG', isConnected: true }));
    renderWithProviders(<DbProfiles />);

    fireEvent.click(chevron('My PG'));

    expect(await screen.findByText('postgres')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    expect(screen.getByText('sales')).toBeInTheDocument();
    expect(schemaCalls()).toHaveLength(0);
  });

  it('shows a line when the objects could not be loaded, and retries when opened again', async () => {
    answer.schemas = null;
    callIPCMock.mockImplementation((async (b: unknown) => (b === GetSchemaTree ? null : true)) as never);
    renderWithProviders(<DbProfiles />);

    fireEvent.click(chevron('Local SQLite'));
    expect(await screen.findByText('Could not load the objects')).toBeInTheDocument();

    callIPCMock.mockImplementation((async () => ({ schemas: [schema] })) as never);
    fireEvent.click(chevron('Local SQLite', 'Hide objects'));
    fireEvent.click(chevron('Local SQLite'));

    expect(await screen.findByText('Tables')).toBeInTheDocument();
  });

  it('shows a line when the database has no object', async () => {
    answer.schemas = [];
    renderWithProviders(<DbProfiles />);

    fireEvent.click(chevron('Local SQLite'));

    expect(await screen.findByText('No objects')).toBeInTheDocument();
  });

  describe('rows', () => {
    const openTables = async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');
      for (const group of ['Tables', 'Views', 'Indexes', 'Triggers']) fireEvent.click(row(group).querySelector('svg')!);
    };

    it('highlights the clicked node, one at a time', async () => {
      await openTables();

      fireEvent.click(row('users'));
      expect(row('users')).toHaveAttribute('data-selected', 'true');

      fireEvent.click(row('orders'));
      expect(row('orders')).toHaveAttribute('data-selected', 'true');
      expect(row('users')).not.toHaveAttribute('data-selected');
    });

    it('opens a table tab on double click and switches to it when it is already open', async () => {
      await openTables();
      const before = Object.keys(tabs()).length;

      fireEvent.doubleClick(row('users'));
      const tab = useSqlTabStore.getState().activeTab;
      expect(tabs()[tab]).toEqual({ profileId: 's1', table: { schema: 'main', name: 'users' } });

      fireEvent.doubleClick(row('orders'));
      fireEvent.doubleClick(row('users'));

      expect(Object.keys(tabs())).toHaveLength(before + 2);
      expect(useSqlTabStore.getState().activeTab).toBe(tab);
    });

    it('does nothing on double click of a view, index or trigger', async () => {
      await openTables();
      const before = Object.keys(tabs()).length;

      for (const name of ['v_users', 'idx_users', 'trg_users']) fireEvent.doubleClick(row(name));

      expect(Object.keys(tabs())).toHaveLength(before);
    });
  });

  describe('context menu', () => {
    const openMenu = async (name: string) => {
      fireEvent.contextMenu(card(name));
      return await screen.findAllByRole('menuitem');
    };

    it('offers Refresh only for a connected profile, and it reloads the tree', async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');

      const items = await openMenu('Local SQLite');
      expect(items.map(i => i.textContent)).toContain('Refresh');
      answer.schemas = [{ ...schema, tables: ['fresh'] }];
      await userEvent.click(items.find(i => i.textContent === 'Refresh')!);

      await waitFor(() => expect(schemaCalls()).toHaveLength(2));
      await waitFor(() => expect(tree().trees.s1?.tableNames).toEqual(['fresh', 'v_users']));
    });

    it('does not offer Refresh for a disconnected profile', async () => {
      renderWithProviders(<DbProfiles />);
      expect((await openMenu('Off SQLite')).map(i => i.textContent)).not.toContain('Refresh');
    });

    it('Disconnect closes the tree, drops it and closes the table tabs of the profile', async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');
      act(() => useSqlTabStore.getState().openTableTab('s1', 'main', 'users'));
      const tableTab = useSqlTabStore.getState().activeTab;

      const items = await openMenu('Local SQLite');
      await userEvent.click(items.find(i => i.textContent === 'Disconnect')!);

      await waitFor(() => expect(useDbProfileStore.getState().dbProfiles.s1?.isConnected).toBe(false));
      expect(callIPCMock).toHaveBeenCalledWith(DisconnectDb, [{ profileId: 's1' }]);
      expect(tree().opened).toEqual({});
      expect(tree().trees).toEqual({});
      expect(tabs()[tableTab]).toBeUndefined();
      expect(screen.queryByText('Tables')).not.toBeInTheDocument();
    });

    it('keeps the tree and the table tabs when the disconnect fails', async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');
      act(() => useSqlTabStore.getState().openTableTab('s1', 'main', 'users'));
      const tableTab = useSqlTabStore.getState().activeTab;
      callIPCMock.mockImplementation((async () => null) as never);

      const items = await openMenu('Local SQLite');
      await userEvent.click(items.find(i => i.textContent === 'Disconnect')!);
      await flush();

      expect(tree().opened.s1).toBe(true);
      expect(tabs()[tableTab]).toBeDefined();
    });

    it('Delete drops the tree and closes the table tabs; the SQL tab is unlinked', async () => {
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');
      const sqlTab = Object.keys(tabs())[0];
      useSqlTabStore.getState().setTabProfile(sqlTab, 's1');
      act(() => useSqlTabStore.getState().openTableTab('s1', 'main', 'users'));
      const tableTab = useSqlTabStore.getState().activeTab;

      const items = await openMenu('Local SQLite');
      await userEvent.click(items.find(i => i.textContent === 'Delete')!);

      await waitFor(() => expect(useDbProfileStore.getState().dbProfiles.s1).toBeUndefined());
      expect(callIPCMock).toHaveBeenCalledWith(DeleteDbProfileById, expect.anything());
      expect(tree().trees).toEqual({});
      expect(tabs()[tableTab]).toBeUndefined();
      expect(tabs()[sqlTab].profileId).toBeNull();
    });

    it('keeps the tree when the delete is declined', async () => {
      confirmMock.mockResolvedValue(false as never);
      renderWithProviders(<DbProfiles />);
      fireEvent.click(chevron('Local SQLite'));
      await screen.findByText('Tables');

      const items = await openMenu('Local SQLite');
      await userEvent.click(items.find(i => i.textContent === 'Delete')!);
      await flush();

      expect(tree().opened.s1).toBe(true);
      expect(useDbProfileStore.getState().dbProfiles.s1).toBeDefined();
    });
  });

  describe('selecting a tab', () => {
    const selectTab = (profileId: string | null) =>
      act(() => {
        const id = Object.keys(tabs())[0];
        useSqlTabStore.getState().setTabProfile(id, profileId);
      });

    it('opens the tree of the profile of the selected tab when it is connected', async () => {
      renderWithProviders(<DbProfiles />);
      expect(tree().opened).toEqual({});

      selectTab('s1');

      await screen.findByText('Tables');
      expect(tree().opened.s1).toBe(true);
    });

    it('does not open the tree for a disconnected profile or for no profile', async () => {
      renderWithProviders(<DbProfiles />);

      selectTab('s2');
      selectTab(null);
      await flush();

      expect(tree().opened).toEqual({});
      expect(schemaCalls()).toHaveLength(0);
    });

    it('opens it once the profile gets connected', async () => {
      renderWithProviders(<DbProfiles />);
      selectTab('s2');
      await flush();

      act(() => useDbProfileStore.getState().setConnected('s2', true));

      await waitFor(() => expect(tree().opened.s2).toBe(true));
    });

    it('opens the tree of the new profile without closing the other', async () => {
      setProfiles(connectedSqlite('s1', 'Local SQLite'), connectedSqlite('s3', 'Other SQLite'));
      renderWithProviders(<DbProfiles />);
      selectTab('s1');
      await waitFor(() => expect(tree().opened.s1).toBe(true));

      selectTab('s3');

      await waitFor(() => expect(tree().opened.s3).toBe(true));
      expect(tree().opened.s1).toBe(true);
    });

    it('does not reopen a tree the user closed while the same tab stays selected', async () => {
      renderWithProviders(<DbProfiles />);
      selectTab('s1');
      await screen.findByText('Tables');

      fireEvent.click(chevron('Local SQLite', 'Hide objects'));
      await flush();
      act(() => useSqlTabStore.getState().setActiveTab(Object.keys(tabs())[0]));
      await flush();

      expect(tree().opened.s1).toBeUndefined();
      expect(screen.queryByText('Tables')).not.toBeInTheDocument();
    });

    describe('another tab of the same profile', () => {
      const addSqlTab = () => {
        act(() => useSqlTabStore.getState().addTab());
        const id = useSqlTabStore.getState().activeTab;
        act(() => useSqlTabStore.getState().setTabProfile(id, 's1'));
        return id;
      };
      const addTableTab = () => {
        act(() => useSqlTabStore.getState().openTableTab('s1', 'main', 'users'));
        return useSqlTabStore.getState().activeTab;
      };
      /** Tab SQL hiển thị `s1`, đã có tab thứ hai của `s1`, tab đầu đang được chọn và cây đã đóng. */
      const closedTreeWithTwoTabs = async (second: () => string) => {
        renderWithProviders(<DbProfiles />);
        const first = Object.keys(tabs())[0];
        selectTab('s1');
        await screen.findByText('Tables');
        const other = second();
        act(() => useSqlTabStore.getState().setActiveTab(first));
        await flush();
        fireEvent.click(chevron('Local SQLite', 'Hide objects'));
        await flush();
        expect(tree().opened.s1).toBeUndefined();
        return other;
      };

      it.each([
        ['a SQL tab', addSqlTab],
        ['a table tab', addTableTab],
      ])('reopens the closed tree, without loading again, when %s of that profile is selected', async (_n, second) => {
        const other = await closedTreeWithTwoTabs(second);
        const loads = schemaCalls().length;

        act(() => useSqlTabStore.getState().setActiveTab(other));

        await screen.findByText('Tables');
        expect(tree().opened.s1).toBe(true);
        expect(chevron('Local SQLite', 'Hide objects')).toBeInTheDocument();
        expect(schemaCalls()).toHaveLength(loads);
      });

      it('does not open the tree when the other tab belongs to a profile that is not connected', async () => {
        renderWithProviders(<DbProfiles />);
        const first = Object.keys(tabs())[0];
        selectTab('s1');
        await screen.findByText('Tables');
        act(() => useSqlTabStore.getState().addTab());
        const off = useSqlTabStore.getState().activeTab;
        act(() => useSqlTabStore.getState().setTabProfile(off, 's2'));
        act(() => useSqlTabStore.getState().setActiveTab(first));
        fireEvent.click(chevron('Local SQLite', 'Hide objects'));
        await flush();

        act(() => useSqlTabStore.getState().setActiveTab(off));
        await flush();

        expect(tree().opened.s2).toBeUndefined();
        expect(tree().opened.s1).toBeUndefined();
      });

      it('leaves the tree of another profile as it is', async () => {
        setProfiles(connectedSqlite('s1', 'Local SQLite'), connectedSqlite('s3', 'Other SQLite'));
        renderWithProviders(<DbProfiles />);
        const first = Object.keys(tabs())[0];
        selectTab('s1');
        await screen.findByText('Tables');
        act(() => useSqlTabStore.getState().addTab());
        const second = useSqlTabStore.getState().activeTab;
        act(() => useSqlTabStore.getState().setTabProfile(second, 's3'));
        await waitFor(() => expect(tree().opened.s3).toBe(true));
        fireEvent.click(chevron('Other SQLite', 'Hide objects'));
        await flush();

        act(() => useSqlTabStore.getState().setActiveTab(first));
        await flush();

        expect(tree().opened.s1).toBe(true);
        expect(tree().opened.s3).toBeUndefined();
      });
    });
  });

  describe('row heights at each interface size', () => {
    it.each([
      ['small', 60, 25, 67],
      ['medium', 68, 28, 76],
      ['large', 77, 32, 86],
    ] as const)(
      'rounds card, node and status rows to whole px at the %s size',
      async (size: UiSizeKey, first, node, second) => {
        useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, size } });
        setProfiles(connectedSqlite(), connectedSqlite('s2', 'Second SQLite'));
        let finish: (v: unknown) => void = () => {};
        callIPCMock.mockImplementation((() => new Promise(r => (finish = r))) as never);
        renderWithProviders(<DbProfiles />);

        fireEvent.click(chevron('Local SQLite'));
        await screen.findByText('Loading objects…');
        expect(virtual.sizes).toEqual([first, node, second]);

        await act(async () => finish({ schemas: [schema] }));

        // mục chính, Bảng, View, Chỉ mục, Trigger
        expect(virtual.sizes).toEqual([first, node, node, node, node, node, second]);
        expect(virtual.sizes.every(Number.isInteger)).toBe(true);
        const second2 = screen.getByText('Second SQLite').closest<HTMLElement>('.mantine-Card-root')!.parentElement!;
        expect(second2).toHaveStyle({ height: `${second}px`, transform: `translateY(${first + 5 * node}px)` });
        expect(row('Tables').parentElement).toHaveStyle({
          height: `${node}px`,
          transform: `translateY(${first + node}px)`,
        });
      }
    );
  });
});
