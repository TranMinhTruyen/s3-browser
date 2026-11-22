import type { TableInfoOutput } from '@wails/S3Browser/models';

type Row = (string | null)[];

/** Rows of the Column grid: name, type, nullable, default, primary key. */
export const toColumnRows = (info: TableInfoOutput, yes: string, no: string): Row[] =>
  (info.columns ?? []).map(c => [c.name, c.type, c.notNull ? no : yes, c.defaultValue, c.pk > 0 ? yes : no]);

/** Rows of the Index grid: name, unique, origin, partial, columns. */
export const toIndexRows = (info: TableInfoOutput, yes: string, no: string): Row[] =>
  (info.indexes ?? []).map(i => [i.name, i.unique ? yes : no, i.origin, i.partial ? yes : no, i.columns.join(', ')]);

/** Rows of the Constraint grid: kind, name, columns, expression (CHECK only). */
export const toConstraintRows = (info: TableInfoOutput): Row[] =>
  (info.constraints ?? []).map(c => [c.kind, c.name, c.columns.join(', '), c.expression]);

/** Rows of the FK grid: columns, referenced table, referenced columns, on update, on delete. */
export const toForeignKeyRows = (info: TableInfoOutput): Row[] =>
  (info.foreignKeys ?? []).map(f => [
    f.columns.join(', '),
    f.refTable,
    f.refColumns.join(', '),
    f.onUpdate,
    f.onDelete,
  ]);
