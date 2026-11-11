import type { SQLNamespace } from '@codemirror/lang-sql';

// TODO(sprint backend DB): remove this file. The schema (tables, columns) will be read from the connected
// database by the Go backend instead of this static sample.
const SAMPLE_SCHEMA: SQLNamespace = {
  users: ['id', 'name', 'email', 'created_at'],
  orders: ['id', 'user_id', 'total', 'status', 'created_at'],
  products: ['id', 'name', 'price', 'stock'],
};

// profileId -> schema. 'mock-sqlite-local' has a smaller one; unknown profiles have none.
const MOCK_DB_SCHEMAS: Record<string, SQLNamespace> = {
  'mock-pg-local': SAMPLE_SCHEMA,
  'mock-pg-staging': SAMPLE_SCHEMA,
  'mock-sqlite-local': { users: ['id', 'name', 'email'], notes: ['id', 'user_id', 'body'] },
};

/** Schema for autocomplete of a profile; undefined when no profile is chosen or it has no schema. */
export const getMockSchema = (profileId: string | null): SQLNamespace | undefined =>
  profileId ? MOCK_DB_SCHEMAS[profileId] : undefined;
