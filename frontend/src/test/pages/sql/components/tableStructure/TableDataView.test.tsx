import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridEdit } from '@/components/display/dataGrid/useGridEdit';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import TableDataView from '@/pages/sql/components/tableStructure/TableDataView';
import { useTableRows } from '@/pages/sql/hooks/useTableRows';
import { isTableDirty } from '@/pages/sql/utils/dirtyTables';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/pages/sql/hooks/useTableRows', () => ({ useTableRows: vi.fn() }));
// The edit prop the view gave the grid last, so tests can act as the grid.
const grid = vi.hoisted(() => ({ edit: undefined as unknown as GridEdit, fit: vi.fn() }));
// jsdom has no layout, so the virtualized grid is replaced by a stub that shows what it was given.
vi.mock('@/components/display/dataGrid/DataGrid', () => ({
  default: function MockDataGrid(props: {
    columns: string[];
    rows: (string | null)[][];
    nullText: string;
    hasMore: boolean;
    loading: boolean;
    onEndReached: () => void;
    edit: GridEdit;
    copyLabels: { copy: string; copyWithHeaders: string };
    ref?: React.Ref<{ fitColumns: () => void }>;
  }) {
    grid.edit = props.edit;
    useImperativeHandle(props.ref, () => ({ fitColumns: grid.fit }));
    return (
      <div
        data-testid="grid"
        data-columns={props.columns.join(',')}
        data-rows={props.rows.length}
        data-null={props.nullText}
        data-copy={props.copyLabels.copy}
        data-copy-headers={props.copyLabels.copyWithHeaders}
        data-has-more={String(props.hasMore)}
        data-loading={String(props.loading)}
      >
        <button type="button" onClick={props.onEndReached}>
          end
        </button>
      </div>
    );
  },
}));

const useRowsMock = vi.mocked(useTableRows);
const loadMore = vi.fn();
const setFetchAllRows = vi.fn();
const refresh = vi.fn();
const confirmShow = vi.mocked(ConfirmModal.show);

const state = (extra: Partial<ReturnType<typeof useTableRows>> = {}) =>
  useRowsMock.mockReturnValue({
    columns: ['id', 'name'],
    rows: [['1', 'a']],
    hasMore: true,
    loading: false,
    loadingMore: false,
    fetchAll: false,
    loadMore,
    setFetchAllRows,
    refresh,
    resetKey: 'k1',
    ...extra,
  });

const renderView = () =>
  renderWithProviders(<TableDataView tabId="t1" provider="sqlite" profileId="p1" schema="main" table="users" />);

beforeEach(() => {
  vi.clearAllMocks();
  state();
});

