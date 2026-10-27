import { describe, expect, it } from 'vitest';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';

describe('modalColors', () => {
  it('exposes hex colors for the warning style', () => {
    expect(WARNING_BG_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(WARNING_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(WARNING_BG_COLOR).not.toBe(WARNING_COLOR);
  });
});
