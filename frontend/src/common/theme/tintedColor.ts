const BG_PERCENT = 25;
const HOVER_PERCENT = 38;

const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Props for a Mantine `light` ActionIcon/Button in a theme color, with a denser background than Mantine's fixed
 * 10% tint (too pale on the title bar). Only theme variables are used: `-light-color` is the scheme-aware shade
 * (darker in light theme, lighter in dark theme), so one value works for both.
 *
 * @param name - Mantine color name, e.g. `red`.
 * @param component - CSS variable prefix of the component: `ai` (ActionIcon) or `button`.
 */
export const tintedColor = (name: string, component: 'ai' | 'button') => {
  const color = `var(--mantine-color-${name}-light-color)`;
  return {
    color,
    vars: () => ({
      root: { [`--${component}-bg`]: mix(color, BG_PERCENT), [`--${component}-hover`]: mix(color, HOVER_PERCENT) },
    }),
  };
};
