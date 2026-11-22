import { describe, expect, it } from 'vitest';
import { toColumnRows, toConstraintRows, toForeignKeyRows, toIndexRows } from '@/pages/sql/utils/tableInfoRows';

const info = {
  columns: [
    { cid: 0, name: 'id', type: 'INTEGER', notNull: true, defaultValue: null, pk: 1 },
    { cid: 1, name: 'name', type: 'TEXT', notNull: false, defaultValue: "'x'", pk: 0 },
  ],
  indexes: [
    { name: 'pk', unique: true, origin: 'pk', partial: false, columns: ['id'] },
    { name: 'ix', unique: false, origin: 'c', partial: true, columns: ['a', 'b'] },
  ],
  constraints: [
    { kind: 'PRIMARY KEY', name: 'pk', columns: ['id'], expression: null },
    { kind: 'CHECK', name: 'ck', columns: ['a', 'b'], expression: 'a > b' },
  ],
  foreignKeys: [
    { id: 0, columns: ['a', 'b'], refTable: 't', refColumns: ['x', 'y'], onUpdate: 'NO ACTION', onDelete: 'CASCADE' },
  ],
  ddl: '',
} as never;

describe('tableInfoRows', () => {
  it('maps columns with the translated yes/no', () => {
    expect(toColumnRows(info, 'Y', 'N')).toEqual([
      ['id', 'INTEGER', 'N', null, 'Y'],
      ['name', 'TEXT', 'Y', "'x'", 'N'],
    ]);
  });

  it('maps indexes and joins their columns', () => {
    expect(toIndexRows(info, 'Y', 'N')).toEqual([
      ['pk', 'Y', 'pk', 'N', 'id'],
      ['ix', 'N', 'c', 'Y', 'a, b'],
    ]);
  });

  it('maps constraints', () => {
    expect(toConstraintRows(info)).toEqual([
      ['PRIMARY KEY', 'pk', 'id', null],
      ['CHECK', 'ck', 'a, b', 'a > b'],
    ]);
  });

  it('maps foreign keys', () => {
    expect(toForeignKeyRows(info)).toEqual([['a, b', 't', 'x, y', 'NO ACTION', 'CASCADE']]);
  });

  it.each([
    ['columns', (i: never) => toColumnRows(i, 'Y', 'N')],
    ['indexes', (i: never) => toIndexRows(i, 'Y', 'N')],
    ['constraints', toConstraintRows],
    ['foreign keys', toForeignKeyRows],
  ])('returns no row when %s is missing', (_name, fn) => {
    expect(fn({} as never)).toEqual([]);
  });
});
