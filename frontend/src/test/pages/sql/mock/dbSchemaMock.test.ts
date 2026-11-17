import { describe, expect, it } from 'vitest';
import { getMockSchema } from '@/pages/sql/mock/dbSchemaMock';

describe('getMockSchema', () => {
  it('returns the sample schema (tables with their columns) for PostgreSQL', () => {
    const schema = getMockSchema('postgres');
    expect(Object.keys(schema as object)).toEqual(['users', 'orders', 'products']);
    expect((schema as Record<string, string[]>).users).toContain('email');
  });

  it('returns the same object on every call', () => {
    expect(getMockSchema('postgres')).toBe(getMockSchema('postgres'));
  });

  it.each([['sqlite'], [null], ['postgresql'], ['']])('returns no schema for %j', provider => {
    expect(getMockSchema(provider)).toBeUndefined();
  });
});
