import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Group, Paper, Tabs } from '@mantine/core';
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useTabListStore } from '@/common/stores/tabListStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import SortableTab from '@/components/layouts/tab/components/SortableTab';
import TabDetail from '@/components/layouts/tab/components/TabDetail';
import TabDragPreview from '@/components/layouts/tab/components/TabDragPreview';
import TabScroller from '@/components/layouts/tab/components/TabScroller';

// Keep the overlay on the x axis and inside the visible tab strip (the TabScroller viewport, not over the + button).
const OVERLAY_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

// A slot becomes the drop target only when the dragged tab covers this share of its width (0.9 = almost fully).
const SWAP_COVER_RATIO = 0.9;

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

  const [activeId, setActiveId] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const overIdRef = useRef<UniqueIdentifier | null>(null);

  // Pick the slot covered >= SWAP_COVER_RATIO by the overlay; otherwise keep the previous one (no flicker, no miss).
  const collisionDetection = useCallback<CollisionDetection>(
    ({ active, collisionRect, droppableRects, droppableContainers }) => {
      const { left, right } = collisionRect;
      let best: { id: UniqueIdentifier; ratio: number } | null = null;
      for (const { id } of droppableContainers) {
        const rect = droppableRects.get(id);
        if (!rect) continue;
        const ratio = (Math.min(right, rect.right) - Math.max(left, rect.left)) / rect.width;
        if (ratio >= SWAP_COVER_RATIO && (!best || ratio > best.ratio)) best = { id, ratio };
      }
      overIdRef.current = best?.id ?? overIdRef.current ?? active.id;
      return [{ id: overIdRef.current }];
    },
    []
  );

  const onDragStartTab = useCallback(({ active }: DragStartEvent) => {
    draggingRef.current = true;
    overIdRef.current = active.id;
    setActiveId(String(active.id));
  }, []);
  const onDragCancelTab = useCallback(() => {
    draggingRef.current = false;
    overIdRef.current = null;
    setActiveId(null);
  }, []);
  const onDragEndTab = useCallback(
    ({ active, over }: DragEndEvent) => {
      draggingRef.current = false;
      overIdRef.current = null;
      setActiveId(null);
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

  // Tabs that were active at least once: only these mount their content, then stay mounted to keep state.
  // Updated during render (not in an effect) so the first active frame is never empty; closed tabs are dropped.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  if (activeTab && !visited.has(activeTab)) {
    setVisited(new Set([...visited, activeTab].filter(id => tabIds.includes(id))));
  }

  // Scroll the active tab into view when it changes or a tab is added/closed, not when tabs are only reordered.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabCount = tabIds.length;
  useEffect(() => {
    if (draggingRef.current) return;
    scrollerRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabCount, activeTab]);

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
        <TabScroller ref={scrollerRef}>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
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
            {createPortal(
              <DragOverlay modifiers={OVERLAY_MODIFIERS} dropAnimation={null}>
                {activeId && <TabDragPreview tabId={activeId} closable={tabIds.length > 1} />}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
        </TabScroller>
        <ActionIcon style={{ flexShrink: 0, marginLeft: '2px' }} onClick={addTab} aria-label={t('tooltip.addTab')}>
          <Plus />
        </ActionIcon>
      </Tabs.List>

      {tabIds.map(key => (
        <Tabs.Panel key={key} value={key} style={{ flex: 1, minHeight: 0 }}>
          {visited.has(key) && (
            <Paper
              withBorder
              h="100%"
              p="4px"
              style={{ overflow: 'hidden', borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
            >
              <TabDetail tabId={key} />
            </Paper>
          )}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
export default TabLayout;
