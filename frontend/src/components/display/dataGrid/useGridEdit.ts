import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type Cell, cellOf, type GridSelection } from '@/components/display/dataGrid/useGridSelection';

/** Ô đang được chỉnh sửa: `base` là giá trị trước khi sửa (null = NULL), `start` là nội dung ban đầu của input. */
type Editing = Cell & { base: string | null; start: string };

/** Các nội dung đã dịch của grid có thể chỉnh sửa. */
type GridEditLabels = {
  setNull: string;
  deleteRows: string;
  restoreRows: string;
  rowNew: string;
  rowEdited: string;
  rowDeleted: string;
};

/**
 * Bật chỉnh sửa trong `DataGrid`. Grid đánh số hàng: `newRows` trước, sau đó đến `rows`
 * (hàng đã tải có chỉ số `i` tương ứng hàng grid `newRows.length + i`). Grid không tự sửa dữ liệu mà báo qua callback;
 * `onSetCell` nhận giá trị dạng text, trong đó `null` nghĩa là SQL NULL.
 */
export type GridEdit = {
  newRows: (string | null)[][];
  /** Chỉ số hàng đã tải -> (chỉ số cột -> giá trị đã sửa). */
  edited: ReadonlyMap<number, ReadonlyMap<number, string | null>>;
  /** Chỉ số các hàng đã tải được đánh dấu đã xóa; không thể chỉnh sửa chúng. */
  deleted: ReadonlySet<number>;
  labels: GridEditLabels;
  onSetCell: (row: number, col: number, value: string | null) => void;
  /** Đặt cùng một giá trị cho mọi ô trong `rows` x `cols` bằng một lần cập nhật (Ctrl+0, Delete, menu); bỏ qua hàng đã xóa. */
  onSetCells: (rows: number[], cols: number[], value: string | null) => void;
  /** Được gọi cho mục xóa trong menu: xóa các hàng hoặc khôi phục nếu tất cả đều đã bị xóa. */
  onToggleDeleteRows: (rows: number[]) => void;
  /** Các hàng grid được chọn, theo thứ tự tăng dần (hàng của ô đang hoạt động nếu không chọn nguyên hàng). Phải ổn định. */
  onSelectionChange: (rows: number[]) => void;
};

type Args = {
  edit?: GridEdit;
  /** Số hàng trong grid (hàng mới + hàng đã tải). */
  count: number;
  columnCount: number;
  getValue: (row: number, col: number) => string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Đặt thành ô đang sửa để virtualizer giữ ô được mount khi cuộn ra ngoài vùng hiển thị. */
  pinnedRef: RefObject<Cell | null>;
  selection: GridSelection;
};

/** Mọi hàng grid đều là hàng đã tải và được đánh dấu xóa (nên thao tác xóa sẽ khôi phục chúng). */
export const isAllDeletedLoaded = (gridRows: readonly number[], newCount: number, deleted: ReadonlySet<number>) =>
  gridRows.length > 0 && gridRows.every(row => row >= newCount && deleted.has(row - newCount));

