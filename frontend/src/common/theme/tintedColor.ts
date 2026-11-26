const BG_PERCENT = 25;
const HOVER_PERCENT = 38;

const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Props cho ActionIcon/Button biến thể `light` của Mantine theo màu theme, với nền đậm hơn sắc độ 10% cố định của Mantine
 * (quá nhạt trên thanh tiêu đề). Chỉ dùng biến theme: `-light-color` tự đổi sắc độ theo scheme
 * (đậm hơn ở theme sáng, nhạt hơn ở theme tối) nên một giá trị dùng được cho cả hai.
 *
 * @param name - tên màu Mantine, ví dụ `red`.
 * @param component - tiền tố biến CSS của component: `ai` (ActionIcon) hoặc `button`.
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