describe('TableDataView', () => {
  it('loads the rows of the table of its tab', () => {
    renderView();
    expect(useRowsMock).toHaveBeenCalledWith('t1', 'sqlite', 'p1', 'main', 'users');
  });

  it('shows a spinner and no grid while the first page loads', () => {
    state({ loading: true, columns: [], rows: [] });
    const { container } = renderView();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('gives the grid the columns, rows and the translated NULL text', () => {
    renderView();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-columns', 'id,name');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-rows', '1');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-null', 'NULL');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-has-more', 'true');
  });

  it('gives the grid the translated Copy labels of its context menu', () => {
    renderView();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-copy', 'Copy');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-copy-headers', 'Copy with column names');
  });

  it('loads the next page when the grid reaches its end', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'end' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('shows the loading-more line only while a page loads', () => {
    const { unmount } = renderView();
    expect(screen.queryByText('Loading more rows…')).not.toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-loading', 'false');
    unmount();

    state({ loadingMore: true });
    renderView();
    expect(screen.getByText('Loading more rows…')).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-loading', 'true');
  });

  it('shows an empty grid when the table has no row', () => {
    state({ rows: [], hasMore: false });
    renderView();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-rows', '0');
    expect(screen.getByTestId('grid')).toHaveAttribute('data-has-more', 'false');
  });

  describe('editing', () => {
    const button = (name: string) => screen.getByRole('button', { name });
    const select = (rows: number[]) => act(() => grid.edit.onSelectionChange(rows));

    it('gives the grid the pending edits and the translated labels', () => {
      renderView();
      expect(grid.edit.newRows).toEqual([]);
      expect(grid.edit.deleted.size).toBe(0);
      expect(grid.edit.edited.size).toBe(0);
      expect(grid.edit.labels).toEqual({
        setNull: 'Set NULL',
        deleteRows: 'Delete row',
        restoreRows: 'Restore row',
        rowNew: 'New row',
        rowEdited: 'Edited row',
        rowDeleted: 'Row to delete',
      });
    });

    it('has no toolbar while the first page loads', () => {
      state({ loading: true, columns: [], rows: [] });
      renderView();
      expect(screen.queryByRole('button', { name: 'Add row' })).not.toBeInTheDocument();
    });

    it('starts clean: nothing changed, Rollback and Delete disabled, tab not dirty', () => {
      renderView();
      expect(screen.getByText('Changed rows: 0')).toBeInTheDocument();
      expect(button('Rollback')).toBeDisabled();
      expect(button('Delete row')).toBeDisabled();
      expect(isTableDirty('t1')).toBe(false);
    });

    it('Add row adds an empty row, counts it, enables Rollback and marks the tab dirty', () => {
      renderView();
      fireEvent.click(button('Add row'));
      expect(grid.edit.newRows).toEqual([[null, null]]);
      expect(screen.getByText('Changed rows: 1')).toBeInTheDocument();
      expect(button('Rollback')).toBeEnabled();
      expect(isTableDirty('t1')).toBe(true);
    });

    it('counts edited and deleted rows from the grid', () => {
      renderView();
      act(() => grid.edit.onSetCell(0, 1, 'zzz'));
      expect(grid.edit.edited.get(0)?.get(1)).toBe('zzz');
      expect(screen.getByText('Changed rows: 1')).toBeInTheDocument();
      act(() => grid.edit.onToggleDeleteRows([0]));
      expect(screen.getByText('Changed rows: 1')).toBeInTheDocument();
      expect(grid.edit.deleted.has(0)).toBe(true);
    });

    it('Delete row deletes the selected rows; the button then offers Restore row for them', () => {
      renderView();
      select([0]);
      expect(button('Delete row')).toBeEnabled();
      fireEvent.click(button('Delete row'));
      expect(grid.edit.deleted.has(0)).toBe(true);
      expect(button('Restore row')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete row' })).not.toBeInTheDocument();

      fireEvent.click(button('Restore row'));
      expect(grid.edit.deleted.size).toBe(0);
      expect(button('Delete row')).toBeInTheDocument();
    });

    it('deleting a new row removes it; a selection of new and deleted rows does not offer Restore', () => {
      renderView();
      fireEvent.click(button('Add row'));
      select([0]);
      expect(button('Delete row')).toBeEnabled();
      fireEvent.click(button('Delete row'));
      expect(grid.edit.newRows).toEqual([]);
      expect(screen.getByText('Changed rows: 0')).toBeInTheDocument();

      fireEvent.click(button('Add row'));
      act(() => grid.edit.onToggleDeleteRows([1]));
      select([0, 1]);
      expect(button('Delete row')).toBeInTheDocument();
    });

    it('Commit is disabled and explains why on hover', async () => {
      renderView();
      fireEvent.click(button('Add row'));
      expect(button('Commit')).toBeDisabled();
      await userEvent.hover(button('Commit').parentElement as HTMLElement);
      expect(await screen.findByText('Commit is not supported yet')).toBeInTheDocument();
    });

    it('Fit columns is enabled with columns and loaded rows, and fits the grid when clicked', () => {
      renderView();
      expect(button('Fit columns to data')).toBeEnabled();
      fireEvent.click(button('Fit columns to data'));
      expect(grid.fit).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no loaded row', { rows: [] }],
      ['no column', { columns: [] }],
    ])('Fit columns is disabled with %s', (_name, extra) => {
      state(extra);
      renderView();
      expect(button('Fit columns to data')).toBeDisabled();
      fireEvent.click(button('Fit columns to data'));
      expect(grid.fit).not.toHaveBeenCalled();
    });

    it('Rollback drops every change and clears the dirty mark', () => {
      renderView();
      fireEvent.click(button('Add row'));
      act(() => grid.edit.onSetCell(1, 0, '9'));
      fireEvent.click(button('Rollback'));
      expect(grid.edit.newRows).toEqual([]);
      expect(grid.edit.edited.size).toBe(0);
      expect(screen.getByText('Changed rows: 0')).toBeInTheDocument();
      expect(button('Rollback')).toBeDisabled();
      expect(isTableDirty('t1')).toBe(false);
    });

    it('drops the changes when the table (resetKey) changes', () => {
      const { rerender } = renderView();
      fireEvent.click(button('Add row'));
      state({ resetKey: 'k2' });
      rerender(<TableDataView tabId="t1" provider="sqlite" profileId="p1" schema="main" table="orders" />);
      expect(screen.getByText('Changed rows: 0')).toBeInTheDocument();
      expect(isTableDirty('t1')).toBe(false);
    });

    it('clears the dirty mark when the view unmounts with changes', () => {
      const { unmount } = renderView();
      fireEvent.click(button('Add row'));
      expect(isTableDirty('t1')).toBe(true);
      unmount();
      expect(isTableDirty('t1')).toBe(false);
    });
  });
  describe('fetch all rows', () => {
    const box = () => screen.getByRole('checkbox', { name: 'Fetch all data' });
    const loader = (c: HTMLElement) => c.querySelector('.mantine-Loader-root');

    it('is an enabled, unticked checkbox while there are more rows', () => {
      const { container } = renderView();
      expect(box()).toBeEnabled();
      expect(box()).not.toBeChecked();
      expect(loader(container)).not.toBeInTheDocument();
    });

    it('ticking asks the hook to fetch all; unticking asks it to stop', () => {
      const { unmount } = renderView();
      fireEvent.click(box());
      expect(setFetchAllRows).toHaveBeenLastCalledWith(true);
      unmount();

      state({ fetchAll: true, loadingMore: true });
      renderView();
      expect(box()).toBeChecked();
      fireEvent.click(box());
      expect(setFetchAllRows).toHaveBeenLastCalledWith(false);
    });

    it('shows a loader only while fetching all', () => {
      state({ fetchAll: true, loadingMore: true });
      const { container, unmount } = renderView();
      expect(loader(container)).toBeInTheDocument();
      expect(box()).toBeEnabled();
      unmount();

      state({ fetchAll: true, loadingMore: false, hasMore: false });
      const second = renderView();
      expect(loader(second.container)).not.toBeInTheDocument();
    });

    it('is disabled while a normal page loads (not ticked)', () => {
      state({ loadingMore: true });
      const { container } = renderView();
      expect(box()).toBeDisabled();
      expect(loader(container)).not.toBeInTheDocument();
    });

    it('is disabled when there is no more data and it is not ticked', () => {
      state({ hasMore: false });
      renderView();
      expect(box()).toBeDisabled();
    });

    it('stays enabled when ticked even after everything was read', () => {
      state({ fetchAll: true, hasMore: false });
      renderView();
      expect(box()).toBeEnabled();
      expect(box()).toBeChecked();
    });

    it('shows a pointer cursor on the label when enabled and not-allowed when disabled', () => {
      const { unmount } = renderView();
      expect(screen.getByText('Fetch all data')).toHaveStyle({ cursor: 'pointer' });
      unmount();
      state({ hasMore: false });
      renderView();
      expect(screen.getByText('Fetch all data')).toHaveStyle({ cursor: 'not-allowed' });
    });

    it('clicking the label ticks the checkbox', () => {
      renderView();
      fireEvent.click(screen.getByText('Fetch all data'));
      expect(setFetchAllRows).toHaveBeenLastCalledWith(true);
    });
  });

  describe('loaded rows', () => {
    it('shows the loaded row count formatted for the language', () => {
      state({ rows: Array.from({ length: 1234 }, () => ['1', 'a']) });
      renderView();
      expect(screen.getByText('Loaded rows: 1,234')).toBeInTheDocument();
    });
  });

  describe('refresh', () => {
    const clickRefresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    it('reloads at once when nothing changed, without asking', async () => {
      renderView();
      clickRefresh();
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(confirmShow).not.toHaveBeenCalled();
    });

    it('with pending changes asks first; declining changes nothing', async () => {
      confirmShow.mockResolvedValue(false);
      renderView();
      fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
      clickRefresh();
      await waitFor(() =>
        expect(confirmShow).toHaveBeenCalledWith({
          type: 'warning',
          confirmCode: 'C000014',
          params: { table: 'users' },
        })
      );
      await act(async () => {});
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.getByText('Changed rows: 1')).toBeInTheDocument();
    });

    it('with pending changes and a yes, drops them, clears the selection and reloads', async () => {
      confirmShow.mockResolvedValue(true);
      renderView();
      fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
      act(() => grid.edit.onSelectionChange([0]));
      expect(screen.getByRole('button', { name: 'Delete row' })).toBeEnabled();
      clickRefresh();
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Changed rows: 0')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete row' })).toBeDisabled();
    });
  });
});
