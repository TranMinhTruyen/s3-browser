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
        background: 'var(--mantine-color-body)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-default) var(--mantine-radius-default) 0 0',
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
