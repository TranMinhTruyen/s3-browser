import { Tooltip } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { WARNING_COLOR } from '@/components/modals/modalColors';

type WarningIconProps = {
  label: string;
  /** Kích thước theo px ở cỡ trung bình; vẽ bằng rem để co giãn theo cỡ giao diện. */
  size?: number;
};

/** Tam giác cảnh báo có tooltip giải thích; không bị co nhỏ trong hàng flex. */
function WarningIcon({ label, size = 16 }: WarningIconProps) {
  return (
    <Tooltip label={label}>
      <TriangleAlert size={`${size / 16}rem`} color={WARNING_COLOR} aria-label={label} style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export default WarningIcon;
