import { Tooltip } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { WARNING_COLOR } from '@/components/modals/modalColors';

type WarningIconProps = {
  label: string;
  /** Size in px at the medium size; drawn in rem so it follows the interface size. */
  size?: number;
};

/** Warning triangle that explains itself in a tooltip; never shrinks inside a flex row. */
function WarningIcon({ label, size = 16 }: WarningIconProps) {
  return (
    <Tooltip label={label}>
      <TriangleAlert size={`${size / 16}rem`} color={WARNING_COLOR} aria-label={label} style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export default WarningIcon;
