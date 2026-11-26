import { ColorSwatch } from '@mantine/core';

type StatusDotProps = {
  connected: boolean;
};

/** Chấm trạng thái kết nối, dùng cùng màu với thẻ profile: xanh khi đã kết nối, đỏ khi mất kết nối. */
function StatusDot({ connected }: StatusDotProps) {
  return (
    <ColorSwatch
      size="0.625rem"
      withShadow={false}
      color={connected ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-red-6)'}
      style={{ flexShrink: 0 }}
    />
  );
}

export default StatusDot;
