import { useCallback, useMemo, useState } from 'react';
import { isAllDeletedLoaded } from '@/components/display/dataGrid/useGridEdit';

type Row = (string | null)[];

/** Các thay đổi đang chờ của một bảng. Số hàng là index trong `rows` đã tải nên vẫn hợp lệ khi tải thêm trang. */
type Edits = {
  /** Index hàng -> (index cột -> giá trị mới). Chỉ giữ các ô khác giá trị đã tải. */
  edited: ReadonlyMap<number, ReadonlyMap<number, string | null>>;
  /** Các hàng cần chèn, hàng mới nhất trước: chúng được hiển thị phía trên các hàng đã tải. */
  newRows: Row[];
  /** Các hàng đã tải cần xóa. */
  deleted: ReadonlySet<number>;
};

/** Dữ liệu Commit cần gửi: đủ để tìm từng hàng bằng khóa chính, hoặc bằng mọi cột nếu không có khóa chính. */
export type ChangeSet = {
  updates: { rowIndex: number; original: Row; changes: Record<string, string | null> }[];
  inserts: Row[];
  deletes: { rowIndex: number; original: Row }[];
};

const NO_EDITS: Edits = { edited: new Map(), newRows: [], deleted: new Set() };

/**
 * Các thay đổi chưa commit của hàng trong grid được lưu riêng bên cạnh dữ liệu đã tải (không sao chép vào đó vì bảng có thể
 * chứa hơn 100.000 hàng). Hàng mới được đánh số `0..newRows.length-1`, sau đó đến các hàng đã tải. `resetKey` khác
 * (bảng khác) sẽ xóa mọi thay đổi.
 */
export function useTableEdits(rows: Row[], columns: string[], resetKey: string) {
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [editsKey, setEditsKey] = useState(resetKey);
  // Bảo vệ khi props thay đổi (sang bảng khác): grid của bảng cũ không bao giờ nhận các hàng mới.
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
   * Cập nhật mọi ô trong `gridRows` x `cols` bằng một lần cập nhật; giá trị trùng với dữ liệu đã tải sẽ xóa thay đổi.
   * Các hàng đã xóa chỉ đọc.
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

  /** Đặt giá trị cho một ô của hàng trong grid. */
  const setCell = useCallback(
    (row: number, col: number, value: string | null) => setCells([row], [col], value),
    [setCells]
  );

  /** Xóa các hàng trong grid (hàng mới sẽ biến mất); nếu mọi hàng đều đã bị đánh dấu xóa thì khôi phục chúng. */
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

  /** Các hàng có thay đổi đang chờ; hàng vừa được sửa vừa bị xóa chỉ tính một lần. */
  const changedCount = useMemo(() => {
    let count = edits.newRows.length + edits.deleted.size;
    for (const index of edits.edited.keys()) if (!edits.deleted.has(index)) count++;
    return count;
  }, [edits]);

  /** Các thay đổi đang chờ theo cấu trúc Commit cần (chưa dùng cho đến khi backend hỗ trợ commit). */
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
