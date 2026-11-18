import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import classes from '@/components/display/dataGrid/DataGrid.module.css';

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

type DataGridProps = {
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
};

/**
 * Read-only grid with a row number column. Rows and columns are both virtualized, so only the cells in view exist.
 * Give it a `key` per result: it does not reset its "end reached" guard when the rows are replaced by others.
 */
function DataGrid(props: DataGridProps) {
  const { columns, rows, nullText, hasMore = false, loading = false, onEndReached } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestedAt = useRef(-1);
  const scale = useUiScale();
  // Widths changed by the user, in px at the medium size (x scale when used); the others use COLUMN_WIDTH.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const drag = useRef({ index: 0, startX: 0, startWidth: 0, width: 0, frame: 0 });

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT * scale,
    paddingStart: HEADER_HEIGHT * scale,
    overscan: 5,
  });
  // oxlint-disable-next-line react/incompatible-library
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (widths[i] ?? COLUMN_WIDTH) * scale,
    paddingStart: INDEX_WIDTH * scale,
    overscan: 2,
  });
  useRemeasureOnScale(rowVirtualizer, scale);
  useRemeasureOnScale(columnVirtualizer, scale);

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

  const onDoubleClickResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const index = Number(e.currentTarget.dataset.index);
      cancelAnimationFrame(drag.current.frame);
      const style = getComputedStyle(e.currentTarget);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      const font = `${style.fontSize} ${style.fontFamily}`;
      ctx.font = `600 ${font}`;
      let max = ctx.measureText(columns[index]).width;
      ctx.font = font;
      // Text width that already gives the widest allowed column: no need to measure further.
      const cap = (MAX_AUTO_WIDTH - CELL_EXTRA) * scale;
      for (const row of rows) {
        if (max >= cap) break;
        const value = row[index];
        if (value !== null) max = Math.max(max, ctx.measureText(clip(value, MAX_CELL_CHARS)).width);
      }
      const width = Math.min(MAX_AUTO_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(max / scale) + CELL_EXTRA));
      if (width === (widths[index] ?? COLUMN_WIDTH)) return;
      setWidths(prev => ({ ...prev, [index]: width }));
      columnVirtualizer.measure();
    },
    [columns, rows, scale, widths, columnVirtualizer]
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const totalWidth = columnVirtualizer.getTotalSize();
  const lastIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

  // Rows can arrive in pages shorter than the page size, so "near the end" is judged on the loaded rows only.
  useEffect(() => {
    if (!hasMore || loading || lastIndex < rows.length - 1 - END_THRESHOLD) return;
    if (requestedAt.current === rows.length) return;
    requestedAt.current = rows.length;
    onEndReached?.();
  }, [hasMore, loading, lastIndex, rows.length, onEndReached]);

  return (
    <div ref={scrollRef} className={classes.root}>
      <div className={classes.canvas} style={{ width: totalWidth, height: rowVirtualizer.getTotalSize() }}>
        <div className={classes.header} style={{ width: totalWidth }}>
          <div className={`${classes.index} ${classes.corner}`} />
          {virtualColumns.map(col => (
            <div
              key={col.key}
              className={classes.cell}
              title={columns[col.index]}
              style={{ left: col.start, width: col.size }}
            >
              {columns[col.index]}
              <div
                className={classes.resizer}
                data-index={col.index}
                onPointerDown={onPointerDownResize}
                onPointerMove={onPointerMoveResize}
                onDoubleClick={onDoubleClickResize}
              />
            </div>
          ))}
        </div>

        {virtualRows.map(row => (
          <div
            key={row.key}
            className={classes.row}
            style={{ width: totalWidth, transform: `translateY(${row.start}px)` }}
          >
            <div className={classes.index}>{row.index + 1}</div>
            {virtualColumns.map(col => {
              const value = rows[row.index][col.index];
              return (
                <div
                  key={col.key}
                  className={value === null ? `${classes.cell} ${classes.null}` : classes.cell}
                  title={value === null ? undefined : clip(value, MAX_TITLE_CHARS)}
                  style={{ left: col.start, width: col.size }}
                >
                  {value === null ? nullText : clip(value, MAX_CELL_CHARS)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
export default memo(DataGrid);
