import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Group, Paper, Tabs } from '@mantine/core';
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ActionIcon from '@/components/buttons/ActionIcon';
import SortableTab from './SortableTab';
import TabDragPreview from './TabDragPreview';
import TabScroller from './TabScroller';

// Giữ overlay trên trục x và trong dải tab đang hiển thị (viewport của TabScroller, không phủ lên nút +).
const OVERLAY_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

// Một vị trí chỉ trở thành đích thả khi tab đang kéo phủ ít nhất tỷ lệ này theo chiều rộng (0.9 = gần như phủ kín).
const SWAP_COVER_RATIO = 0.9;

/** Cấu trúc tối thiểu của store tab (workspace S3 và SQL); dải tab không cần biết kiểu giá trị trong `tabList`. */
type TabStoreState = {
  activeTab: string;
  tabList: Record<string, unknown>;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  moveTab: (activeId: string, overId: string) => void;
};

type TabStripProps = {
  useTabStore: {
    <T>(selector: (state: TabStoreState) => T): T;
    getState: () => TabStoreState;
  };
  /** Phải giữ ổn định tham chiếu (các tab được memo phụ thuộc vào giá trị này). */
  renderLabel: (tabId: string) => ReactNode;
  /** Nội dung tab từng được kích hoạt; nơi gọi quyết định cách ẩn khi `active` là false. */
  renderDetail: (tabId: string, active: boolean) => ReactNode;
};

/**
 * Trang tab dùng chung: dải tab có thể đóng, cuộn và kéo sắp xếp, nằm phía trên nội dung chi tiết của từng tab.
 * Nội dung tab được mount ở lần kích hoạt đầu tiên rồi giữ nguyên để bảo toàn state (renderDetail chịu trách nhiệm ẩn tab).
 */
function TabStrip({ useTabStore, renderLabel, renderDetail }: TabStripProps) {
  const { t } = useTranslation('common');

  const activeTab = useTabStore(s => s.activeTab);
  const tabIds = useTabStore(useShallow(s => Object.keys(s.tabList)));

  // Chỉ bật thao tác đóng và kéo khi có ít nhất hai tab.
  const multiple = tabIds.length > 1;

  const addTab = useTabStore(s => s.addTab);
  const closeTab = useTabStore(s => s.closeTab);
  const setActiveTab = useTabStore(s => s.setActiveTab);
  const moveTab = useTabStore(s => s.moveTab);

  // Chỉ dùng con trỏ (cần di chuyển 5px mới bắt đầu kéo, nên click vẫn chọn được tab).
  // Không dùng KeyboardSensor: Space/Enter chọn tab; Ctrl+Shift+Left/Right sắp xếp tab bằng bàn phím (onMoveTab).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Trình đọc màn hình đọc nội dung này cho từng tab thay cho mặc định của dnd-kit (không hỗ trợ kéo bằng bàn phím).
  const accessibility = useMemo(() => ({ screenReaderInstructions: { draggable: t('tab.drag') } }), [t]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const overIdRef = useRef<UniqueIdentifier | null>(null);

  // Chọn vị trí được overlay phủ >= SWAP_COVER_RATIO; nếu không thì giữ vị trí trước đó (tránh nhấp nháy hoặc bỏ sót).
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

  // Đổi chỗ tab với tab kế bên; đọc từ store để callback giữ ổn định. Không làm gì nếu tab đang ở một trong hai đầu.
  const onMoveTab = useCallback(
    (tabId: string, offset: -1 | 1) => {
      const ids = Object.keys(useTabStore.getState().tabList);
      const target = ids[ids.indexOf(tabId) + offset];
      if (target) moveTab(tabId, target);
    },
    [useTabStore, moveTab]
  );

  const onClickCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(tabId);
    },
    [closeTab]
  );

  // Các tab từng được kích hoạt: chỉ những tab này mới mount nội dung, sau đó giữ nguyên để bảo toàn state.
  // Cập nhật ngay lúc render (không dùng effect) để khung hình đầu tiên luôn có nội dung; tab đã đóng sẽ bị loại bỏ.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  if (activeTab && !visited.has(activeTab)) {
    setVisited(new Set([...visited, activeTab].filter(id => tabIds.includes(id))));
  }

  // Cuộn để hiện tab đang hoạt động khi tab thay đổi, được thêm hoặc đóng; không cuộn khi chỉ sắp xếp lại.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabCount = tabIds.length;
  useEffect(() => {
    if (draggingRef.current) return;
    scrollerRef.current
      ?.querySelector('[data-active]:not([data-exiting])')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabCount, activeTab]);

  return (
    // Thêm viền như S3Navbar để trang tab hiển thị thành một panel riêng.
    <Paper withBorder h="100%" p="0.25rem">
      <Tabs
        variant="outline"
        value={activeTab}
        onChange={setActiveTab}
        keepMountedMode="display-none"
        h="100%"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {/* Transparent border var hides the outline variant's list line: the detail below has its own full border. */}
        {/* Bottom padding (not tab margin) spaces the strip so tabs and the + button share one vertical center. */}
        <Tabs.List
          pb="0.25rem"
          style={{ flexWrap: 'nowrap', alignItems: 'center', '--tab-border-color': 'transparent' }}
        >
          <TabScroller ref={scrollerRef}>
            <DndContext
              sensors={sensors}
              accessibility={accessibility}
              collisionDetection={collisionDetection}
              onDragStart={onDragStartTab}
              onDragEnd={onDragEndTab}
              onDragCancel={onDragCancelTab}
            >
              <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                <Group gap={0} wrap="nowrap" style={{ alignSelf: 'flex-end' }}>
                  <AnimatePresence initial={false}>
                    {tabIds.map(key => (
                      <SortableTab
                        renderLabel={renderLabel}
                        key={key}
                        tabId={key}
                        closable={multiple}
                        sortable={multiple}
                        onClickClose={onClickCloseTab}
                        onMoveTab={onMoveTab}
                      />
                    ))}
                  </AnimatePresence>
                </Group>
              </SortableContext>
              {createPortal(
                <DragOverlay modifiers={OVERLAY_MODIFIERS} dropAnimation={null}>
                  {activeId && <TabDragPreview label={renderLabel(activeId)} closable={multiple} />}
                </DragOverlay>,
                document.body
              )}
            </DndContext>
          </TabScroller>
          <ActionIcon style={{ flexShrink: 0, marginLeft: '0.125rem' }} onClick={addTab} tooltip={t('tab.add')}>
            <Plus />
          </ActionIcon>
        </Tabs.List>

        {tabIds.map(key => (
          <Tabs.Panel key={key} value={key} style={{ flex: 1, minHeight: 0 }}>
            {visited.has(key) && renderDetail(key, key === activeTab)}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Paper>
  );
}
export default TabStrip;
