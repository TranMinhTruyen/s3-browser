import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_COLOR,
  INFO_BG_COLOR,
  INFO_COLOR,
  WARNING_BG_COLOR,
  WARNING_COLOR,
} from '@/components/modals/modalColors';

describe('modalColors', () => {
  it.each([
    ['INFO_BG_COLOR', INFO_BG_COLOR],
    ['INFO_COLOR', INFO_COLOR],
    ['WARNING_BG_COLOR', WARNING_BG_COLOR],
    ['WARNING_COLOR', WARNING_COLOR],
  ])('%s follows the color scheme through light-dark()', (_name, value) => {
    expect(value).toMatch(/^light-dark\(#[0-9a-f]+, var\(--mantine-color-[a-z]+-\d\)\)$/i);
  });

  it('keeps the original light colors', () => {
    expect(INFO_BG_COLOR).toContain('#d0ebff');
    expect(WARNING_BG_COLOR).toContain('#f6ffd0');
  });

  it('uses a plain hex default profile color because it is stored as data', () => {
    expect(DEFAULT_PROFILE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