/** Chỉnh sửa tại chỗ, thao tác điền giá trị (NULL, rỗng) và các mục chỉnh sửa trong menu ngữ cảnh của `DataGrid`. */
export function useGridEdit({ edit, count, columnCount, getValue, scrollRef, pinnedRef, selection }: Args) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  // Enter/Esc/Tab đóng editor; xóa input đang focus cũng có thể phát blur nên chỉ xử lý sự kiện đầu tiên.
  const closed = useRef(true);
  // Người dùng đã nhập vào input (hoặc mở input bằng phím ký tự): lúc này nội dung rỗng là '' chứ không phải NULL.
  const touched = useRef(false);

  const newCount = edit?.newRows.length ?? 0;
  const deleted = edit?.deleted;
  const onSetCell = edit?.onSetCell;
  const onSetCells = edit?.onSetCells;
  const onToggleDeleteRows = edit?.onToggleDeleteRows;
  const onSelectionChange = edit?.onSelectionChange;
  const { selectedRows, setCursor, moveTo, clear, getTarget } = selection;
  const cursor = selection.sel.cursor;

  const isDeleted = useCallback(
    (row: number) => row >= newCount && !!deleted?.has(row - newCount),
    [newCount, deleted]
  );

  useEffect(() => {
    onSelectionChange?.(selectedRows);
  }, [onSelectionChange, selectedRows]);

  const startEdit = useCallback(
    (row: number, col: number, typed?: string) => {
      if (isDeleted(row)) return;
      const base = getValue(row, col);
      const next = { row, col, base, start: typed ?? base ?? '' };
      editingRef.current = next;
      pinnedRef.current = { row, col };
      touched.current = typed !== undefined;
      closed.current = false;
      setEditing(next);
      setCursor(row, col);
    },
    [isDeleted, getValue, pinnedRef, setCursor]
  );

  /** Lưu `text` nếu khác giá trị cũ rồi đóng editor; `step` di chuyển ô, +-1 khi dùng Tab. */
  const closeEdit = useCallback(
    (text: string | null, step: number, refocus: boolean) => {
      const current = editingRef.current;
      if (!current || closed.current) return;
      closed.current = true;
      editingRef.current = null;
      pinnedRef.current = null;
      setEditing(null);
      // Ô NULL được mở rồi đóng mà không sửa vẫn là NULL; nếu đã nhập thì nội dung rỗng là ''.
      const changed = current.base === null ? touched.current || text !== '' : text !== current.base;
      if (text !== null && changed) onSetCell?.(current.row, current.col, text);
      if (refocus) scrollRef.current?.focus({ preventScroll: true });
      if (step !== 0) {
        const at = Math.min(Math.max(current.row * columnCount + current.col + step, 0), count * columnCount - 1);
        moveTo(Math.floor(at / columnCount), at % columnCount);
      }
    },
    [onSetCell, scrollRef, columnCount, count, moveTo, pinnedRef]
  );

  /** Đặt mọi ô được chọn (vùng ô, cột hoặc hàng) thành `value` bằng một lần cập nhật. */
  const fillSelection = useCallback(
    (value: string | null) => {
      const target = getTarget();
      if (target) onSetCells?.(target.rows, target.cols, value);
    },
    [getTarget, onSetCells]
  );

  // Hàng mới được chọn và mở để chỉnh sửa; khi số hàng mới giảm (xóa hoặc rollback), chỉ số hàng sẽ dịch chuyển.
  const previousNew = useRef(newCount);
  useEffect(() => {
    const previous = previousNew.current;
    previousNew.current = newCount;
    if (newCount > previous) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        scrollRef.current.scrollLeft = 0;
      }
      startEdit(0, 0);
    } else if (newCount < previous) {
      clear();
    }
  }, [newCount, scrollRef, startEdit, clear]);

  /** Các phím chỉnh sửa: F2, Ctrl+0 (NULL), Delete (rỗng), nhập ký tự. Chạy sau khi bộ chọn xử lý các phím của nó. */
  const onKeyDownGrid = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!edit || e.target !== e.currentTarget || !cursor) return;
      const { key } = e;
      if (key === 'F2') {
        e.preventDefault();
        startEdit(cursor.row, cursor.col);
      } else if ((e.ctrlKey || e.metaKey) && key === '0') {
        e.preventDefault();
        fillSelection(null);
      } else if (key === 'Delete') {
        e.preventDefault();
        fillSelection('');
      } else if (key === 'Process') {
        // Soạn thảo bằng IME (ja, zh): mở input rỗng mà không hủy phím để IME nhập vào input.
        startEdit(cursor.row, cursor.col, '');
      } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Nếu thiếu thao tác này, phím sẽ đồng thời được nhập vào input vừa mở.
        e.preventDefault();
        startEdit(cursor.row, cursor.col, key);
      }
    },
    [edit, cursor, startEdit, fillSelection]
  );

  const onDoubleClickGrid = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const hit = edit && cellOf(e.target);
      const open = editingRef.current;
      if (!hit || hit.col < 0 || (open && hit.row === open.row && hit.col === open.col)) return;
      startEdit(hit.row, hit.col);
    },
    [edit, startEdit]
  );

  const onClickMenuNull = useCallback(() => fillSelection(null), [fillSelection]);

  const onClickMenuDelete = useCallback(() => onToggleDeleteRows?.(selectedRows), [onToggleDeleteRows, selectedRows]);

  const onKeyDownEditor = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        closeEdit(e.currentTarget.value, 0, true);
      } else if (e.key === 'Escape') {
        closeEdit(null, 0, true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeEdit(e.currentTarget.value, e.shiftKey ? -1 : 1, true);
      }
    },
    [closeEdit]
  );

  const onInputEditor = useCallback(() => {
    touched.current = true;
  }, []);

  const onBlurEditor = useCallback(
    (e: FocusEvent<HTMLInputElement>) => closeEdit(e.currentTarget.value, 0, false),
    [closeEdit]
  );

  // Focus input và đặt caret ở cuối; giữ ổn định để chỉ chạy khi input mount.
  const editorRef = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return {
    editing,
    onKeyDownGrid,
    onDoubleClickGrid,
    onClickMenuNull,
    onClickMenuDelete,
    onKeyDownEditor,
    onInputEditor,
    onBlurEditor,
    editorRef,
  };
}
