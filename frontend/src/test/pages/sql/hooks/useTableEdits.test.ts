import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableEdits } from '@/pages/sql/hooks/useTableEdits';

const COLUMNS = ['id', 'name'];
const ROWS: (string | null)[][] = [
  ['1', 'Ann'],
  ['2', null],
  ['3', 'Cat'],
];

const mount = (rows = ROWS, key = 'k1') =>
  renderHook(({ r, k }) => useTableEdits(r, COLUMNS, k), { initialProps: { r: rows, k: key } });

describe('useTableEdits', () => {
  it('starts without changes', () => {
    const { result } = mount();
    expect(result.current.changedCount).toBe(0);
    expect(result.current.edits.newRows).toEqual([]);
    expect(result.current.getChangeSet()).toEqual({ updates: [], inserts: [], deletes: [] });
  });

  describe('addRow', () => {
    it('adds an all-NULL row with one cell per column, newest first', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      expect(result.current.edits.newRows).toEqual([[null, null]]);
      act(() => result.current.setCell(0, 0, 'x'));
      act(() => result.current.addRow());
      expect(result.current.edits.newRows).toEqual([
        [null, null],
        ['x', null],
      ]);
      expect(result.current.changedCount).toBe(2);
    });
  });

  describe('setCell', () => {
    it('edits a new row and ignores a value equal to the current one', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.setCell(0, 1, 'v'));
      expect(result.current.edits.newRows[0]).toEqual([null, 'v']);
      const before = result.current.edits;
      act(() => result.current.setCell(0, 1, 'v'));
      expect(result.current.edits).toBe(before);
    });

    it('records an edit of a loaded row after the new rows (grid row = new rows + index)', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.setCell(2, 1, 'Zed'));
      expect(result.current.edits.edited.get(1)?.get(1)).toBe('Zed');
      expect(result.current.changedCount).toBe(2);
    });

    it('stores NULL as an edit when the loaded value is not NULL', () => {
      const { result } = mount();
      act(() => result.current.setCell(0, 1, null));
      expect(result.current.edits.edited.get(0)?.get(1)).toBeNull();
    });

    it('removes the mark when the value is set back to the loaded one, keeping other cells', () => {
      const { result } = mount();
      act(() => result.current.setCell(0, 0, '9'));
      act(() => result.current.setCell(0, 1, 'B'));
      act(() => result.current.setCell(0, 1, 'Ann'));
      expect(result.current.edits.edited.get(0)?.has(1)).toBe(false);
      expect(result.current.edits.edited.get(0)?.get(0)).toBe('9');
      act(() => result.current.setCell(0, 0, '1'));
      expect(result.current.edits.edited.has(0)).toBe(false);
      expect(result.current.changedCount).toBe(0);
    });

    it('treats a NULL loaded value as equal to NULL', () => {
      const { result } = mount();
      act(() => result.current.setCell(1, 1, 'x'));
      act(() => result.current.setCell(1, 1, null));
      expect(result.current.changedCount).toBe(0);
    });

    it('ignores a row or column that does not exist', () => {
      const { result } = mount();
      const before = result.current.edits;
      act(() => result.current.setCell(99, 0, 'x'));
      act(() => result.current.setCell(0, 99, 'x'));
      expect(result.current.edits).toBe(before);
    });

    it('does not edit a row that is marked as deleted', () => {
      const { result } = mount();
      act(() => result.current.toggleDeleteRows([0]));
      const before = result.current.edits;
      act(() => result.current.setCell(0, 1, 'x'));
      expect(result.current.edits).toBe(before);
    });
  });

  describe('setCells', () => {
    it('sets every cell of rows x columns in one update', () => {
      const { result } = mount();
      act(() => result.current.setCells([0, 2], [0, 1], 'z'));
      expect(result.current.edits.edited.get(0)).toEqual(
        new Map([
          [0, 'z'],
          [1, 'z'],
        ])
      );
      expect(result.current.edits.edited.get(2)?.get(1)).toBe('z');
      expect(result.current.edits.edited.has(1)).toBe(false);
      expect(result.current.changedCount).toBe(2);
    });

    it('fills with NULL, and drops the edit of a cell whose loaded value is already NULL', () => {
      const { result } = mount();
      act(() => result.current.setCells([0, 1], [1], null));
      expect(result.current.edits.edited.get(0)?.get(1)).toBeNull();
      expect(result.current.edits.edited.has(1)).toBe(false); // row 1 col 1 is NULL already
    });

    it('removes the edits that become equal to the loaded values and keeps the others', () => {
      const { result } = mount();
      act(() => result.current.setCells([0], [0, 1], 'q'));
      act(() => result.current.setCells([0], [1], 'Ann'));
      expect(result.current.edits.edited.get(0)).toEqual(new Map([[0, 'q']]));
      act(() => result.current.setCells([0], [0], '1'));
      expect(result.current.edits.edited.has(0)).toBe(false);
      expect(result.current.changedCount).toBe(0);
    });

    it('skips rows marked as deleted but still edits the others', () => {
      const { result } = mount();
      act(() => result.current.toggleDeleteRows([1]));
      act(() => result.current.setCells([0, 1, 2], [1], 'x'));
      expect(result.current.edits.edited.has(1)).toBe(false);
      expect(result.current.edits.edited.get(0)?.get(1)).toBe('x');
      expect(result.current.edits.edited.get(2)?.get(1)).toBe('x');
    });

    it('edits new rows (grid rows before the loaded ones) and shifts loaded rows by their count', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.addRow());
      act(() => result.current.setCells([0, 1, 2], [0], 'n'));
      expect(result.current.edits.newRows).toEqual([
        ['n', null],
        ['n', null],
      ]);
      expect(result.current.edits.edited.get(0)?.get(0)).toBe('n');
    });

    it('ignores columns and rows that do not exist', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      const before = result.current.edits;
      act(() => result.current.setCells([0, 99], [5], 'x'));
      expect(result.current.edits).toBe(before);
      act(() => result.current.setCells([99], [0], 'x'));
      expect(result.current.edits).toBe(before);
    });

    it('changes nothing, and returns the same state, when no cell would change', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.setCells([1], [0], 'new'));
      const before = result.current.edits;
      act(() => result.current.setCells([0], [0, 1], null)); // the new row is all NULL already
      act(() => result.current.setCells([1], [0], 'new')); // the same edit again
      act(() => result.current.setCells([], [0], 'x'));
      act(() => result.current.setCells([1], [], 'x'));
      expect(result.current.edits).toBe(before);
    });

    it('keeps the untouched rows by reference', () => {
      const { result } = mount();
      act(() => result.current.setCells([0], [0], 'a'));
      const row0 = result.current.edits.edited.get(0);
      act(() => result.current.setCells([2], [0], 'b'));
      expect(result.current.edits.edited.get(0)).toBe(row0);
    });

    it('works on a row loaded after the first edit (rows are read when the update runs)', () => {
      const { result, rerender } = mount();
      rerender({ r: [...ROWS, ['4', 'Dan']], k: 'k1' });
      act(() => result.current.setCells([3], [1], 'D'));
      expect(result.current.edits.edited.get(3)?.get(1)).toBe('D');
    });
  });

  describe('toggleDeleteRows', () => {
    it('marks loaded rows as deleted and restores them when all are deleted', () => {
      const { result } = mount();
      act(() => result.current.toggleDeleteRows([0, 2]));
      expect([...result.current.edits.deleted]).toEqual([0, 2]);
      expect(result.current.changedCount).toBe(2);
      act(() => result.current.toggleDeleteRows([0, 2]));
      expect(result.current.edits.deleted.size).toBe(0);
    });

    it('deletes again when only some of the rows are deleted', () => {
      const { result } = mount();
      act(() => result.current.toggleDeleteRows([0]));
      act(() => result.current.toggleDeleteRows([0, 1]));
      expect([...result.current.edits.deleted].sort()).toEqual([0, 1]);
    });

    it('drops new rows for good and shifts the other rows', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.addRow());
      act(() => result.current.setCell(1, 0, 'old'));
      act(() => result.current.toggleDeleteRows([0]));
      expect(result.current.edits.newRows).toEqual([['old', null]]);
      expect(result.current.edits.deleted.size).toBe(0);
    });

    it('deletes new rows and loaded rows together, never restoring them', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.toggleDeleteRows([0, 1]));
      expect(result.current.edits.newRows).toEqual([]);
      expect([...result.current.edits.deleted]).toEqual([0]);
    });

    it('does nothing for an empty selection', () => {
      const { result } = mount();
      act(() => result.current.toggleDeleteRows([]));
      expect(result.current.changedCount).toBe(0);
    });
  });

  it('counts an edited row that is also deleted once', () => {
    const { result } = mount();
    act(() => result.current.setCell(0, 1, 'x'));
    expect(result.current.changedCount).toBe(1);
    act(() => result.current.toggleDeleteRows([0]));
    expect(result.current.changedCount).toBe(1);
  });

  it('rollback drops every change', () => {
    const { result } = mount();
    act(() => result.current.addRow());
    act(() => result.current.setCell(1, 1, 'x'));
    act(() => result.current.toggleDeleteRows([2]));
    act(() => result.current.rollback());
    expect(result.current.changedCount).toBe(0);
    expect(result.current.edits.newRows).toEqual([]);
  });

  it('drops every change when resetKey changes, and keeps them when it does not', () => {
    const { result, rerender } = mount();
    act(() => result.current.addRow());
    rerender({ r: ROWS, k: 'k1' });
    expect(result.current.changedCount).toBe(1);
    rerender({ r: ROWS, k: 'k2' });
    expect(result.current.changedCount).toBe(0);
  });

  it('keeps the edits when more rows are loaded', () => {
    const { result, rerender } = mount();
    act(() => result.current.setCell(0, 1, 'x'));
    rerender({ r: [...ROWS, ['4', 'D']], k: 'k1' });
    expect(result.current.changedCount).toBe(1);
  });

  describe('getChangeSet', () => {
    it('lists updates by column name with the original row, inserts and deletes', () => {
      const { result } = mount();
      act(() => result.current.addRow());
      act(() => result.current.setCell(0, 0, '7'));
      act(() => result.current.setCell(1, 0, '10'));
      act(() => result.current.setCell(1, 1, null));
      act(() => result.current.toggleDeleteRows([3]));
      expect(result.current.getChangeSet()).toEqual({
        updates: [{ rowIndex: 0, original: ['1', 'Ann'], changes: { id: '10', name: null } }],
        inserts: [['7', null]],
        deletes: [{ rowIndex: 2, original: ['3', 'Cat'] }],
      });
    });

    it('skips the edits of a row that is deleted', () => {
      const { result } = mount();
      act(() => result.current.setCell(0, 1, 'x'));
      act(() => result.current.toggleDeleteRows([0]));
      const set = result.current.getChangeSet();
      expect(set.updates).toEqual([]);
      expect(set.deletes).toEqual([{ rowIndex: 0, original: ['1', 'Ann'] }]);
    });
  });
});
