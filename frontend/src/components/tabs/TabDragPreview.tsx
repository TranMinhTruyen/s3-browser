import { CloseButton, Group } from '@mantine/core';
import { memo, type ReactNode } from 'react';
import classes from './SortableTab.module.css';
import { TAB_HEIGHT, TAB_WIDTH } from './tabConst';

type TabDragPreviewProps = {
  label: ReactNode;
  closable: boolean;
};

/** Bản sao chỉ để hiển thị của tab trong DragOverlay (không phải Tabs.Tab nên không tạo role="tab" trùng lặp). */
function TabDragPreview({ label, closable }: TabDragPreviewProps) {
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      justify="space-between"
      p="0.5rem"
      h={TAB_HEIGHT}
      w={TAB_WIDTH}
      style={{
        cursor: 'grabbing',
        // Dùng giao diện như tab đang hoạt động (SortableTab.module.css): biến thể "light" của màu chính.
        background: 'var(--mantine-primary-color-light)',
        color: 'var(--mantine-primary-color-light-color)',
        borderRadius: 'var(--mantine-radius-md)',
        // Dùng viền trong suốt 1px như tab đang hoạt động để nội dung thẳng hàng.
        border: '1px solid transparent',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>{label}</div>
      {closable && (
        <CloseButton component="span" className={classes.close} style={{ flexShrink: 0, pointerEvents: 'none' }} />
      )}
    </Group>
  );
}
export default memo(TabDragPreview);
