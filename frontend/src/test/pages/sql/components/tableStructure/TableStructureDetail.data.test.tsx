import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TableInfoOutput } from '@wails/S3Browser/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TableStructureDetail from '@/pages/sql/components/tableStructure/TableStructureDetail';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { fetchTableRows, loadTableInfo, openTableRows } from '@/pages/sql/utils/dbObjectSource';
import { sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/sql/utils/dbObjectSource', () => ({
  loadTableInfo: vi.fn(),
  openTableRows: vi.fn(),
  fetchTableRows: vi.fn(),
}));
// Không mock TableDataView ở đây vì effect useTableRows phải tiếp tục tồn tại khi chuyển tab con.
vi.mock('@/components/display/dataGrid/DataGrid', () => ({
  default: (props: { columns: string[]; rows: (string | null)[][] }) => (
    <div data-testid="grid">
      <span>{props.columns.join('|')}</span>
      {props.rows.map(r => (
        <span key={r.join('|')}>{r.join('|')}</span>
      ))}
    </div>
  ),
}));

const openMock = vi.mocked(openTableRows);

beforeEach(() => {
  vi.clearAllMocks();
  useDbProfileStore.getState().reset();
  useSqlTabStore.getState().reset();
  useDbProfileStore.setState({ dbProfiles: toProfileMap(sqliteProfile('s1', { isConnected: true })) });
  vi.mocked(loadTableInfo).mockResolvedValue({
    columns: [],
    indexes: [],
    constraints: [],
    foreignKeys: [],
    ddl: '',
  } as unknown as TableInfoOutput);
  openMock.mockResolvedValue({ columns: ['id'], rows: [['1'], ['2']], done: false, cursorId: 7 });
});

describe('TableStructureDetail with the real Data view', () => {
  it('keeps the loaded rows and does not reopen the table when switching Data -> Column -> Data', async () => {
    useSqlTabStore.getState().openTableTab('s1', 'main', 'users');
    const { container } = renderWithProviders(<TableStructureDetail tabId={useSqlTabStore.getState().activeTab} />);

    await screen.findByText('1');
    expect(openMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('tab', { name: 'Column' }));
    const dataPanel = document.getElementById(
      screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-controls')!
    )!;
    // Panel Data bị ẩn vẫn giữ trong DOM (display: none) cùng các hàng đã tải.
    expect(dataPanel).toHaveStyle({ display: 'none' });
    expect(dataPanel).toHaveTextContent('id');

    await userEvent.click(screen.getByRole('tab', { name: 'Data' }));

    await waitFor(() => expect(dataPanel).not.toHaveStyle({ display: 'none' }));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTableRows)).not.toHaveBeenCalled();
    expect(container.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    expect(dataPanel).toHaveTextContent('id');
    expect(dataPanel).toHaveTextContent('1');
    expect(dataPanel).toHaveTextContent('2');
  });
});
