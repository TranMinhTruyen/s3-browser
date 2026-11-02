import { describe, expect, it } from 'vitest';
import { tintedColor } from '@/common/theme/tintedColor';

describe('tintedColor', () => {
  it.each(['red', 'blue', 'teal'])('uses the scheme-aware light shade of %s as the color', name => {
    expect(tintedColor(name, 'ai').color).toBe(`var(--mantine-color-${name}-light-color)`);
  });

  it.each([
    ['ai', '--ai-bg', '--ai-hover'],
    ['button', '--button-bg', '--button-hover'],
  ] as const)('overrides the %s background and hover variables with a denser tint', (kind, bg, hover) => {
    const color = 'var(--mantine-color-red-light-color)';

    const { root } = tintedColor('red', kind).vars();

    expect(root).toEqual({
      [bg]: `color-mix(in srgb, ${color} 25%, transparent)`,
      [hover]: `color-mix(in srgb, ${color} 38%, transparent)`,
    });
  });

  it('does not set the variables of the other component', () => {
    expect(Object.keys(tintedColor('red', 'ai').vars().root)).toEqual(['--ai-bg', '--ai-hover']);
    expect(Object.keys(tintedColor('red', 'button').vars().root)).toEqual(['--button-bg', '--button-hover']);
  });

  it('returns the same values on every call of vars', () => {
    const tinted = tintedColor('green', 'button');
    expect(tinted.vars()).toEqual(tinted.vars());
  });
});
