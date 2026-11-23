import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type Cell = { row: number; col: number };

/** What is selected: one rectangle of cells (a single cell is a rectangle of one), whole columns, or whole rows. */
type Sel = {
  kind: 'cell' | 'col' | 'row';
  /** The active cell: the moving end of the rectangle, the target of F2 and typing. */
  cursor: Cell | null;
  /** The fixed end of the rectangle (cell kind); the row/column Shift ranges start from here. */
  anchor: Cell | null;
  /** Selected columns (col kind). */
  cols: ReadonlySet<number>;
  /** Selected grid rows (row kind). */
  rows: ReadonlySet<number>;
};

/** The rectangle of a cell selection with more than one cell (inclusive bounds). */
export type GridRange = { r1: number; r2: number; c1: number; c2: number };

type Args = {
  /** Number of grid rows (new rows + loaded rows). */
  count: number;
  columnCount: number;
  columns: string[];
  getValue: (row: number, col: number) => string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollToCell: (row: number, col: number) => void;
  /** Width (px) of the sticky row number column and height (px) of the sticky header, to hit-test while dragging. */
  insetX: number;
  insetY: number;
};

const NONE: ReadonlySet<number> = new Set();
const EMPTY: Sel = { kind: 'cell', cursor: null, anchor: null, cols: NONE, rows: NONE };
const NO_ROWS: number[] = [];
/** Fastest auto scroll while dragging outside the grid, px per frame. */
const MAX_SCROLL_STEP = 40;
const NEEDS_QUOTE = /[\t\n\r"]/;

const single = (cell: Cell): Sel => ({ ...EMPTY, cursor: cell, anchor: cell });
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const seq = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sorted = (values: ReadonlySet<number>) => [...values].sort((a, b) => a - b);

/** Row and column of the grid cell an event came from; `col` is -1 for the row number cell. */
export const cellOf = (target: EventTarget | null): Cell | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-col]') : null;
  const rowEl = el?.closest<HTMLElement>('[data-row]');
  return el && rowEl ? { row: Number(rowEl.dataset.row), col: Number(el.dataset.col) } : null;
};

/** Column of the header cell an event came from. */
const headerColOf = (target: EventTarget): number | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-hcol]') : null;
  return el ? Number(el.dataset.hcol) : null;
};

/** How fast to scroll for a pointer at `p` when the visible band is `lo..hi`. */
const scrollStep = (p: number, lo: number, hi: number) =>
  p < lo
    ? -Math.min(MAX_SCROLL_STEP, Math.ceil((lo - p) / 4))
    : p > hi
      ? Math.min(MAX_SCROLL_STEP, Math.ceil((p - hi) / 4))
      : 0;

