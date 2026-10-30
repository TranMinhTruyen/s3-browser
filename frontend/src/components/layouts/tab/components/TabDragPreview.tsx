import { CloseButton, Group } from '@mantine/core';
import { memo } from 'react';
import TabLabel from '@/components/layouts/tab/components/TabLabel';

type TabDragPreviewProps = {
  tabId: string;
  closable: boolean;
};

/** Presentational copy of a tab shown in the DragOverlay (not a Tabs.Tab, so no duplicate role="tab"). */
function TabDragPreview({ tabId, closable }: TabDragPreviewProps) {
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      justify="space-between"
      p="8px"
      h="38px"
      w="200px"
      style={{
        cursor: 'grabbing',
        // Same look as the active tab (SortableTab.module.css): primary "light" variant.
        background: 'var(--mantine-primary-color-light)',
        color: 'var(--mantine-primary-color-light-color)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <TabLabel tabId={tabId} />
      </div>
      {closable && <CloseButton component="span" size="xs" style={{ flexShrink: 0, pointerEvents: 'none' }} />}
    </Group>
  );
}
export default memo(TabDragPreview);
