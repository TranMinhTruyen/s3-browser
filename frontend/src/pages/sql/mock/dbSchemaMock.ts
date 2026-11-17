import type { SQLNamespace } from '@codemirror/lang-sql';

// TODO(sprint backend DB): remove this file. The schema (tables, columns) will be read from the connected
// database by the Go backend instead of this static sample.
const SAMPLE_SCHEMA: SQLNamespace = {
  users: ['id', 'name', 'email', 'created_at'],
  orders: ['id', 'user_id', 'total', 'status', 'created_at'],
  products: ['id', 'name', 'price', 'stock'],
};

/** Schema for autocomplete of a profile by provider; only PostgreSQL has one for now. */
export const getMockSchema = (provider: string | null): SQLNamespace | undefined =>
  provider === 'postgres' ? SAMPLE_SCHEMA : undefined;
