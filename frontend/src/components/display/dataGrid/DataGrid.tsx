import { Menu } from '@mantine/core';
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual';
import { Ban, ClipboardList, Copy, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import classes from '@/components/display/dataGrid/DataGrid.module.css';
import { type GridEdit, isAllDeletedLoaded, useGridEdit } from '@/components/display/dataGrid/useGridEdit';
import { type Cell, useGridSelection } from '@/components/display/dataGrid/useGridSelection';

// Sizes in px at the medium interface size (= the rem sizes in DataGrid.module.css x 16); scaled by `useUiScale`.
const ROW_HEIGHT = 32;
const COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 48;
const MAX_AUTO_WIDTH = 600;
/** Cell padding (2 x 0.5rem) + right border, px at the medium size. */
const CELL_EXTRA = 17;
const INDEX_WIDTH = 56;
const HEADER_HEIGHT = 32;
/** Start loading when the last rendered row is this close to the end of the loaded rows. */
const END_THRESHOLD = 10;
/** A cell never puts more characters than this in the DOM, so a huge value (hex BLOB) costs nothing to lay out. */
const MAX_CELL_CHARS = 200;
/** The native tooltip of a cell shows the value cut at this length. */
const MAX_TITLE_CHARS = 1000;

/** The part of a cell value that goes into the DOM. */
const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** The indexes of a virtualizer range plus the pinned one (kept ascending: the last one ends the range). */
const withPinned = (indexes: number[], pin: number | undefined) =>
  pin === undefined || indexes.includes(pin) ? indexes : [...indexes, pin].sort((a, b) => a - b);

/** The class names that are set, joined. */
const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** What a parent can ask of the grid through `ref`. */
export type DataGridHandle = {
  /** Sets every column to the width of its widest title or loaded value. */
  fitColumns: () => void;
};

type DataGridProps = {
  /** Handle of the grid (React 19: `ref` is a plain prop; the parent drives the grid without a re-render). */
  ref?: React.Ref<DataGridHandle>;
  columns: string[];
  rows: (string | null)[][];
  /** Text of a NULL cell (already translated). */
  nullText: string;
  /** More rows can be loaded with `onEndReached`. */
  hasMore?: boolean;
  /** A page is being loaded: `onEndReached` is not called. */
  loading?: boolean;
  /** Called once per `rows.length` when the end is near; must be stable. Not used to count pages. */
  onEndReached?: () => void;
  /** Translated texts of the Copy items of the context menu. */
  copyLabels: { copy: string; copyWithHeaders: string };
  /** Makes the grid editable (see `GridEdit`); without it the grid can still be selected and copied. */
  edit?: GridEdit;
};

/**
 * Grid with a row number column; cells, columns and rows can be selected and copied, and edited when `edit` is given. Rows and columns are both virtualized, so only
 * the cells in view exist.
 * Give it a `key` per result: it does not reset its "end reached" guard when the rows are replaced by others.
 */
function DataGrid(props: DataGridProps) {
  const { ref, columns, rows, nullText, hasMore = false, loading = false, onEndReached, copyLabels, edit } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestedAt = useRef(-1);
  const scale = useUiScale();
  // Widths changed by the user, in px at the medium size (x scale when used); the others use COLUMN_WIDTH.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const drag = useRef({ index: 0, startX: 0, startWidth: 0, width: 0, frame: 0 });

  // New rows of an editable grid come before the loaded rows.
  const newRows = edit?.newRows;
  const newCount = newRows?.length ?? 0;
  const edited = edit?.edited;
  const deleted = edit?.deleted;
  const labels = edit?.labels;

  // The cell being edited stays rendered (its input keeps focus and text) when scrolled out of the visible range.
  const pinnedRef = useRef<Cell | null>(null);
  const extractRows = useCallback(
    (range: Range) => withPinned(defaultRangeExtractor(range), pinnedRef.current?.row),
    []
  );
  const extractColumns = useCallback(
    (range: Range) => withPinned(defaultRangeExtractor(range), pinnedRef.current?.col),
    []
  );

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: newCount + rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT * scale,
    paddingStart: HEADER_HEIGHT * scale,
    scrollPaddingStart: HEADER_HEIGHT * scale,
    rangeExtractor: extractRows,
    overscan: 5,
  });
  // oxlint-disable-next-line react/incompatible-library
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (widths[i] ?? COLUMN_WIDTH) * scale,
    paddingStart: INDEX_WIDTH * scale,
    scrollPaddingStart: INDEX_WIDTH * scale,
    rangeExtractor: extractColumns,
    overscan: 2,
  });
  useRemeasureOnScale(rowVirtualizer, scale);
  useRemeasureOnScale(columnVirtualizer, scale);

  /** Value of a grid row: the new rows first, then the loaded rows with their pending edits applied. */
  const getValue = useCallback(
    (row: number, col: number): string | null => {
      if (newRows && row < newRows.length) return newRows[row][col];
      const index = row - newCount;
      const changes = edited?.get(index);
      return changes?.has(col) ? (changes.get(col) ?? null) : rows[index][col];
    },
    [newRows, newCount, edited, rows]
  );

  const scrollToCell = useCallback(
    (row: number, col: number) => {
      rowVirtualizer.scrollToIndex(row);
      columnVirtualizer.scrollToIndex(col);
    },
    [rowVirtualizer, columnVirtualizer]
  );

  const selection = useGridSelection({
    count: newCount + rows.length,
    columnCount: columns.length,
    columns,
    getValue,
    scrollRef,
    scrollToCell,
    insetX: INDEX_WIDTH * scale,
    insetY: HEADER_HEIGHT * scale,
  });
  const grid = useGridEdit({
    edit,
    count: newCount + rows.length,
    columnCount: columns.length,
    getValue,
    scrollRef,
    pinnedRef,
    selection,
  });
  const { sel, range, menuOpen, onChangeMenu } = selection;
  const { editing, editorRef, onKeyDownEditor, onInputEditor, onBlurEditor } = grid;

  // The selection takes its keys first; the rest (F2, typing...) go to the editor.
  const onKeyDownGrid = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selection.onKeyDownGrid(e)) grid.onKeyDownGrid(e);
    },
    [selection, grid]
  );

  // The menu is anchored to the mouse point, so it closes when the grid scrolls.
  const onScrollGrid = useCallback(() => {
    if (menuOpen) onChangeMenu(false);
  }, [menuOpen, onChangeMenu]);

  const onPointerDownResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection while dragging; click/dblclick still fire (not compatibility mouse events)
      const index = Number(e.currentTarget.dataset.index);
      const startWidth = widths[index] ?? COLUMN_WIDTH;
      drag.current = { index, startX: e.clientX, startWidth, width: startWidth, frame: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [widths]
  );

  const onPointerMoveResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const { clientX } = e;
      cancelAnimationFrame(drag.current.frame);
      // One update per frame at most.
      drag.current.frame = requestAnimationFrame(() => {
        const { index, startX, startWidth } = drag.current;
        const width = Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX) / scale);
        if (width === drag.current.width) return;
        drag.current.width = width;
        setWidths(prev => ({ ...prev, [index]: width }));
        // estimateSize reads `widths`: clearing the cache here lets the batched render measure with the new width.
        columnVirtualizer.measure();
      });
    },
    [scale, columnVirtualizer]
  );

  /**
   * Widths (px at the medium size) that fit the title and every loaded value of the given columns, measured with
   * one canvas context. A column stops at the first value that reaches the cap.
   * `byChar` sums cached per-character widths instead of measuring each value (about 25x faster on 10,000 rows x
   * 30 columns, ignores kerning); the exact path is for a single column.
   */
  const measureColumns = useCallback(
    (indexes: number[], styleOf: Element, byChar: boolean): Record<number, number> | null => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      const style = getComputedStyle(styleOf);
      const font = `${style.fontSize} ${style.fontFamily}`;
      const total = newCount + rows.length;
      // Text width that already gives the widest allowed column: no need to measure further.
      const cap = (MAX_AUTO_WIDTH - CELL_EXTRA) * scale;
      const bold = `600 ${font}`;
      const charWidths = new Map<number, number>();
      const textWidth = (text: string) => {
        if (!byChar) return ctx.measureText(text).width;
        let sum = 0;
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          let w = charWidths.get(code);
          if (w === undefined) {
            w = ctx.measureText(text[i]).width;
            charWidths.set(code, w);
          }
          sum += w;
        }
        return sum;
      };
      const result: Record<number, number> = {};
      for (const col of indexes) {
        ctx.font = bold;
        let max = ctx.measureText(columns[col]).width;
        ctx.font = font;
        for (let row = 0; row < total && max < cap; row++) {
          const value = getValue(row, col);
          if (value !== null) max = Math.max(max, textWidth(clip(value, MAX_CELL_CHARS)));
        }
        result[col] = Math.min(MAX_AUTO_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(max / scale) + CELL_EXTRA));
      }
      return result;
    },
    [columns, rows, newCount, scale, getValue]
  );

  const onDoubleClickResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      cancelAnimationFrame(drag.current.frame);
      const width = measureColumns([index], e.currentTarget, false)?.[index];
      if (width === undefined || width === (widths[index] ?? COLUMN_WIDTH)) return;
      setWidths(prev => ({ ...prev, [index]: width }));
      columnVirtualizer.measure();
    },
    [measureColumns, widths, columnVirtualizer]
  );

  useImperativeHandle(
    ref,
    () => ({
      fitColumns: () => {
        const el = scrollRef.current;
        const fitted =
          el &&
          measureColumns(
            columns.map((_, i) => i),
            el,
            true
          );
        if (!fitted) return;
        setWidths(fitted);
        columnVirtualizer.measure();
      },
    }),
    [measureColumns, columns, columnVirtualizer]
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const totalWidth = columnVirtualizer.getTotalSize();
  const lastIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

  // Rows can arrive in pages shorter than the page size, so "near the end" is judged on the loaded rows only.
  useEffect(() => {
    if (!hasMore || loading || lastIndex - newCount < rows.length - 1 - END_THRESHOLD) return;
    if (requestedAt.current === rows.length) return;
    requestedAt.current = rows.length;
    onEndReached?.();
  }, [hasMore, loading, lastIndex, newCount, rows.length, onEndReached]);

  const header = (
    <div className={classes.header} style={{ width: totalWidth }}>
      <div className={`${classes.index} ${classes.corner}`} />
      {virtualColumns.map(col => (
        <div
          key={col.key}
          data-hcol={col.index}
          className={join(classes.cell, sel.kind === 'col' && sel.cols.has(col.index) && classes.selected)}
          title={columns[col.index]}
          style={{ left: col.start, width: col.size }}
        >
          {columns[col.index]}
          <div
            className={classes.resizer}
            data-index={col.index}
            data-resizer
            onPointerDown={onPointerDownResize}
            onPointerMove={onPointerMoveResize}
            onDoubleClick={onDoubleClickResize}
          />
        </div>
      ))}
    </div>
  );

  /** Row with its state (new/edited/deleted), selection, active cell and cell editor. */
  const renderRow = useCallback(
    (d: number, key: React.Key, style: React.CSSProperties) => {
      const index = d - newCount;
      const isNew = d < newCount;
      const changes = isNew ? undefined : edited?.get(index);
      const state = isNew ? 'New' : deleted?.has(index) ? 'Deleted' : changes ? 'Edited' : undefined;
      const rowRange = range && d >= range.r1 && d <= range.r2 ? range : null;
      const cursorCol = sel.kind === 'cell' && sel.cursor?.row === d ? sel.cursor.col : -1;
      return (
        <div
          key={key}
          data-row={d}
          className={join(
            classes.row,
            state && classes[`row${state}`],
            sel.kind === 'row' && sel.rows.has(d) && classes.selected
          )}
          style={style}
        >
          <div
            data-col={-1}
            className={join(classes.index, state && classes[`index${state}`])}
            title={state ? labels?.[`row${state}`] : undefined}
          >
            {d + 1}
          </div>
          {virtualColumns.map(col => {
            const value = getValue(d, col.index);
            const cellStyle = { left: col.start, width: col.size };
            if (editing && editing.row === d && editing.col === col.index) {
              return (
                <div key={col.key} data-col={col.index} data-editing className={classes.cell} style={cellStyle}>
                  <input
                    ref={editorRef}
                    className={classes.editor}
                    defaultValue={editing.start}
                    spellCheck={false}
                    onKeyDown={onKeyDownEditor}
                    onInput={onInputEditor}
                    onBlur={onBlurEditor}
                  />
                </div>
              );
            }
            const tinted =
              sel.kind === 'col'
                ? sel.cols.has(col.index)
                : rowRange !== null && col.index >= rowRange.c1 && col.index <= rowRange.c2;
            return (
              <div
                key={col.key}
                data-col={col.index}
                className={join(
                  classes.cell,
                  value === null && classes.null,
                  cursorCol === col.index && classes.focused,
                  tinted && classes.selected,
                  changes?.has(col.index) && classes.cellEdited
                )}
                title={value === null ? undefined : clip(value, MAX_TITLE_CHARS)}
                style={cellStyle}
              >
                {value === null ? nullText : clip(value, MAX_CELL_CHARS)}
              </div>
            );
          })}
        </div>
      );
    },
    [
      newCount,
      edited,
      deleted,
      labels,
      sel,
      range,
      editing,
      virtualColumns,
      getValue,
      nullText,
      editorRef,
      onKeyDownEditor,
      onInputEditor,
      onBlurEditor,
    ]
  );

  const body = (
    <div
      ref={scrollRef}
      className={`${classes.root} ${classes.selectable}`}
      tabIndex={0}
      onKeyDown={onKeyDownGrid}
      onMouseDown={selection.onMouseDownGrid}
      onDoubleClick={edit ? grid.onDoubleClickGrid : undefined}
      onContextMenu={selection.onContextMenuGrid}
      onScroll={onScrollGrid}
    >
      <div className={classes.canvas} style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() }}>
        {header}
        {virtualRows.map(row =>
          renderRow(row.index, row.key, { width: totalWidth, transform: `translateY(${row.start}px)` })
        )}
      </div>
    </div>
  );

  // Every selected row is a deleted loaded row: the menu offers to restore them. Only computed while it is open.
  const restore = !!edit && menuOpen && isAllDeletedLoaded(selection.selectedRows, newCount, edit.deleted);
  return (
    <Menu width="12.5rem" opened={menuOpen} onChange={onChangeMenu}>
      <Menu.ContextMenu>{body}</Menu.ContextMenu>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Copy size="1rem" />} onClick={selection.onClickMenuCopy}>
          {copyLabels.copy}
        </Menu.Item>
        <Menu.Item leftSection={<ClipboardList size="1rem" />} onClick={selection.onClickMenuCopyWithHeaders}>
          {copyLabels.copyWithHeaders}
        </Menu.Item>
        {edit ? (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<Ban size="1rem" />} onClick={grid.onClickMenuNull}>
              {edit.labels.setNull}
            </Menu.Item>
            <Menu.Item
              leftSection={restore ? <RotateCcw size="1rem" /> : <Trash2 size="1rem" />}
              onClick={grid.onClickMenuDelete}
            >
              {restore ? edit.labels.restoreRows : edit.labels.deleteRows}
            </Menu.Item>
          </>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}
export default memo(DataGrid);
