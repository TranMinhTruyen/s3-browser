import { Menu } from '@mantine/core';
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual';
import { Ban, ClipboardList, Copy, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import classes from '@/components/display/dataGrid/DataGrid.module.css';
import { type GridEdit, isAllDeletedLoaded, useGridEdit } from '@/components/display/dataGrid/useGridEdit';
import { type Cell, useGridSelection } from '@/components/display/dataGrid/useGridSelection';

// Kích thước tính bằng px ở cỡ giao diện trung bình (= kích thước rem trong DataGrid.module.css nhân 16); được scale bằng `useUiScale`.
const ROW_HEIGHT = 32;
const COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 48;
const MAX_AUTO_WIDTH = 600;
/** Padding ô (2 x 0.5rem) + viền phải, tính bằng px ở cỡ trung bình. */
const CELL_EXTRA = 17;
const INDEX_WIDTH = 56;
const HEADER_HEIGHT = 32;
/** Bắt đầu tải khi hàng cuối đang hiển thị còn cách cuối danh sách đã tải khoảng này. */
const END_THRESHOLD = 10;
/** Mỗi ô chỉ đưa tối đa số ký tự này vào DOM, nhờ đó giá trị rất lớn (BLOB dạng hex) không làm tăng chi phí bố cục. */
const MAX_CELL_CHARS = 200;
/** Tooltip gốc của ô hiển thị giá trị đã cắt ở độ dài này. */
const MAX_TITLE_CHARS = 1000;

/** Phần giá trị ô được đưa vào DOM. */
const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** Các chỉ mục trong phạm vi virtualizer cùng chỉ mục được ghim (giữ thứ tự tăng dần: mục cuối cùng kết thúc phạm vi). */
const withPinned = (indexes: number[], pin: number | undefined) =>
  pin === undefined || indexes.includes(pin) ? indexes : [...indexes, pin].sort((a, b) => a - b);

/** Các tên class được nối lại thành chuỗi. */
const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** Các thao tác component cha có thể gọi trên grid thông qua `ref`. */
export type DataGridHandle = {
  /** Đặt độ rộng mỗi cột theo tiêu đề hoặc giá trị đã tải rộng nhất. */
  fitColumns: () => void;
};

type DataGridProps = {
  /** Tham chiếu đến grid (React 19: `ref` là prop thông thường; component cha điều khiển grid mà không cần render lại). */
  ref?: React.Ref<DataGridHandle>;
  columns: string[];
  rows: (string | null)[][];
  /** Nội dung hiển thị cho ô NULL (đã được dịch). */
  nullText: string;
  /** Có thể tải thêm hàng bằng `onEndReached`. */
  hasMore?: boolean;
  /** Đang tải một trang: không gọi `onEndReached`. */
  loading?: boolean;
  /** Được gọi một lần cho mỗi `rows.length` khi sắp đến cuối; hàm phải ổn định. Không dùng để đếm số trang. */
  onEndReached?: () => void;
  /** Nội dung đã dịch của các mục Copy trong menu ngữ cảnh. */
  copyLabels: { copy: string; copyWithHeaders: string };
  /** Cho phép chỉnh sửa grid (xem `GridEdit`); nếu tắt thì vẫn có thể chọn và sao chép nội dung. */
  edit?: GridEdit;
};

/**
 * Grid có cột số thứ tự; có thể chọn, sao chép ô/cột/hàng và chỉnh sửa nếu truyền `edit`. Hàng và cột đều được virtualize
 * nên chỉ các ô đang hiển thị mới tồn tại.
 * Cần truyền `key` riêng cho mỗi kết quả: grid không tự đặt lại cờ "đã đến cuối" khi thay toàn bộ hàng.
 */
function DataGrid(props: DataGridProps) {
  const { ref, columns, rows, nullText, hasMore = false, loading = false, onEndReached, copyLabels, edit } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestedAt = useRef(-1);
  const scale = useUiScale();
  // Độ rộng do người dùng thay đổi, tính bằng px ở cỡ trung bình (được nhân scale khi sử dụng); các cột khác dùng COLUMN_WIDTH.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const drag = useRef({ index: 0, startX: 0, startWidth: 0, width: 0, frame: 0 });

  // Hàng mới của grid có thể chỉnh sửa được đặt trước các hàng đã tải.
  const newRows = edit?.newRows;
  const newCount = newRows?.length ?? 0;
  const edited = edit?.edited;
  const deleted = edit?.deleted;
  const labels = edit?.labels;

  // Ô đang chỉnh sửa vẫn được render (input giữ focus và nội dung) khi bị cuộn ra ngoài vùng hiển thị.
  const pinnedRef = useRef<Cell | null>(null);
  const extractRows = useCallback(
    (range: Range) => withPinned(defaultRangeExtractor(range), pinnedRef.current?.row),
    []
  );
  const extractColumns = useCallback(
    (range: Range) => withPinned(defaultRangeExtractor(range), pinnedRef.current?.col),
    []
  );

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
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

  /** Giá trị của hàng grid: hàng mới trước, tiếp theo là hàng đã tải cùng các chỉnh sửa đang chờ áp dụng. */
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

  // Bộ chọn nhận key trước; các phím còn lại (F2, ký tự nhập...) được chuyển cho editor.
  const onKeyDownGrid = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selection.onKeyDownGrid(e)) grid.onKeyDownGrid(e);
    },
    [selection, grid]
  );

  // Menu neo tại vị trí con trỏ nên sẽ đóng khi grid cuộn.
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
      // Tối đa một lần cập nhật trong mỗi frame.
      drag.current.frame = requestAnimationFrame(() => {
        const { index, startX, startWidth } = drag.current;
        const width = Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX) / scale);
        if (width === drag.current.width) return;
        drag.current.width = width;
        setWidths(prev => ({ ...prev, [index]: width }));
        // estimateSize đọc `widths`; xóa cache tại đây để lần render theo lô đo lại bằng độ rộng mới.
        columnVirtualizer.measure();
      });
    },
    [scale, columnVirtualizer]
  );

  /**
   * Độ rộng (px ở cỡ trung bình) vừa với tiêu đề và mọi giá trị đã tải của các cột được chỉ định, đo bằng một canvas context.
   * Dừng đo một cột khi gặp giá trị đầu tiên chạm giới hạn.
   * `byChar` cộng độ rộng từng ký tự đã cache thay vì đo từng giá trị (nhanh hơn khoảng 25 lần với 10.000 hàng x
   * 30 cột, bỏ qua kerning); cách đo chính xác dành cho một cột đơn.
   */
  const measureColumns = useCallback(
    (indexes: number[], styleOf: Element, byChar: boolean): Record<number, number> | null => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      const style = getComputedStyle(styleOf);
      const font = `${style.fontSize} ${style.fontFamily}`;
      const total = newCount + rows.length;
      // Độ rộng văn bản này đã đạt độ rộng cột tối đa cho phép nên không cần đo tiếp.
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

  // Trang tải về có thể ít hàng hơn page size nên chỉ xác định "sắp đến cuối" dựa trên những hàng đã tải.
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

  /** Hàng cùng trạng thái (mới/đã sửa/đã xóa), lựa chọn, ô đang hoạt động và trình chỉnh sửa ô. */
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

  // Mọi hàng được chọn đều là hàng đã tải và đã xóa: menu cho phép khôi phục chúng. Chỉ tính khi menu đang mở.
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
