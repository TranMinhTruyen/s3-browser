import { describe, expect, it } from 'vitest';
import { getMockRows, getMockSchemas, getMockTableInfo } from '@/pages/sql/mock/dbObjectMock';

describe('getMockSchemas', () => {
  it('lists the public and sales schemas with their objects', () => {
    const schemas = getMockSchemas();
    expect(schemas.map(s => s.name)).toEqual(['public', 'sales']);
    expect(schemas[0].tables).toEqual(['audit_log', 'orders', 'users', 'wide_events']);
    expect(schemas[0].views).toEqual(['active_users']);
    expect(schemas[1].tables).toEqual(['invoices']);
  });
});

describe('getMockTableInfo', () => {
  it('returns null for an unknown table', () => {
    expect(getMockTableInfo('public', 'nope')).toBeNull();
  });

  it('describes a table with a primary key, an index and the DDL', () => {
    const info = getMockTableInfo('public', 'users');
    expect(info?.columns.map(c => [c.name, c.type, c.notNull, c.pk])).toEqual([
      ['id', 'integer', true, 1],
      ['name', 'text', true, 0],
      ['email', 'text', true, 0],
      ['created_at', 'timestamp', true, 0],
    ]);
    expect(info?.indexes.map(i => i.name)).toEqual(['users_pkey', 'idx_users_email']);
    expect(info?.constraints).toEqual([{ kind: 'PRIMARY KEY', name: 'users_pkey', columns: ['id'], expression: null }]);
    expect(info?.foreignKeys).toEqual([]);
    expect(info?.ddl).toContain('CREATE TABLE public.users (');
    expect(info?.ddl).toContain('PRIMARY KEY (id)');
  });

  it('returns foreign keys and nullable columns', () => {
    const info = getMockTableInfo('public', 'orders');
    expect(info?.foreignKeys[0]).toMatchObject({ columns: ['user_id'], refTable: 'users', onDelete: 'CASCADE' });
    expect(info?.columns.find(c => c.name === 'status')?.notNull).toBe(false);
    expect(info?.ddl).toContain('  status text,');
  });

  it('describes the table without a primary key: no pkey index, no constraint, one plain index', () => {
    const info = getMockTableInfo('public', 'audit_log');
    expect(info?.columns.map(c => [c.name, c.pk])).toEqual([
      ['actor', 0],
      ['action', 0],
      ['details', 0],
      ['logged_at', 0],
    ]);
    expect(info?.columns.find(c => c.name === 'details')?.notNull).toBe(false);
    expect(info?.indexes.map(i => i.name)).toEqual(['idx_audit_log_actor']);
    expect(info?.indexes.some(i => i.name.endsWith('_pkey'))).toBe(false);
    expect(info?.indexes[0].unique).toBe(false);
    expect(info?.constraints).toEqual([]);
    expect(info?.foreignKeys).toEqual([]);
    expect(info?.ddl).toContain('CREATE TABLE public.audit_log (');
    expect(info?.ddl).not.toContain('PRIMARY KEY');
  });

  it('has at least 30 columns in the wide table and no secondary index', () => {
    const info = getMockTableInfo('public', 'wide_events');
    expect(info?.columns.length).toBeGreaterThanOrEqual(30);
    expect(info?.indexes.map(i => i.name)).toEqual(['wide_events_pkey']);
  });
});

describe('getMockRows', () => {
  it('returns null for an unknown table', () => {
    expect(getMockRows('public', 'nope', 0)).toBeNull();
  });

  it('returns a short table in one finished page', () => {
    const page = getMockRows('public', 'users', 0);
    expect(page?.columns).toEqual(['id', 'name', 'email', 'created_at']);
    expect(page?.rows).toHaveLength(120);
    expect(page?.done).toBe(true);
    expect(page?.rows[0]).toEqual(['1', 'name_1', 'email_1', '2026-01-01 00:00:00']);
    expect(page?.rows[1][3]).toBe('2026-01-01 00:01:00');
  });

  it('returns the 30 rows of the table without a primary key in one finished page', () => {
    const page = getMockRows('public', 'audit_log', 0);
    expect(page?.columns).toEqual(['actor', 'action', 'details', 'logged_at']);
    expect(page?.rows).toHaveLength(30);
    expect(page?.done).toBe(true);
  });

  it('builds numeric, null and text cells', () => {
    const page = getMockRows('public', 'orders', 0);
    expect(page?.rows[0][1]).toBe('1'); // integer: (0 * 7 + 1) % 10000
    expect(page?.rows[0][2]).toBe('0.02'); // numeric: ((0 * 13 + 2) % 100000) / 100
    expect(page?.rows[0][3]).toBe('status_1');
    expect(page?.rows[2][3]).toBeNull(); // nullable column: (row + index) % 5 === 0 for row 2, index 3
  });

  it('pages the wide table 10,000 rows at a time and marks the last page done', () => {
    const first = getMockRows('public', 'wide_events', 0);
    const second = getMockRows('public', 'wide_events', 10_000);
    const third = getMockRows('public', 'wide_events', 20_000);
    expect([first?.rows.length, second?.rows.length, third?.rows.length]).toEqual([10_000, 10_000, 5_000]);
    expect([first?.done, second?.done, third?.done]).toEqual([false, false, true]);
    expect(third?.rows[0][0]).toBe('20001');
  });

  it('covers boolean and bigint cells of the wide table', () => {
    const page = getMockRows('public', 'wide_events', 0);
    const values = page?.rows[0] ?? [];
    expect(values.some(v => v === 'true' || v === 'false')).toBe(true);
    expect(values[0]).toBe('1');
  });
});
