import { ColorSwatch } from '@mantine/core';

type StatusDotProps = {
  connected: boolean;
};

/** Connection status dot, same colors as the profile cards: connected = green, disconnected = red. */
function StatusDot({ connected }: StatusDotProps) {
  return (
    <ColorSwatch
      size={10}
      withShadow={false}
      color={connected ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-red-6)'}
      style={{ flexShrink: 0 }}
    />
  );
}

export default StatusDot;
