import { describe, expect, it } from 'vitest';
import { isAllDeletedLoaded } from '@/components/display/dataGrid/useGridEdit';

describe('isAllDeletedLoaded', () => {
  it.each([
    { name: 'no rows', rows: [], newCount: 0, deleted: [0], expected: false },
    { name: 'one deleted loaded row', rows: [0], newCount: 0, deleted: [0], expected: true },
    { name: 'one loaded row not deleted', rows: [1], newCount: 0, deleted: [0], expected: false },
    { name: 'all rows deleted', rows: [0, 1, 2], newCount: 0, deleted: [0, 1, 2], expected: true },
    { name: 'one of the rows not deleted', rows: [0, 1, 2], newCount: 0, deleted: [0, 2], expected: false },
    { name: 'new row only', rows: [0], newCount: 1, deleted: [0], expected: false },
    { name: 'new row mixed with a deleted loaded row', rows: [0, 1], newCount: 1, deleted: [0], expected: false },
    { name: 'grid row is offset by the new rows', rows: [2, 3], newCount: 2, deleted: [0, 1], expected: true },
    {
      name: 'deleted index equal to the grid row does not count',
      rows: [2],
      newCount: 2,
      deleted: [2],
      expected: false,
    },
    { name: 'nothing deleted', rows: [0], newCount: 0, deleted: [], expected: false },
  ])('$name', ({ rows, newCount, deleted, expected }) => {
    expect(isAllDeletedLoaded(rows, newCount, new Set(deleted))).toBe(expected);
  });
});
