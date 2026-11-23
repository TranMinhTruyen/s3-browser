import { useCallback, useMemo, useState } from 'react';
import { isAllDeletedLoaded } from '@/components/display/dataGrid/useGridEdit';

type Row = (string | null)[];

/** Pending changes of one table. Row numbers are indexes in the loaded `rows`, so they stay valid as pages load. */
type Edits = {
  /** Row index -> (column index -> new value). Only cells that differ from the loaded value are kept. */
  edited: ReadonlyMap<number, ReadonlyMap<number, string | null>>;
  /** Rows to insert, newest first: they are shown before the loaded rows. */
  newRows: Row[];
  /** Loaded rows to delete. */
  deleted: ReadonlySet<number>;
};

/** What a Commit has to send: enough to find each row by its primary key, or by every column when there is none. */
export type ChangeSet = {
  updates: { rowIndex: number; original: Row; changes: Record<string, string | null> }[];
  inserts: Row[];
  deletes: { rowIndex: number; original: Row }[];
};

const NO_EDITS: Edits = { edited: new Map(), newRows: [], deleted: new Set() };

/**
 * Uncommitted changes of the grid rows, kept next to the loaded rows (never copied into them: a table can have
 * 100,000+ rows). Grid rows are numbered `0..newRows.length-1` for new rows, then the loaded rows. A different
 * `resetKey` (another table) drops every change.
 */
export function useTableEdits(rows: Row[], columns: string[], resetKey: string) {
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [editsKey, setEditsKey] = useState(resetKey);
  // Safety net when the props change (another table): the grid of the old table never sees the new rows.
  if (editsKey !== resetKey) {
    setEditsKey(resetKey);
    setEdits(NO_EDITS);
  }

  const columnCount = columns.length;
  const addRow = useCallback(() => {
    setEdits(prev => ({
      ...prev,
      newRows: [Array.from<string | null>({ length: columnCount }).fill(null), ...prev.newRows],
    }));
  }, [columnCount]);

  /**
   * Sets every cell of `gridRows` x `cols` in one update; a value equal to the loaded one removes the change.
   * Deleted rows are read-only.
   */
  const setCells = useCallback(
    (gridRows: number[], cols: number[], value: string | null) => {
      setEdits(prev => {
        const newCount = prev.newRows.length;
        let newRows = prev.newRows;
        let edited = prev.edited as Map<number, ReadonlyMap<number, string | null>>;
        for (const row of gridRows) {
          if (row < newCount) {
            const next = newRows[row].slice();
            for (const col of cols) if (col < next.length) next[col] = value;
            if (next.every((v, i) => v === newRows[row][i])) continue;
            if (newRows === prev.newRows) newRows = prev.newRows.slice();
            newRows[row] = next;
            continue;
          }
          const index = row - newCount;
          if (!rows[index] || prev.deleted.has(index)) continue;
          const cells = new Map(edited.get(index));
          for (const col of cols) {
            if (col >= rows[index].length) continue;
            if (value === rows[index][col]) cells.delete(col);
            else cells.set(col, value);
          }
          const before = edited.get(index);
          if (cells.size === (before?.size ?? 0) && [...cells].every(([c, v]) => before?.get(c) === v)) continue;
          if (edited === prev.edited) edited = new Map(prev.edited);
          if (cells.size > 0) edited.set(index, cells);
          else edited.delete(index);
        }
        return newRows === prev.newRows && edited === prev.edited ? prev : { ...prev, newRows, edited };
      });
    },
    [rows]
  );

  /** Sets one cell of a grid row. */
  const setCell = useCallback(
    (row: number, col: number, value: string | null) => setCells([row], [col], value),
    [setCells]
  );

  /** Deletes the grid rows (new rows vanish); when every row is a deleted loaded row they are restored instead. */
  const toggleDeleteRows = useCallback((gridRows: number[]) => {
    setEdits(prev => {
      const newCount = prev.newRows.length;
      const removed = new Set(gridRows.filter(row => row < newCount));
      const indexes = gridRows.filter(row => row >= newCount).map(row => row - newCount);
      const restore = isAllDeletedLoaded(gridRows, newCount, prev.deleted);

      const deleted = new Set(prev.deleted);
      for (const index of indexes) {
        if (restore) deleted.delete(index);
        else deleted.add(index);
      }
      const newRows = removed.size > 0 ? prev.newRows.filter((_, i) => !removed.has(i)) : prev.newRows;
      return { ...prev, newRows, deleted };
    });
  }, []);

  const rollback = useCallback(() => setEdits(NO_EDITS), []);

  /** Rows with a pending change; an edited row that is also deleted counts once. */
  const changedCount = useMemo(() => {
    let count = edits.newRows.length + edits.deleted.size;
    for (const index of edits.edited.keys()) if (!edits.deleted.has(index)) count++;
    return count;
  }, [edits]);

  /** The pending changes in the shape a Commit needs (not used until the backend can commit). */
  const getChangeSet = useCallback((): ChangeSet => {
    const updates: ChangeSet['updates'] = [];
    for (const [rowIndex, cells] of edits.edited) {
      if (edits.deleted.has(rowIndex)) continue;
      const changes: Record<string, string | null> = {};
      for (const [col, value] of cells) changes[columns[col]] = value;
      updates.push({ rowIndex, original: rows[rowIndex], changes });
    }
    const deletes = [...edits.deleted].map(rowIndex => ({ rowIndex, original: rows[rowIndex] }));
    return { updates, inserts: edits.newRows, deletes };
  }, [edits, rows, columns]);

  return { edits, changedCount, addRow, setCell, setCells, toggleDeleteRows, rollback, getChangeSet };
}
