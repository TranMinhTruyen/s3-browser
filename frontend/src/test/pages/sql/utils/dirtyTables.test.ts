import { describe, expect, it } from 'vitest';
import { isTableDirty, setTableDirty } from '@/pages/sql/utils/dirtyTables';

describe('dirtyTables', () => {
  it('is clean for a tab that was never marked', () => {
    expect(isTableDirty('never')).toBe(false);
  });

  it('marks and clears one tab without touching the others', () => {
    setTableDirty('a', true);
    setTableDirty('b', true);
    expect(isTableDirty('a')).toBe(true);
    setTableDirty('a', false);
    expect(isTableDirty('a')).toBe(false);
    expect(isTableDirty('b')).toBe(true);
    setTableDirty('b', false);
  });

  it('marking twice and clearing an unmarked tab are harmless', () => {
    setTableDirty('c', true);
    setTableDirty('c', true);
    setTableDirty('c', false);
    expect(isTableDirty('c')).toBe(false);
    expect(() => setTableDirty('c', false)).not.toThrow();
  });
});
