import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Group, Paper, Scroller, Tabs } from '@mantine/core';
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useTabListStore } from '@/common/stores/tabListStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import SortableTab from '@/components/layouts/tab/components/SortableTab';
import TabDetail from '@/components/layouts/tab/components/TabDetail';

const DND_MODIFIERS = [restrictToHorizontalAxis, restrictToParentElement];

/** Tab strip with closable, scrollable, drag-sortable tabs; panels stay mounted (display none) to keep each tab's state. */
function TabLayout() {
  const { t } = useTranslation('tabLayout');

  const activeTab = useTabListStore(s => s.activeTab);
  const tabIds = useTabListStore(useShallow(s => Object.keys(s.tabList)));

  const addTab = useTabListStore(s => s.addTab);
  const closeTab = useTabListStore(s => s.closeTab);
  const setActiveTab = useTabListStore(s => s.setActiveTab);
  const moveTab = useTabListStore(s => s.moveTab);

  // Pointer needs a 5px move to start a drag, so clicks still select the tab.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const draggingRef = useRef(false);
  const onDragStartTab = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onDragCancelTab = useCallback(() => {
    draggingRef.current = false;
  }, []);
  const onDragEndTab = useCallback(
    ({ active, over }: DragEndEvent) => {
      draggingRef.current = false;
      if (over) moveTab(String(active.id), String(over.id));
    },
    [moveTab]
  );

  const onClickCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(tabId);
    },
    [closeTab]
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draggingRef.current) return;
    const container = scrollerRef.current?.querySelector<HTMLElement>('.mantine-Scroller-container');
    if (!container) return;

    container.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    container.dispatchEvent(new Event('scroll'));
  }, [tabIds, activeTab]);

  return (
    <Tabs
      variant="outline"
      value={activeTab}
      onChange={setActiveTab}
      keepMountedMode="display-none"
      h="100%"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <Scroller ref={scrollerRef} style={{ flexShrink: 1, minWidth: 0 }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={DND_MODIFIERS}
            onDragStart={onDragStartTab}
            onDragEnd={onDragEndTab}
            onDragCancel={onDragCancelTab}
          >
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
              <Group gap={0} wrap="nowrap" style={{ alignSelf: 'flex-end' }}>
                <AnimatePresence initial={false}>
                  {tabIds.map(key => (
                    <SortableTab key={key} tabId={key} closable={tabIds.length > 1} onClickClose={onClickCloseTab} />
                  ))}
                </AnimatePresence>
              </Group>
            </SortableContext>
          </DndContext>
        </Scroller>
        <ActionIcon style={{ flexShrink: 0, marginLeft: '2px' }} onClick={addTab} aria-label={t('tooltip.addTab')}>
          <Plus />
        </ActionIcon>
      </Tabs.List>

      {tabIds.map(key => (
        <Tabs.Panel key={key} value={key} style={{ flex: 1, minHeight: 0 }}>
          <Paper
            withBorder
            h="100%"
            p="4px"
            style={{ overflow: 'hidden', borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
          >
            <TabDetail tabId={key} />
          </Paper>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
export default TabLayout;
