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
    expect(value).toMatch(/^light-dark\(var\(--mantine-color-[a-z]+-\d\), var\(--mantine-color-[a-z]+-\d\)\)$/);
  });

  it.each([
    ['INFO_BG_COLOR', INFO_BG_COLOR, 'var(--mantine-color-blue-1)'],
    ['INFO_COLOR', INFO_COLOR, 'var(--mantine-color-indigo-8)'],
    ['WARNING_BG_COLOR', WARNING_BG_COLOR, 'var(--mantine-color-lime-1)'],
    ['WARNING_COLOR', WARNING_COLOR, 'var(--mantine-color-yellow-6)'],
  ])('%s uses the theme variable as its light color', (_name, value, light) => {
    expect(value.startsWith(`light-dark(${light},`)).toBe(true);
  });

  it.each([INFO_BG_COLOR, INFO_COLOR, WARNING_BG_COLOR, WARNING_COLOR])('%s has no hard-coded hex or rgb', value => {
    expect(value).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it('uses a plain hex default profile color because it is stored as data', () => {
    expect(DEFAULT_PROFILE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
