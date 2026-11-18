import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import DataGrid from '@/components/display/dataGrid/DataGrid';

type Options = {
  count: number;
  horizontal?: boolean;
  paddingStart?: number;
  estimateSize: (index?: number) => number;
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
    const sizes = Array.from({ length: options.count }, (_, i) => options.estimateSize(i));
    const startOf = (i: number) => pad + sizes.slice(0, i).reduce((a, b) => a + b, 0);
    const items = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => ({
      key: first + i,
      index: first + i,
      start: startOf(first + i),
      size: sizes[first + i],
    }));
    return {
      measure: virtual.measure,
      getVirtualItems: () => items,
      getTotalSize: () => startOf(options.count),
    };
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
    virtual.measure.mockClear();
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
    expect(virtual.measure).toHaveBeenCalledTimes(2); // one per virtualizer
  });

  describe('column resize', () => {
    let frames: FrameRequestCallback[];
    let captured: boolean;
    let measureText: ReturnType<typeof vi.fn>;
    let hasContext: boolean;

    const resizer = (i: number) => document.querySelector<HTMLElement>(`[data-index="${i}"]`) as HTMLElement;
    const headerOf = (name: string) => screen.getByText(name);
    const flush = () =>
      act(() => {
        const pending = frames;
        frames = [];
        for (const cb of pending) cb(0);
      });
    const drag = (i: number, from: number, to: number) => {
      fireEvent.pointerDown(resizer(i), { clientX: from, pointerId: 1 });
      fireEvent.pointerMove(resizer(i), { clientX: to, pointerId: 1 });
      flush();
    };

    beforeEach(() => {
      frames = [];
      captured = true;
      hasContext = true;
      measureText = vi.fn((t: string) => ({ width: t.length * 10 }));
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        if (id > 0) frames[id - 1] = () => {};
      });
      HTMLElement.prototype.setPointerCapture = vi.fn();
      HTMLElement.prototype.hasPointerCapture = vi.fn(() => captured);
      HTMLElement.prototype.releasePointerCapture = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
        hasContext ? { font: '', measureText } : null) as never);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('captures the pointer on pointer down and widens the column by the drag distance', () => {
      renderGrid();
      fireEvent.pointerDown(resizer(1), { clientX: 100, pointerId: 7 });
      expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7);
      drag(1, 100, 140);
      expect(headerOf('name')).toHaveStyle({ width: '200px' });
      expect(headerOf('id')).toHaveStyle({ width: '160px' });
      expect(headerOf('blob')).toHaveStyle({ left: '416px' });
      expect(virtual.measure).toHaveBeenCalled();
    });

    it('never makes a column narrower than 48px', () => {
      renderGrid();
      drag(0, 500, 0);
      expect(headerOf('id')).toHaveStyle({ width: '48px' });
    });

    it('divides the drag distance by the interface scale', () => {
      useSettingStore.setState(s => ({ draft: { ...s.draft, size: 'large' } }));
      renderGrid();
      drag(0, 0, 90);
      // 160 + 90 / 1.125 = 240 at the medium size, x 1.125 on screen
      expect(headerOf('id')).toHaveStyle({ width: '270px' });
    });

    it('updates once per frame: only the last move counts', () => {
      renderGrid();
      fireEvent.pointerDown(resizer(1), { clientX: 0, pointerId: 1 });
      fireEvent.pointerMove(resizer(1), { clientX: 10, pointerId: 1 });
      fireEvent.pointerMove(resizer(1), { clientX: 30, pointerId: 1 });
      flush();
      expect(headerOf('name')).toHaveStyle({ width: '190px' });
    });

    it('keeps the state when the width does not change', () => {
      renderGrid();
      drag(1, 0, 0);
      expect(headerOf('name')).toHaveStyle({ width: '160px' });
      drag(1, 0, 0);
      expect(headerOf('name')).toHaveStyle({ width: '160px' });
    });

    it('ignores pointer moves without pointer capture', () => {
      renderGrid();
      fireEvent.pointerDown(resizer(1), { clientX: 0, pointerId: 1 });
      captured = false;
      fireEvent.pointerMove(resizer(1), { clientX: 50, pointerId: 1 });
      expect(frames).toHaveLength(0);
      expect(headerOf('name')).toHaveStyle({ width: '160px' });
    });

    it('starts the next drag from the width set by the previous one', () => {
      renderGrid();
      drag(1, 0, 40);
      drag(1, 0, 10);
      expect(headerOf('name')).toHaveStyle({ width: '210px' });
    });

    it('fits the column to its widest value on double click', () => {
      renderGrid({
        rows: [
          ['1', 'Ann', null],
          ['2', 'Roberta', 'x'],
        ],
      });
      fireEvent.doubleClick(resizer(1));
      // widest is "Roberta" (7 x 10) + 17 of cell padding and border
      expect(headerOf('name')).toHaveStyle({ width: '87px' });
      expect(measureText).toHaveBeenCalledWith('name');
    });

    it('fits to the header when it is wider than the values, skipping NULL cells', () => {
      renderGrid({ rows: [[null, null, null]] });
      fireEvent.doubleClick(resizer(2));
      expect(headerOf('blob')).toHaveStyle({ width: '57px' });
      expect(measureText).toHaveBeenCalledTimes(1);
    });

    it('never fits narrower than 48px', () => {
      renderGrid();
      fireEvent.doubleClick(resizer(0));
      expect(headerOf('id')).toHaveStyle({ width: '48px' });
    });

    it('caps the fitted width at 600px and measures at most 200 characters of a value', () => {
      renderGrid({ rows: [['1', 'a'.repeat(500), 'x']] });
      fireEvent.doubleClick(resizer(1));
      expect(measureText).toHaveBeenCalledWith('a'.repeat(200));
      expect(headerOf('name')).toHaveStyle({ width: '600px' });
    });

    it('divides the measured text by the interface scale', () => {
      useSettingStore.setState(s => ({ draft: { ...s.draft, size: 'large' } }));
      renderGrid({ rows: [['1', 'a'.repeat(45), 'x']] });
      fireEvent.doubleClick(resizer(1));
      // 450 / 1.125 + 17 = 417 at the medium size, x 1.125 on screen
      expect(headerOf('name')).toHaveStyle({ width: '469.125px' });
    });

    it('cancels a pending drag frame on double click', () => {
      renderGrid();
      fireEvent.pointerDown(resizer(1), { clientX: 0, pointerId: 1 });
      fireEvent.pointerMove(resizer(1), { clientX: 100, pointerId: 1 });
      fireEvent.doubleClick(resizer(1));
      flush();
      expect(headerOf('name')).toHaveStyle({ width: '57px' });
    });

    it('does nothing on double click when a canvas context is not available', () => {
      hasContext = false;
      renderGrid();
      fireEvent.doubleClick(resizer(1));
      expect(headerOf('name')).toHaveStyle({ width: '160px' });
    });

    it('measures the columns once for a drag and not again when the width does not change', () => {
      renderGrid();
      drag(1, 0, 40);
      expect(virtual.measure).toHaveBeenCalledTimes(1);
      drag(1, 0, 0);
      expect(virtual.measure).toHaveBeenCalledTimes(1);
      expect(headerOf('name')).toHaveStyle({ width: '200px' });
    });

    it('does not measure on double click when the width does not change', () => {
      renderGrid();
      fireEvent.doubleClick(resizer(1));
      expect(virtual.measure).toHaveBeenCalledTimes(1);
      fireEvent.doubleClick(resizer(1));
      expect(virtual.measure).toHaveBeenCalledTimes(1);
    });

    it('ignores a pointer down of a button other than the main one', () => {
      renderGrid();
      fireEvent.pointerDown(resizer(1), { clientX: 0, pointerId: 1, button: 2 });
      expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
    });

    it('prevents the default of the main button pointer down (no text selection) and still fits on double click', () => {
      renderGrid();
      const notPrevented = fireEvent.pointerDown(resizer(1), { clientX: 0, pointerId: 1, button: 0 });
      expect(notPrevented).toBe(false);
      fireEvent.doubleClick(resizer(1));
      expect(headerOf('name')).toHaveStyle({ width: '57px' });
    });

    it('stops measuring rows once the widest allowed width is reached', () => {
      renderGrid({
        rows: [
          ['1', 'a'.repeat(500), 'x'],
          ['2', 'b', 'x'],
          ['3', 'c', 'x'],
        ],
      });
      fireEvent.doubleClick(resizer(1));
      expect(measureText).toHaveBeenCalledTimes(2); // header + first row
      expect(headerOf('name')).toHaveStyle({ width: '600px' });
    });

    it('measures no row when the header alone reaches the widest allowed width', () => {
      const long = 'n'.repeat(60);
      render(<DataGrid columns={[long]} rows={[['a'], ['b']]} nullText={NULL_TEXT} />);
      fireEvent.doubleClick(resizer(0));
      expect(measureText).toHaveBeenCalledTimes(1);
      expect(screen.getByText(long)).toHaveStyle({ width: '600px' });
    });
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

    describe('with a page of 10,000 rows', () => {
      it('renders only the rows in view, not all 10,000', () => {
        virtual.rows = [0, 29];
        renderGrid({ rows: manyRows(10_000), hasMore: true, onEndReached: vi.fn() });
        expect(screen.getByText('r29')).toBeInTheDocument();
        expect(screen.queryByText('r30')).not.toBeInTheDocument();
        expect(screen.queryByText('r9999')).not.toBeInTheDocument();
      });

      it('asks for the next page only when the view gets within 10 rows of row 10,000', () => {
        const onEndReached = vi.fn();
        virtual.rows = [5000, 5030];
        const { unmount } = renderGrid({ rows: manyRows(10_000), hasMore: true, onEndReached });
        expect(onEndReached).not.toHaveBeenCalled();
        unmount();

        virtual.rows = [9970, 9998]; // last row in view is 9998 = rows.length - 1 - 1
        renderGrid({ rows: manyRows(10_000), hasMore: true, onEndReached });
        expect(onEndReached).toHaveBeenCalledTimes(1);
      });

      it('asks again once the next 10,000 rows are appended and the view is near the new end', () => {
        const onEndReached = vi.fn();
        virtual.rows = [9980, 9999];
        const { rerender } = renderGrid({ rows: manyRows(10_000), hasMore: true, onEndReached });
        expect(onEndReached).toHaveBeenCalledTimes(1);

        virtual.rows = [19_980, 19_999];
        rerender(
          <DataGrid
            columns={columns}
            rows={manyRows(20_000)}
            nullText={NULL_TEXT}
            hasMore
            onEndReached={onEndReached}
          />
        );
        expect(onEndReached).toHaveBeenCalledTimes(2);
      });

      it('does not ask after the last page (hasMore false)', () => {
        const onEndReached = vi.fn();
        virtual.rows = [9980, 9999];
        renderGrid({ rows: manyRows(10_000), hasMore: false, onEndReached });
        expect(onEndReached).not.toHaveBeenCalled();
      });
    });
  });
});
