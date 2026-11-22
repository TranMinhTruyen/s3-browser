import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TableInfoOutput } from '@wails/S3Browser/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TableStructureDetail from '@/pages/sql/components/tableStructure/TableStructureDetail';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { loadTableInfo } from '@/pages/sql/utils/dbObjectSource';
import { pgProfile, sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/sql/utils/dbObjectSource', () => ({ loadTableInfo: vi.fn() }));
vi.mock('@/pages/sql/components/tableStructure/TableDataView', () => ({
  default: (props: { tabId: string; provider: string; profileId: string; schema: string; table: string }) => (
    <div data-testid="data-view">{`${props.tabId}|${props.provider}|${props.profileId}|${props.schema}|${props.table}`}</div>
  ),
}));
// jsdom has no layout, so the virtualized grid is replaced by a stub that shows what it was given.
vi.mock('@/components/display/dataGrid/DataGrid', () => ({
  default: (props: { columns: string[]; rows: (string | null)[][]; nullText: string }) => (
    <div data-testid="grid" data-null={props.nullText}>
      <span>{props.columns.join('|')}</span>
      {props.rows.map(r => (
        <span key={r.join('|')}>{r.map(c => c ?? '<null>').join('|')}</span>
      ))}
    </div>
  ),
}));

const loadMock = vi.mocked(loadTableInfo);

const info = {
  columns: [{ cid: 0, name: 'id', type: 'INTEGER', notNull: true, defaultValue: null, pk: 1 }],
  indexes: [{ name: 'ix_users', unique: true, origin: 'c', partial: false, columns: ['email'] }],
  constraints: [{ kind: 'CHECK', name: 'ck', columns: ['id'], expression: 'id > 0' }],
  foreignKeys: [
    { id: 0, columns: ['org'], refTable: 'orgs', refColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
  ],
  ddl: 'CREATE TABLE users (id INTEGER);',
} as TableInfoOutput;

const tabId = () => useSqlTabStore.getState().activeTab;

const openTable = (profileId = 's1') => {
  useSqlTabStore.getState().openTableTab(profileId, 'main', 'users');
  return tabId();
};

const renderDetail = (id = openTable()) => renderWithProviders(<TableStructureDetail tabId={id} />);

const selectTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));
/** The panel of a sub tab (they all stay mounted, so each one is found by its tab). */
const panelOf = (name: string) =>
  document.getElementById(screen.getByRole('tab', { name }).getAttribute('aria-controls')!)!;

beforeEach(() => {
  vi.clearAllMocks();
  useDbProfileStore.getState().reset();
  useSqlTabStore.getState().reset();
  useDbProfileStore.setState({
    dbProfiles: toProfileMap(sqliteProfile('s1', { isConnected: true }), pgProfile('pg1', { isConnected: true })),
  });
  loadMock.mockResolvedValue(info);
});

