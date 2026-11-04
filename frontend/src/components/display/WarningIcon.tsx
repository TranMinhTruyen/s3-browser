import { Tooltip } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { WARNING_COLOR } from '@/components/modals/modalColors';

type WarningIconProps = {
  label: string;
  size?: number;
};

/** Warning triangle that explains itself in a tooltip; never shrinks inside a flex row. */
function WarningIcon({ label, size = 16 }: WarningIconProps) {
  return (
    <Tooltip label={label}>
      <TriangleAlert size={size} color={WARNING_COLOR} aria-label={label} style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export default WarningIcon;
