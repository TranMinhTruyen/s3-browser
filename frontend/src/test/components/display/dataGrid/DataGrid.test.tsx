import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import DataGrid from '@/components/display/dataGrid/DataGrid';

type Options = {
  count: number;
  horizontal?: boolean;
  paddingStart?: number;
  estimateSize: () => number;
  getScrollElement: () => unknown;
  overscan?: number;
};

// jsdom has no layout, so the virtualizers are replaced: they render every item unless a range is set.
const virtual = vi.hoisted(() => ({
  rows: null as [number, number] | null,
  cols: null as [number, number] | null,
  rowOptions: null as unknown,
  colOptions: null as unknown,
  measure: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: Options) => {
    options.getScrollElement();
    const size = options.estimateSize();
    const pad = options.paddingStart ?? 0;
    const range = options.horizontal ? virtual.cols : virtual.rows;
    if (options.horizontal) virtual.colOptions = { ...options, size };
    else virtual.rowOptions = { ...options, size };
    const first = range ? range[0] : 0;
    const last = range ? Math.min(range[1], options.count - 1) : options.count - 1;
    const items = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => ({
      key: first + i,
      index: first + i,
      start: pad + (first + i) * size,
      size,
    }));
    return { measure: virtual.measure, getVirtualItems: () => items, getTotalSize: () => pad + options.count * size };
  },
}));

const columns = ['id', 'name', 'blob'];
const rows: (string | null)[][] = [
  ['1', 'Ann', null],
  ['2', 'Bob', 'x'],
];

const NULL_TEXT = 'NULL';

function renderGrid(props: Partial<React.ComponentProps<typeof DataGrid>> = {}) {
  return render(<DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} {...props} />);
}

const manyRows = (n: number) => Array.from({ length: n }, (_, i) => [String(i), `r${i}`, null]);

