import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useImperativeHandle } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SqlResultPanel from '@/pages/sql/components/sqlResult/SqlResultPanel';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';
import { statement } from '@/test/_helpers/sqlStatement';

const grid = vi.hoisted(() => ({ calls: [] as Record<string, any>[], mounts: 0, unmounts: 0, fits: [] as string[] }));

vi.mock('@/components/display/dataGrid/DataGrid', () => ({
  default: function MockDataGrid(props: Record<string, any>) {
    grid.calls.push(props);
    // Handle do panel điều khiển: ghi lại giá trị đầu tiên của grid được yêu cầu căn vừa.
    useImperativeHandle(props.ref, () => ({ fitColumns: () => grid.fits.push(String(props.rows[0]?.[0])) }));
    // Effect của grid thật: nếu dùng Activity thì effect sẽ bị gỡ và chạy lại mỗi lần chuyển tab.
    useEffect(() => {
      grid.mounts += 1;
      return () => {
        grid.unmounts += 1;
      };
    }, []);
    return (
      <button type="button" data-testid="grid" onClick={props.onEndReached}>
        {props.columns.join(',')}|{props.rows.length}
      </button>
    );
  },
}));
vi.mock('@/pages/sql/components/sqlResult/SqlMessageList', () => ({
  default: (props: { statements: unknown[]; cancelled: boolean }) => (
    <div data-testid="messages">{`${props.statements.length}:${props.cancelled}`}</div>
  ),
}));

const base = { cancelled: false, running: false, loadingMore: false, onLoadMore: vi.fn() };
const select = (index: number, extra = {}) => statement({ index, sql: `select ${index}`, ...extra });
/** Mọi panel luôn được mount; chỉ panel đang chọn được hiển thị. */
const shown = (id: string) => {
  const found = screen
    .getAllByTestId(id)
    .filter(el => el.closest('[role="tabpanel"]')?.getAttribute('style')?.includes('display: none') !== true);
  expect(found).toHaveLength(1);
  return found[0];
};
const tab = (name: string) => screen.getByRole('tab', { name });

