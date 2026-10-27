import { describe, expect, it } from 'vitest';
import { formatDimension } from '@/common/utils/convertUtils';

describe('formatDimension', () => {
  it.each([
    ['100px', '100px'],
    ['50%', '50%'],
    ['auto', 'auto'],
    [12, '12px'],
  ])('%s -> %s', (input, expected) => {
    expect(formatDimension(input)).toBe(expected);
  });
});