const quote = (value: string) => (NEEDS_QUOTE.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Cells as TSV (tab between columns, newline between rows) for Excel; NULL is an empty text. */
const toTsv = (
  rows: readonly number[],
  cols: readonly number[],
  columns: readonly string[],
  getValue: (row: number, col: number) => string | null,
  withHeaders: boolean
) => {
  const lines: string[] = [];
  if (withHeaders) lines.push(cols.map(col => quote(columns[col])).join('\t'));
  for (const row of rows) {
    const cells = Array.from<string>({ length: cols.length });
    for (let i = 0; i < cols.length; i++) {
      const value = getValue(row, cols[i]);
      cells[i] = value === null ? '' : quote(value);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
};

/**
 * Selection of `DataGrid` (read-only or editable): a rectangle of cells (click, Shift+click, drag, Shift+arrows), whole
 * columns (header click, Ctrl/Shift) or whole rows (row number click, Ctrl/Shift), copy, and the context menu state.
 */
export function useGridSelection({
  count,
  columnCount,
  columns,
  getValue,
  scrollRef,
  scrollToCell,
  insetX,
  insetY,
}: Args) {
  const [sel, setSel] = useState<Sel>(EMPTY);
  const [menuOpen, setMenuOpen] = useState(false);
  const stopDrag = useRef<(() => void) | null>(null);

  // The rows were replaced (another table): the selected cell may not exist any more.
  if (sel.cursor && (sel.cursor.row >= count || sel.cursor.col >= columnCount)) setSel(EMPTY);

  const range = useMemo((): GridRange | null => {
    const { kind, cursor: c, anchor: a } = sel;
    if (kind !== 'cell' || !c || !a || (c.row === a.row && c.col === a.col)) return null;
    return {
      r1: Math.min(a.row, c.row),
      r2: Math.max(a.row, c.row),
      c1: Math.min(a.col, c.col),
      c2: Math.max(a.col, c.col),
    };
  }, [sel]);

  const cursorRow = sel.cursor?.row ?? -1;
  /** Selected grid rows, ascending: the selected rows, else the row of the active cell. */
  const selectedRows = useMemo(
    () => (sel.kind === 'row' ? sorted(sel.rows) : sel.kind === 'cell' && cursorRow >= 0 ? [cursorRow] : NO_ROWS),
    [sel.kind, sel.rows, cursorRow]
  );

  const clear = useCallback(() => setSel(EMPTY), []);

  /** Selects one cell without scrolling (the cell is already in view). */
  const setCursor = useCallback((row: number, col: number) => setSel(single({ row, col })), []);

  const moveTo = useCallback(
    (row: number, col: number) => {
      const next = { row: clamp(row, 0, count - 1), col: clamp(col, 0, columnCount - 1) };
      setSel(single(next));
      scrollToCell(next.row, next.col);
    },
    [count, columnCount, scrollToCell]
  );

  /** The rows and columns (ascending) the selection covers, or null when nothing is selected. */
  const getTarget = useCallback((): { rows: number[]; cols: number[] } | null => {
    const { kind, cursor, rows, cols } = sel;
    if (!cursor) return null;
    if (kind === 'row') return { rows: sorted(rows), cols: seq(0, columnCount - 1) };
    if (kind === 'col') return { rows: seq(0, count - 1), cols: sorted(cols) };
    return range
      ? { rows: seq(range.r1, range.r2), cols: seq(range.c1, range.c2) }
      : { rows: [cursor.row], cols: [cursor.col] };
  }, [sel, range, count, columnCount]);

  const copy = useCallback(
    (withHeaders: boolean) => {
      const target = getTarget();
      if (!target) return;
      navigator.clipboard?.writeText(toTsv(target.rows, target.cols, columns, getValue, withHeaders)).catch(() => {});
    },
    [getTarget, columns, getValue]
  );

  const selectColumn = useCallback((col: number, shift: boolean, mod: boolean) => {
    setSel(prev => {
      const cursor = { row: prev.cursor?.row ?? 0, col };
      if (shift) {
        const from = prev.kind === 'col' && prev.anchor ? prev.anchor.col : (prev.cursor?.col ?? col);
        return {
          kind: 'col',
          cursor,
          anchor: { row: cursor.row, col: from },
          rows: NONE,
          cols: new Set(seq(Math.min(from, col), Math.max(from, col))),
        };
      }
      const cols = new Set(mod && prev.kind === 'col' ? prev.cols : []);
      if (!(mod && cols.delete(col))) cols.add(col);
      return cols.size > 0 ? { kind: 'col', cursor, anchor: cursor, rows: NONE, cols } : EMPTY;
    });
  }, []);

  const selectRow = useCallback((row: number, shift: boolean, mod: boolean) => {
    setSel(prev => {
      const cursor = { row, col: prev.cursor?.col ?? 0 };
      if (shift) {
        const anchor = prev.kind === 'col' || !prev.anchor ? cursor : prev.anchor;
        const rows = new Set(seq(Math.min(anchor.row, row), Math.max(anchor.row, row)));
        return { kind: 'row', cursor, anchor, rows, cols: NONE };
      }
      const rows = new Set(mod ? (prev.kind === 'row' ? prev.rows : prev.cursor ? [prev.cursor.row] : []) : []);
      if (!(mod && rows.delete(row))) rows.add(row);
      // Toggling off the last selected row leaves nothing selected.
      return rows.size > 0 ? { kind: 'row', cursor, anchor: cursor, rows, cols: NONE } : EMPTY;
    });
  }, []);

  /** Extends the rectangle to the cell under the pointer until the button is released; scrolls at the edges. */
  const startDrag = useCallback(
    (x: number, y: number) => {
      let pointer = { x, y };
      let frame = 0;
      const onMove = (ev: globalThis.MouseEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', stop);
        stopDrag.current = null;
      };
      const tick = () => {
        const el = scrollRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const left = rect.left + insetX;
          const top = rect.top + insetY;
          const right = rect.left + el.clientWidth;
          const bottom = rect.top + el.clientHeight;
          el.scrollLeft += scrollStep(pointer.x, left, right);
          el.scrollTop += scrollStep(pointer.y, top, bottom);
          const hit = cellOf(
            document.elementFromPoint?.(clamp(pointer.x, left + 1, right - 1), clamp(pointer.y, top + 1, bottom - 1)) ??
              null
          );
          if (hit && hit.col >= 0) {
            setSel(prev =>
              prev.kind !== 'cell' || (prev.cursor?.row === hit.row && prev.cursor.col === hit.col)
                ? prev
                : { ...prev, cursor: hit }
            );
          }
        }
        frame = requestAnimationFrame(tick);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', stop);
      stopDrag.current = stop;
      frame = requestAnimationFrame(tick);
    },
    [scrollRef, insetX, insetY]
  );
  useEffect(() => () => stopDrag.current?.(), []);

  const onMouseDownGrid = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const { target, shiftKey } = e;
      if (e.button !== 0 || (target instanceof Element && target.closest('[data-editing],[data-resizer]'))) return;
      const mod = e.ctrlKey || e.metaKey;
      const col = headerColOf(target);
      if (col !== null) {
        selectColumn(col, shiftKey, mod);
        return;
      }
      const hit = cellOf(target);
      if (!hit) return;
      if (hit.col < 0) {
        selectRow(hit.row, shiftKey, mod);
        return;
      }
      stopDrag.current?.();
      setSel(prev => ({ ...single(hit), anchor: shiftKey ? (prev.anchor ?? hit) : hit }));
      startDrag(e.clientX, e.clientY);
    },
    [selectColumn, selectRow, startDrag]
  );

  /** Arrows (Shift extends the rectangle) and Ctrl/Cmd+C. Returns true when the key was handled. */
  const onKeyDownGrid = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): boolean => {
      if (e.target !== e.currentTarget || count === 0) return false;
      const { key, shiftKey } = e;
      if (key.startsWith('Arrow')) {
        e.preventDefault();
        const dRow = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
        const dCol = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
        const { cursor } = sel;
        // The first arrow press only selects the first cell.
        if (!cursor) moveTo(0, 0);
        else if (!shiftKey) moveTo(cursor.row + dRow, cursor.col + dCol);
        else {
          const next = {
            row: clamp(cursor.row + dRow, 0, count - 1),
            col: clamp(cursor.col + dCol, 0, columnCount - 1),
          };
          setSel(prev => ({ ...single(next), anchor: prev.kind === 'cell' ? (prev.anchor ?? cursor) : cursor }));
          scrollToCell(next.row, next.col);
        }
        return true;
      }
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'c' && sel.cursor) {
        e.preventDefault();
        copy(false);
        return true;
      }
      return false;
    },
    [count, columnCount, sel, moveTo, scrollToCell, copy]
  );

  const onContextMenuGrid = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const hit = cellOf(e.target);
      if (!hit || hit.col < 0) {
        e.preventDefault(); // no menu outside the cells
        return;
      }
      // Right click inside the selection keeps it; anywhere else it selects the cell under the pointer.
      const inside =
        sel.kind === 'row'
          ? sel.rows.has(hit.row)
          : sel.kind === 'col'
            ? sel.cols.has(hit.col)
            : range
              ? hit.row >= range.r1 && hit.row <= range.r2 && hit.col >= range.c1 && hit.col <= range.c2
              : sel.cursor?.row === hit.row && sel.cursor.col === hit.col;
      if (!inside) setSel(single(hit));
      setMenuOpen(true);
    },
    [sel, range]
  );

  const onChangeMenu = useCallback((opened: boolean) => setMenuOpen(opened), []);
  const onClickMenuCopy = useCallback(() => copy(false), [copy]);
  const onClickMenuCopyWithHeaders = useCallback(() => copy(true), [copy]);

  return {
    sel,
    range,
    selectedRows,
    menuOpen,
    clear,
    setCursor,
    moveTo,
    getTarget,
    onMouseDownGrid,
    onKeyDownGrid,
    onContextMenuGrid,
    onChangeMenu,
    onClickMenuCopy,
    onClickMenuCopyWithHeaders,
  };
}

export type GridSelection = ReturnType<typeof useGridSelection>;
