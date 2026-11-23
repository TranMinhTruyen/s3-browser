import type { SchemaTreeOutput, TableInfoOutput } from '@wails/S3Browser/models';

type DbSchema = SchemaTreeOutput['schemas'][number];
type TableIndex = TableInfoOutput['indexes'][number];
type TableForeignKey = TableInfoOutput['foreignKeys'][number];

// TODO(sprint PostgreSQL backend): remove this file. The object tree, table structure and rows of a PostgreSQL
// profile will come from the backend, like SQLite does through `utils/dbObjectSource.ts`.

/** Rows per mock page, the same as the backend page size. */
const MOCK_PAGE_SIZE = 10_000;

type MockColumn = { name: string; type: string; pk?: boolean; nullable?: boolean };

type MockTable = {
  columns: MockColumn[];
  rowCount: number;
  indexes?: TableIndex[];
  foreignKeys?: TableForeignKey[];
};

const WIDE_TYPES = ['integer', 'text', 'numeric', 'timestamp', 'boolean'];

const MOCK_TABLES: Record<string, MockTable> = {
  'public.users': {
    columns: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'name', type: 'text' },
      { name: 'email', type: 'text' },
      { name: 'created_at', type: 'timestamp' },
    ],
    rowCount: 120,
    indexes: [{ name: 'idx_users_email', unique: true, origin: 'c', partial: false, columns: ['email'] }],
  },
  'public.orders': {
    columns: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'user_id', type: 'integer' },
      { name: 'total', type: 'numeric' },
      { name: 'status', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamp' },
    ],
    rowCount: 450,
    indexes: [{ name: 'idx_orders_user', unique: false, origin: 'c', partial: false, columns: ['user_id'] }],
    foreignKeys: [
      {
        id: 0,
        columns: ['user_id'],
        refTable: 'users',
        refColumns: ['id'],
        onUpdate: 'NO ACTION',
        onDelete: 'CASCADE',
      },
    ],
  },
  // Many columns and many rows: to check the grid virtualizes both ways and loads more pages.
  'public.wide_events': {
    columns: Array.from({ length: 32 }, (_, i) =>
      i === 0
        ? { name: 'id', type: 'bigint', pk: true }
        : { name: `metric_${i}`, type: WIDE_TYPES[i % WIDE_TYPES.length], nullable: i % 3 === 0 }
    ),
    rowCount: 25_000,
  },
  // No primary key: covers the structure views and DDL of a table without one.
  'public.audit_log': {
    columns: [
      { name: 'actor', type: 'text' },
      { name: 'action', type: 'text' },
      { name: 'details', type: 'text', nullable: true },
      { name: 'logged_at', type: 'timestamp' },
    ],
    rowCount: 30,
    indexes: [{ name: 'idx_audit_log_actor', unique: false, origin: 'c', partial: false, columns: ['actor'] }],
  },
  'sales.invoices': {
    columns: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'order_id', type: 'integer' },
      { name: 'amount', type: 'numeric' },
      { name: 'issued_at', type: 'timestamp' },
    ],
    rowCount: 60,
    foreignKeys: [
      {
        id: 0,
        columns: ['order_id'],
        refTable: 'orders',
        refColumns: ['id'],
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
      },
    ],
  },
};

const MOCK_SCHEMAS: DbSchema[] = [
  {
    name: 'public',
    tables: ['audit_log', 'orders', 'users', 'wide_events'],
    views: ['active_users'],
    indexes: [
      { name: 'idx_audit_log_actor', table: 'audit_log' },
      { name: 'idx_orders_user', table: 'orders' },
      { name: 'idx_users_email', table: 'users' },
    ],
    triggers: [{ name: 'trg_users_touch', table: 'users' }],
  },
  { name: 'sales', tables: ['invoices'], views: [], indexes: [], triggers: [] },
];

/** The schemas of the mock PostgreSQL database. */
export const getMockSchemas = (): DbSchema[] => MOCK_SCHEMAS;

const cell = (column: MockColumn, row: number, index: number): string | null => {
  if (column.pk) return String(row + 1);
  if (column.nullable && (row + index) % 5 === 0) return null;
  switch (column.type) {
    case 'integer':
    case 'bigint':
      return String((row * 7 + index) % 10_000);
    case 'numeric':
      return (((row * 13 + index) % 100_000) / 100).toFixed(2);
    case 'boolean':
      return (row + index) % 2 === 0 ? 'true' : 'false';
    case 'timestamp':
      return new Date(Date.UTC(2026, 0, 1) + row * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    default:
      return `${column.name}_${row + 1}`;
  }
};

const toDdl = (name: string, table: MockTable): string => {
  const lines = table.columns.map(c => `  ${c.name} ${c.type}${c.pk || !c.nullable ? ' NOT NULL' : ''}`);
  const pk = table.columns.filter(c => c.pk).map(c => c.name);
  if (pk.length > 0) lines.push(`  PRIMARY KEY (${pk.join(', ')})`);
  return `CREATE TABLE ${name} (\n${lines.join(',\n')}\n);`;
};

/** Structure of a mock table; null when the table is unknown. */
export const getMockTableInfo = (schema: string, table: string): TableInfoOutput | null => {
  const name = `${schema}.${table}`;
  const mock = MOCK_TABLES[name];
  if (!mock) return null;

  const pk = mock.columns.filter(c => c.pk).map(c => c.name);
  return {
    columns: mock.columns.map((c, cid) => ({
      cid,
      name: c.name,
      type: c.type,
      notNull: !c.nullable,
      defaultValue: null,
      pk: c.pk ? 1 : 0,
    })),
    indexes: [
      ...(pk.length > 0 ? [{ name: `${table}_pkey`, unique: true, origin: 'pk', partial: false, columns: pk }] : []),
      ...(mock.indexes ?? []),
    ],
    constraints: pk.length > 0 ? [{ kind: 'PRIMARY KEY', name: `${table}_pkey`, columns: pk, expression: null }] : [],
    foreignKeys: mock.foreignKeys ?? [],
    ddl: toDdl(name, mock),
  };
};

/**
 * One page of mock rows starting at `offset` (every remaining row when `all`), built on demand (a table can have
 * tens of thousands of rows).
 */
export const getMockRows = (schema: string, table: string, offset: number, all = false) => {
  const mock = MOCK_TABLES[`${schema}.${table}`];
  if (!mock) return null;

  const end = all ? mock.rowCount : Math.min(offset + MOCK_PAGE_SIZE, mock.rowCount);
  const rows: (string | null)[][] = [];
  for (let row = offset; row < end; row++) rows.push(mock.columns.map((c, index) => cell(c, row, index)));
  return { columns: mock.columns.map(c => c.name), rows, done: end >= mock.rowCount };
};
