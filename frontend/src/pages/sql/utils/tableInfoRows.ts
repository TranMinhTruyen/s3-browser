import type { TableInfoOutput } from '@wails/S3Browser/models';

type Row = (string | null)[];

/** Các hàng của bảng Column: tên, kiểu, cho phép null, giá trị mặc định, khóa chính. */
export const toColumnRows = (info: TableInfoOutput, yes: string, no: string): Row[] =>
  (info.columns ?? []).map(c => [c.name, c.type, c.notNull ? no : yes, c.defaultValue, c.pk > 0 ? yes : no]);

/** Các hàng của bảng Index: tên, duy nhất, nguồn gốc, một phần, các cột. */
export const toIndexRows = (info: TableInfoOutput, yes: string, no: string): Row[] =>
  (info.indexes ?? []).map(i => [i.name, i.unique ? yes : no, i.origin, i.partial ? yes : no, i.columns.join(', ')]);

/** Các hàng của bảng Constraint: loại, tên, cột, biểu thức (chỉ với CHECK). */
export const toConstraintRows = (info: TableInfoOutput): Row[] =>
  (info.constraints ?? []).map(c => [c.kind, c.name, c.columns.join(', '), c.expression]);

/** Các hàng của bảng FK: cột, bảng được tham chiếu, cột được tham chiếu, hành động khi cập nhật, khi xóa. */
export const toForeignKeyRows = (info: TableInfoOutput): Row[] =>
  (info.foreignKeys ?? []).map(f => [
    f.columns.join(', '),
    f.refTable,
    f.refColumns.join(', '),
    f.onUpdate,
    f.onDelete,
  ]);