describe('SqlResultPanel', () => {
  it('renders nothing before the first run', () => {
    renderWithProviders(<SqlResultPanel {...base} statements={[]} />);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
  });

  it('shows a loader while the first run is still going', () => {
    renderWithProviders(<SqlResultPanel {...base} statements={[]} running />);
    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('has a Result tab per SELECT plus Messages, and opens the last result', () => {
    renderWithProviders(
      <SqlResultPanel
        {...base}
        statements={[select(0), statement({ index: 1, kind: 'exec', rows: [] }), select(2, { rows: [['1'], ['2']] })]}
      />
    );
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Result 1', 'Result 2', 'Messages']);
    expect(tab('Result 2')).toHaveAttribute('aria-selected', 'true');
    expect(shown('grid')).toHaveTextContent('id|2');
  });

  it('switches between the results and the messages', async () => {
    renderWithProviders(<SqlResultPanel {...base} statements={[select(0, { rows: [] }), select(1)]} />);
    await userEvent.click(tab('Result 1'));
    expect(tab('Result 1')).toHaveAttribute('aria-selected', 'true');
    expect(shown('grid')).toHaveTextContent('id|0');

    await userEvent.click(tab('Messages'));
    expect(shown('messages')).toHaveTextContent('2:false');
  });

  it('starts on Messages when the last statement failed', () => {
    renderWithProviders(
      <SqlResultPanel {...base} statements={[select(0), select(1, { error: { code: 'DBE006', message: 'x' } })]} />
    );
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Result 1', 'Messages']);
    expect(tab('Messages')).toHaveAttribute('aria-selected', 'true');
  });

  it('starts on Messages when no statement returned rows', () => {
    renderWithProviders(<SqlResultPanel {...base} statements={[statement({ kind: 'exec', rows: [] })]} />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(tab('Messages')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the Messages tab with the canceled row when canceled before any result', () => {
    renderWithProviders(<SqlResultPanel {...base} statements={[]} cancelled />);
    expect(tab('Messages')).toHaveAttribute('aria-selected', 'true');
    expect(shown('messages')).toHaveTextContent('0:true');
  });

  it('gives the grid the translated Copy labels of its context menu', () => {
    grid.calls.length = 0;
    renderWithProviders(<SqlResultPanel {...base} statements={[select(0)]} />);
    expect(grid.calls.at(-1)?.copyLabels).toEqual({ copy: 'Copy', copyWithHeaders: 'Copy with column names' });
  });

  it('gives the grid the column names, NULL text and loading state, and loads more at the end', async () => {
    grid.calls.length = 0;
    const onLoadMore = vi.fn();
    renderWithProviders(
      <SqlResultPanel {...base} onLoadMore={onLoadMore} statements={[select(0, { cursorId: 9, done: false })]} />
    );
    expect(grid.calls.at(-1)).toMatchObject({ columns: ['id'], nullText: 'NULL', hasMore: true, loading: false });
    await userEvent.click(shown('grid'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  describe('fit columns', () => {
    const fitButton = () =>
      within(screen.getAllByRole('tabpanel').find(p => p.style.display !== 'none') as HTMLElement).getByRole('button', {
        name: 'Fit columns to data',
      });
    const two = () => [select(0, { rows: [['first']] }), select(1, { rows: [['second']] })];

    it('fits the grid of the Result tab being viewed', async () => {
      grid.fits.length = 0;
      renderWithProviders(<SqlResultPanel {...base} statements={two()} />);
      await userEvent.click(fitButton());
      expect(grid.fits).toEqual(['second']);

      await userEvent.click(tab('Result 1'));
      await userEvent.click(fitButton());
      expect(grid.fits).toEqual(['second', 'first']);
    });

    it('is disabled for a result without rows', () => {
      renderWithProviders(<SqlResultPanel {...base} statements={[select(0, { rows: [] })]} />);
      expect(fitButton()).toBeDisabled();
    });

    it('is disabled for a result without columns', () => {
      renderWithProviders(<SqlResultPanel {...base} statements={[select(0, { columns: [] })]} />);
      expect(fitButton()).toBeDisabled();
    });
  });

  describe('hidden panels stay mounted (display-none, not Activity)', () => {
    const panelOf = (el: HTMLElement) => el.closest('[role="tabpanel"]') as HTMLElement;

    it('keeps Messages mounted but hidden on the Result tab, and the reverse', async () => {
      renderWithProviders(<SqlResultPanel {...base} statements={[select(0)]} />);
      expect(panelOf(screen.getByTestId('messages'))).toHaveStyle({ display: 'none' });
      expect(panelOf(screen.getByTestId('grid'))).not.toHaveStyle({ display: 'none' });

      await userEvent.click(tab('Messages'));
      expect(panelOf(screen.getByTestId('grid'))).toHaveStyle({ display: 'none' });
      expect(panelOf(screen.getByTestId('messages'))).not.toHaveStyle({ display: 'none' });
    });

    it('does not remount the grid, rerun its effects or call onLoadMore when switching tabs', async () => {
      grid.mounts = 0;
      grid.unmounts = 0;
      const onLoadMore = vi.fn();
      renderWithProviders(
        <SqlResultPanel {...base} onLoadMore={onLoadMore} statements={[select(0, { cursorId: 9, done: false })]} />
      );
      const gridEl = screen.getByTestId('grid');
      expect(grid.mounts).toBe(1);

      await userEvent.click(tab('Messages'));
      await userEvent.click(tab('Result 1'));
      await userEvent.click(tab('Messages'));

      expect(screen.getByTestId('grid')).toBe(gridEl);
      expect(grid.mounts).toBe(1);
      expect(grid.unmounts).toBe(0);
      expect(onLoadMore).not.toHaveBeenCalled();
    });
  });

  it('does not offer more rows once the result is done', () => {
    grid.calls.length = 0;
    renderWithProviders(<SqlResultPanel {...base} statements={[select(0)]} />);
    expect(grid.calls.at(-1)).toMatchObject({ hasMore: false });
  });

  it('says only the first rows are shown for a truncated result', () => {
    const truncated = select(0, { truncated: true, rows: [['1'], ['2']] });
    renderWithProviders(<SqlResultPanel {...base} statements={[truncated]} />);
    expect(screen.getByText('Only the first 2 rows are shown')).toBeInTheDocument();
  });

  it('shows a loading note while more rows are being fetched', () => {
    renderWithProviders(
      <SqlResultPanel {...base} loadingMore statements={[select(0, { cursorId: 9, done: false })]} />
    );
    expect(screen.getByText('Loading more rows...')).toBeInTheDocument();
  });

  it('shows no note for a complete result, nor while loading without a cursor', () => {
    renderWithProviders(<SqlResultPanel {...base} loadingMore statements={[select(0)]} />);
    expect(screen.queryByText('Loading more rows...')).not.toBeInTheDocument();
    expect(screen.queryByText(/Only the first/)).not.toBeInTheDocument();
  });
});
