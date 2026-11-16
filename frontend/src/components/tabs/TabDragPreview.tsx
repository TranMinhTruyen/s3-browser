import { CloseButton, Group } from '@mantine/core';
import { memo, type ReactNode } from 'react';
import classes from './SortableTab.module.css';
import { TAB_HEIGHT, TAB_WIDTH } from './tabConst';

type TabDragPreviewProps = {
  label: ReactNode;
  closable: boolean;
};

/** Presentational copy of a tab shown in the DragOverlay (not a Tabs.Tab, so no duplicate role="tab"). */
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
        // Same look as the active tab (SortableTab.module.css): primary "light" variant.
        background: 'var(--mantine-primary-color-light)',
        color: 'var(--mantine-primary-color-light-color)',
        borderRadius: 'var(--mantine-radius-md)',
        // Same transparent 1px border as the active tab so the content lines up.
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
