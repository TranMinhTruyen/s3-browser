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

/** A cell being edited: `base` is its value before the edit (null = NULL), `start` the text the input opens with. */
type Editing = Cell & { base: string | null; start: string };

/** Translated texts of the editable grid. */
type GridEditLabels = {
  setNull: string;
  deleteRows: string;
  restoreRows: string;
  rowNew: string;
  rowEdited: string;
  rowDeleted: string;
};

/**
 * Turns on editing in `DataGrid`. Rows are numbered by the grid: the `newRows` first, then `rows`
 * (a loaded row `i` is grid row `newRows.length + i`). The grid never changes data itself, it reports through the
 * callbacks; `onSetCell` receives the value as text, `null` meaning SQL NULL.
 */
export type GridEdit = {
  newRows: (string | null)[][];
  /** Loaded row index -> (column index -> edited value). */
  edited: ReadonlyMap<number, ReadonlyMap<number, string | null>>;
  /** Loaded row indexes marked as deleted; they cannot be edited. */
  deleted: ReadonlySet<number>;
  labels: GridEditLabels;
  onSetCell: (row: number, col: number, value: string | null) => void;
  /** Sets the same value in every cell of `rows` x `cols` in one update (Ctrl+0, Delete, menu); skips deleted rows. */
  onSetCells: (rows: number[], cols: number[], value: string | null) => void;
  /** Called for the delete menu item: deletes the rows, or restores them when they are all deleted. */
  onToggleDeleteRows: (rows: number[]) => void;
  /** Selected grid rows, ascending (the row of the active cell unless whole rows are selected). Must be stable. */
  onSelectionChange: (rows: number[]) => void;
};

type Args = {
  edit?: GridEdit;
  /** Number of grid rows (new rows + loaded rows). */
  count: number;
  columnCount: number;
  getValue: (row: number, col: number) => string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Set to the cell being edited so the virtualizers keep it mounted when it scrolls out of view. */
  pinnedRef: RefObject<Cell | null>;
  selection: GridSelection;
};

/** Every grid row is a loaded row marked as deleted (so the delete action restores them instead). */
export const isAllDeletedLoaded = (gridRows: readonly number[], newCount: number, deleted: ReadonlySet<number>) =>
  gridRows.length > 0 && gridRows.every(row => row >= newCount && deleted.has(row - newCount));

/** In-place editing, fill actions (NULL, empty) and the edit items of the context menu of the editable `DataGrid`. */
export function useGridEdit({ edit, count, columnCount, getValue, scrollRef, pinnedRef, selection }: Args) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  // Enter/Esc/Tab close the editor, and removing the focused input may also fire a blur: only the first counts.
  const closed = useRef(true);
  // The user typed into the input (or opened it with a typed key): an empty text is then '' and not NULL.
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

  /** Saves `text` (when it differs from the old value) and closes the editor; `step` moves the cell, +-1 for Tab. */
  const closeEdit = useCallback(
    (text: string | null, step: number, refocus: boolean) => {
      const current = editingRef.current;
      if (!current || closed.current) return;
      closed.current = true;
      editingRef.current = null;
      pinnedRef.current = null;
      setEditing(null);
      // A NULL cell opened and closed untouched stays NULL; once typed in, an empty text is ''.
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

  /** Sets every selected cell (cell range, columns or rows) to `value` in one update. */
  const fillSelection = useCallback(
    (value: string | null) => {
      const target = getTarget();
      if (target) onSetCells?.(target.rows, target.cols, value);
    },
    [getTarget, onSetCells]
  );

  // A new row is selected and opened for editing; fewer new rows (deleted or rolled back) shift the row numbers.
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

  /** Keys that edit: F2, Ctrl+0 (NULL), Delete (empty), typing. Runs after the selection took the keys it handles. */
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
        // IME composition (ja, zh): open the input empty without cancelling the key, so the IME types into it.
        startEdit(cursor.row, cursor.col, '');
      } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Without this the key would also be typed into the input that opens now.
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

  // Focus with the caret at the end; stable so it only runs when the input mounts.
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