describe('TableStructureDetail', () => {
  it('shows the six sub tabs and starts on Data', async () => {
    renderDetail();
    await screen.findByTestId('data-view');

    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual([
      'Data',
      'Column',
      'Index',
      'Constraint',
      'FK',
      'Source',
    ]);
    expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
  });

  it('gives the Data view the tab, provider, profile and table', async () => {
    const id = openTable();
    renderDetail(id);
    expect(await screen.findByTestId('data-view')).toHaveTextContent(`${id}|sqlite|s1|main|users`);
  });

  it('loads the structure of the table once with the provider of its profile', async () => {
    renderDetail();
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    expect(loadMock).toHaveBeenCalledWith(
      'sqlite',
      { profileId: 's1', schema: 'main', table: 'users' },
      expect.any(AbortSignal)
    );
  });

  it('uses the PostgreSQL provider for a PostgreSQL profile', async () => {
    renderDetail(openTable('pg1'));
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith('postgres', expect.anything(), expect.any(AbortSignal)));
  });

  it('shows a spinner in the grid tabs and Source while the structure loads', async () => {
    loadMock.mockReturnValue(new Promise(() => {}));
    renderDetail();

    for (const name of ['Column', 'Index', 'Constraint', 'FK', 'Source']) {
      expect(panelOf(name).querySelector('.mantine-Loader-root')).toBeInTheDocument();
    }
    expect(screen.queryByText('Could not load the table structure')).not.toBeInTheDocument();
  });

  it('fills the Column grid with the translated headers and rows', async () => {
    renderDetail();
    await waitFor(() => expect(panelOf('Column').querySelector('[data-testid=grid]')).toBeInTheDocument());

    const grid = panelOf('Column');
    expect(grid).toHaveTextContent('Name|Type|Nullable|Default|Primary key');
    expect(grid).toHaveTextContent('id|INTEGER|No|<null>|Yes');
    expect(panelOf('Column').querySelector('[data-testid=grid]')).toHaveAttribute('data-null', 'NULL');
  });

  it.each([
    ['Index', 'Name|Unique|Origin|Partial|Columns', 'ix_users|Yes|c|No|email'],
    ['Constraint', 'Kind|Name|Columns|Expression', 'CHECK|ck|id|id > 0'],
    ['FK', 'Columns|Referenced table|Referenced columns|On update|On delete', 'org|orgs|id|NO ACTION|CASCADE'],
  ])('fills the %s grid', async (tab, headers, row) => {
    renderDetail();
    await waitFor(() => expect(panelOf(tab).querySelector('[data-testid=grid]')).toBeInTheDocument());

    expect(panelOf(tab)).toHaveTextContent(headers);
    expect(panelOf(tab)).toHaveTextContent(row);
  });

  it('shows the DDL in the Source tab', async () => {
    renderDetail();
    await selectTab('Source');
    await waitFor(() => expect(screen.getByText('CREATE TABLE users (id INTEGER);')).toBeInTheDocument());
  });

  it('shows the placeholder in Source when the structure has no DDL', async () => {
    loadMock.mockResolvedValue({ ...info, ddl: undefined } as unknown as TableInfoOutput);
    renderDetail();
    await waitFor(() => expect(screen.getByText('No source available')).toBeInTheDocument());
  });

  it('shows the load error in every panel but Data when GetTableInfo returns null', async () => {
    loadMock.mockResolvedValue(null);
    renderDetail();

    await waitFor(() => expect(panelOf('Column')).toHaveTextContent('Could not load the table structure'));
    for (const name of ['Index', 'Constraint', 'FK', 'Source']) {
      expect(panelOf(name)).toHaveTextContent('Could not load the table structure');
    }
    expect(screen.getByTestId('data-view')).toBeInTheDocument();
  });

  it('keeps the panels mounted when switching sub tabs, and does not load again', async () => {
    renderDetail();
    await waitFor(() => expect(panelOf('Column').querySelector('[data-testid=grid]')).toBeInTheDocument());

    await selectTab('Index');
    await selectTab('Data');

    expect(screen.getByTestId('data-view')).toBeInTheDocument();
    expect(panelOf('Column').querySelector('[data-testid=grid]')).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a structure that arrives after unmount and aborts the call', async () => {
    let resolve!: (v: TableInfoOutput) => void;
    loadMock.mockReturnValue(new Promise(r => (resolve = r)));
    const { unmount } = renderDetail();
    const signal = loadMock.mock.calls[0][2];

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(info));
  });

  it('renders nothing and does not load for a tab without a table, an unknown tab or a missing profile', () => {
    const sqlTab = tabId();
    const empty = () => screen.queryAllByRole('tab');

    const first = renderDetail(sqlTab);
    expect(empty()).toHaveLength(0);
    first.unmount();

    const second = renderDetail('nope');
    expect(empty()).toHaveLength(0);
    second.unmount();

    useSqlTabStore.getState().openTableTab('gone', 'main', 'users');
    renderDetail(tabId());
    expect(empty()).toHaveLength(0);
    expect(loadMock).not.toHaveBeenCalled();
  });
});
