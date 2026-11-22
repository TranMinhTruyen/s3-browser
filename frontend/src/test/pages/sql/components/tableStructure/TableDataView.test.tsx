import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TableDataView from '@/pages/sql/components/tableStructure/TableDataView';
import { useTableRows } from '@/pages/sql/hooks/useTableRows';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/sql/hooks/useTableRows', () => ({ useTableRows: vi.fn() }));
// jsdom has no layout, so the virtualized grid is replaced by a stub that shows what it was given.
vi.mock('@/components/display/dataGrid/DataGrid', () => ({
  default: (props: {
    columns: string[];
    rows: (string | null)[][];
    nullText: string;
    hasMore: boolean;
    loading: boolean;
    onEndReached: () => void;
  }) => (
    <div
      data-testid="grid"
      data-columns={props.columns.join(',')}
      data-rows={props.rows.length}
      data-null={props.nullText}
      data-has-more={String(props.hasMore)}
      data-loading={String(props.loading)}
    >
      <button type="button" onClick={props.onEndReached}>
        end
      </button>
    </div>
  ),
}));

const useRowsMock = vi.mocked(useTableRows);
const loadMore = vi.fn();

const state = (extra: Partial<ReturnType<typeof useTableRows>> = {}) =>
  useRowsMock.mockReturnValue({
    columns: ['id', 'name'],
    rows: [['1', 'a']],
    hasMore: true,
    loading: false,
    loadingMore: false,
    loadMore,
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
});
