import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createUUID,
  formatFieldError,
  formatFileSize,
  formatString,
  formatStringJson,
  isNullOrEmpty,
} from '@/common/utils/stringUtils';

describe('isNullOrEmpty', () => {
  it.each([
    [null, true],
    [undefined, true],
    ['', true],
    ['a', false],
  ])('%s -> %s', (input, expected) => {
    expect(isNullOrEmpty(input)).toBe(expected);
  });
});

describe('formatString', () => {
  it('replaces indexed placeholders and keeps missing ones', () => {
    expect(formatString('{0} and {1} and {2} and {3}', 'a', 5, null)).toBe('a and 5 and {2} and {3}');
  });
});

describe('formatStringJson', () => {
  it('returns an empty string for an empty template', () => {
    expect(formatStringJson(undefined, { a: 1 })).toBe('');
    expect(formatStringJson('', null)).toBe('');
  });

  it('returns the template when there are no params', () => {
    expect(formatStringJson('hi {a}', null)).toBe('hi {a}');
    expect(formatStringJson('hi {a}')).toBe('hi {a}');
  });

  it('replaces flat and nested keys', () => {
    expect(formatStringJson('{a} {b.c} { b.c }', { a: 1, b: { c: 'x' } })).toBe('1 x x');
  });

  it('keeps the placeholder when the value is missing', () => {
    expect(formatStringJson('{a} {b.c.d} {z.y}', { a: null, b: { c: null } })).toBe('{a} {b.c.d} {z.y}');
  });
});

describe('formatFieldError', () => {
  it('uses the translation with label and params', () => {
    const t = ((key: string) => (key === 'V2' ? '{0} max {1} {2}' : key)) as never;
    expect(formatFieldError('V2:255,x', 'Name', t)).toBe('Name max 255 x');
  });

  it('falls back to the code when there are no params', () => {
    const t = ((key: string) => key) as never;
    expect(formatFieldError('plain', 'Name', t)).toBe('plain');
  });

  it('returns the raw error when the translation is not a string', () => {
    const t = (() => ({ nested: true })) as never;
    expect(formatFieldError('V1', 'Name', t)).toBe('V1');
  });

  it('defaults to the global i18n', () => {
    // The default namespace has no such key, so the code itself is the fallback template.
    expect(formatFieldError('{0}-{1}:5', 'Name')).toBe('Name-5');
  });
});

describe('createUUID', () => {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a v7 uuid without prefix', () => {
    expect(createUUID()).toMatch(new RegExp(`^${UUID}$`));
  });

  it('puts the prefix before the uuid', () => {
    expect(createUUID('tab')).toMatch(new RegExp(`^tab-${UUID}$`));
  });

  it('creates a different id each call', () => {
    expect(createUUID()).not.toBe(createUUID());
  });

  it('generates monotonically increasing ids', () => {
    const ids = Array.from({ length: 50 }, () => createUUID());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('encodes a timestamp not earlier than the time before the call', () => {
    const before = Date.now();
    const hex = createUUID().replace(/-/g, '');
    expect(Number.parseInt(hex.slice(0, 12), 16)).toBeGreaterThanOrEqual(before);
  });

  it('keeps the timestamp bits after the prefix', () => {
    const before = Date.now();
    const hex = createUUID('tab').slice('tab-'.length).replace(/-/g, '');
    expect(Number.parseInt(hex.slice(0, 12), 16)).toBeGreaterThanOrEqual(before);
  });
});

describe('formatFileSize', () => {
  it.each([
    [10, '10 bytes'],
    [2048, '2.00 KB'],
    [3 * 1024 * 1024, '3.00 MB'],
    [5 * 1024 * 1024 * 1024, '5.00 GB'],
  ])('%d -> %s', (input, expected) => {
    expect(formatFileSize(input)).toBe(expected);
  });
});
