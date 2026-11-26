import type { StatementResult } from '@wails/S3Browser/models';

/** Một câu SELECT hoàn chỉnh; ghi đè các trường để tạo loại câu lệnh khác. */
export const statement = (extra: Partial<StatementResult> = {}): StatementResult =>
  ({
    index: 0,
    sql: 'select 1',
    kind: 'rows',
    columns: [{ name: 'id', type: 'INTEGER' }],
    rows: [['1']],
    cursorId: null,
    done: true,
    truncated: false,
    rowsAffected: 0,
    elapsedMs: 3,
    error: null,
    ...extra,
  }) as StatementResult;