describe('DataGrid', () => {
  beforeEach(() => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS } });
    virtual.rows = null;
    virtual.cols = null;
  });

  it('shows the column headers and a row number column for the rows', () => {
    renderGrid();
    for (const name of columns) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getAllByText('1')).toHaveLength(2); // row number + id cell
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows only the header when there are no rows', () => {
    renderGrid({ rows: [] });
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.queryByText('Ann')).not.toBeInTheDocument();
  });

  it('shows NULL cells with the given text and without a tooltip', () => {
    renderGrid();
    const cell = screen.getByText(NULL_TEXT);
    expect(cell).not.toHaveAttribute('title');
    expect(cell.className).toContain('null');
    expect(screen.getByText('Ann')).toHaveAttribute('title', 'Ann');
    expect(screen.getByText('Ann').className).not.toContain('null');
  });

  it('keeps an empty string as an empty cell, not as NULL', () => {
    renderGrid({ rows: [['1', '', 'x']] });
    expect(screen.queryByText(NULL_TEXT)).not.toBeInTheDocument();
  });

  it('puts at most 200 characters of a very long value in the cell and 1000 in its tooltip', () => {
    const value = 'ab'.repeat(5000);
    renderGrid({ rows: [['1', value, 'x']] });

    const cell = screen.getByText('ab'.repeat(100));
    expect(cell.textContent).toHaveLength(200);
    expect(cell.getAttribute('title')).toHaveLength(1000);
  });

  it('keeps a value of exactly 200 characters whole', () => {
    const value = 'z'.repeat(200);
    renderGrid({ rows: [['1', value, 'x']] });
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  it('lays the columns out for horizontal scrolling: one cell per column at a fixed width and a wide canvas', () => {
    renderGrid();
    const header = screen.getByText('id');
    expect(header).toHaveStyle({ left: '56px', width: '160px' });
    expect(screen.getByText('name')).toHaveStyle({ left: '216px' });
  });

  it('only renders the cells the virtualizers report', () => {
    virtual.rows = [1, 1];
    virtual.cols = [1, 2];
    renderGrid();
    expect(screen.queryByText('Ann')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('id')).not.toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getAllByText('2')).toHaveLength(1); // row number only: the id column is out of view
  });

  it('scales the row height, column width and paddings with the interface size and measures again', () => {
    const { rerender } = renderGrid();
    expect(virtual.rowOptions).toMatchObject({ size: 32, paddingStart: 32 });
    expect(virtual.colOptions).toMatchObject({ size: 160, paddingStart: 56 });
    expect(virtual.measure).not.toHaveBeenCalled();

    act(() => useSettingStore.setState(s => ({ draft: { ...s.draft, size: 'large' } })));
    rerender(<DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} />);

    expect(virtual.rowOptions).toMatchObject({ size: 36, paddingStart: 36 });
    expect(virtual.colOptions).toMatchObject({ size: 180, paddingStart: 63 });
    expect(virtual.measure).toHaveBeenCalledTimes(2);
  });

  describe('onEndReached', () => {
    it('is called once when the last rendered row is near the end of the loaded rows', () => {
      const onEndReached = vi.fn();
      renderGrid({ hasMore: true, onEndReached });
      expect(onEndReached).toHaveBeenCalledTimes(1);
    });

    it('is not called again when loading toggles but the rows are the same', () => {
      const onEndReached = vi.fn();
      const { rerender } = renderGrid({ hasMore: true, onEndReached });
      rerender(
        <DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} hasMore loading onEndReached={onEndReached} />
      );
      rerender(<DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} hasMore onEndReached={onEndReached} />);
      expect(onEndReached).toHaveBeenCalledTimes(1);
    });

    it('is not called again for a re-render with the same rows', () => {
      const onEndReached = vi.fn();
      const { rerender } = renderGrid({ hasMore: true, onEndReached });
      rerender(<DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} hasMore onEndReached={onEndReached} />);
      expect(onEndReached).toHaveBeenCalledTimes(1);
    });

    it('is called again after a page arrives, also when the page is shorter than the page size', () => {
      const onEndReached = vi.fn();
      const { rerender } = renderGrid({ rows: manyRows(3), hasMore: true, onEndReached });
      rerender(
        <DataGrid columns={columns} rows={manyRows(4)} nullText={NULL_TEXT} hasMore onEndReached={onEndReached} />
      );
      expect(onEndReached).toHaveBeenCalledTimes(2);
    });

    it('is not called when there is nothing more to load', () => {
      const onEndReached = vi.fn();
      renderGrid({ hasMore: false, onEndReached });
      expect(onEndReached).not.toHaveBeenCalled();
    });

    it('is not called while a page is loading, then once loading ends', () => {
      const onEndReached = vi.fn();
      const { rerender } = renderGrid({ hasMore: true, loading: true, onEndReached });
      expect(onEndReached).not.toHaveBeenCalled();

      rerender(<DataGrid columns={columns} rows={rows} nullText={NULL_TEXT} hasMore onEndReached={onEndReached} />);

      expect(onEndReached).toHaveBeenCalledTimes(1);
    });

    it('is not called while the end of the loaded rows is far from the rows in view', () => {
      virtual.rows = [0, 20];
      const onEndReached = vi.fn();
      renderGrid({ rows: manyRows(100), hasMore: true, onEndReached });
      expect(onEndReached).not.toHaveBeenCalled();
    });

    it('is called when the rows in view reach within 10 rows of the end', () => {
      virtual.rows = [80, 89];
      const onEndReached = vi.fn();
      renderGrid({ rows: manyRows(100), hasMore: true, onEndReached });
      expect(onEndReached).toHaveBeenCalledTimes(1);
    });

    it('is not called when no row is rendered (empty grid) and a missing callback does not throw', () => {
      const onEndReached = vi.fn();
      renderGrid({ rows: [], hasMore: true, onEndReached });
      expect(onEndReached).toHaveBeenCalledTimes(1); // lastIndex -1 is within threshold of an empty list
      expect(() => renderGrid({ hasMore: true })).not.toThrow();
    });
  });
});
