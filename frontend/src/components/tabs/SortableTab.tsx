import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CloseButton, Group, Tabs } from '@mantine/core';
import { m, useIsPresent, useReducedMotion } from 'motion/react';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fadeCollapse, TRANSITION_FAST } from '@/common/cnst/motionConst';
import classes from './SortableTab.module.css';
import { TAB_HEIGHT, TAB_WIDTH } from './tabConst';

type SortableTabProps = {
  tabId: string;
  /** Must be referentially stable so the memo of this tab holds. */
  renderLabel: (tabId: string) => ReactNode;
  closable: boolean;
  /** Drag-reorder is on (at least 2 tabs): grab cursor, hint tooltip, pointer and keyboard drag. */
  sortable: boolean;
  onClickClose: (tabId: string, e: React.MouseEvent) => void;
  /** Ctrl+Shift+Left/Right: move the tab one slot (-1 left, 1 right). */
  onMoveTab: (tabId: string, offset: -1 | 1) => void;
};

/**
 * One tab, draggable when `sortable`. Two nested elements keep transforms apart:
 * the outer one belongs to dnd-kit (position), the inner `m.div` to motion (enter, exit).
 * Must be rendered inside `AnimatePresence`: on close the tab fades and collapses its width so siblings slide over
 * (fade only when the user prefers reduced motion). Space/Enter select the tab; Ctrl+Shift+Left/Right reorders it.
 */
function SortableTab({ tabId, renderLabel, closable, sortable, onClickClose, onMoveTab }: SortableTabProps) {
  const { t } = useTranslation('common');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabId,
    disabled: !sortable,
  });
  const reducedMotion = useReducedMotion();
  // False while the tab plays its exit animation (still in the DOM, still data-active).
  const isPresent = useIsPresent();
  // Tabs.Tab owns role and tabIndex, and aria-pressed is invalid for role="tab"; keep only the other aria hints.
  const { role: _role, tabIndex: _tabIndex, 'aria-pressed': _pressed, ...ariaAttributes } = attributes;

  const onClickCloseButton = useCallback((e: React.MouseEvent) => onClickClose(tabId, e), [onClickClose, tabId]);

  // Keyboard reorder, attached in the capture phase: stopPropagation here keeps the event from Mantine's own
  // bubble-phase onKeyDown, which would also select the neighbouring tab. Focus is kept on the moved tab because
  // the reorder may re-insert its DOM node and drop focus.
  const onKeyDownTab = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!sortable || !e.ctrlKey || !e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      e.stopPropagation();
      const tab = e.currentTarget;
      onMoveTab(tabId, e.key === 'ArrowLeft' ? -1 : 1);
      queueMicrotask(() => tab.focus());
    },
    [sortable, onMoveTab, tabId]
  );

  return (
    <div
      className={classes.wrapper}
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // The DragOverlay shows the dragged tab; the original only holds its slot.
        visibility: isDragging ? 'hidden' : undefined,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <m.div
        variants={fadeCollapse}
        initial="hidden"
        animate="visible"
        exit={reducedMotion ? 'hidden' : 'collapse'}
        transition={TRANSITION_FAST}
      >
        <Tabs.Tab
          value={tabId}
          className={classes.tab}
          p="8px"
          h={TAB_HEIGHT}
          miw={TAB_WIDTH}
          maw={TAB_WIDTH}
          title={sortable ? t('tab.drag') : undefined}
          styles={{
            tabLabel: { minWidth: 0, flex: 1 },
            tab: sortable ? { cursor: 'grab', touchAction: 'none' } : undefined,
          }}
          data-exiting={isPresent ? undefined : ''}
          onKeyDownCapture={onKeyDownTab}
          {...(sortable ? { ...ariaAttributes, ...listeners } : undefined)}
        >
          <Group gap="xs" wrap="nowrap" justify="space-between">
            {renderLabel(tabId)}
            {closable && (
              <CloseButton
                component="span"
                role="button"
                aria-label={t('tab.close')}
                size={22}
                // Even gap (22 - 16) / 2 = 3px: the default 70% icon lands on a fractional offset, off-center.
                iconSize={16}
                onClick={onClickCloseButton}
                style={{ flexShrink: 0 }}
              />
            )}
          </Group>
        </Tabs.Tab>
      </m.div>
    </div>
  );
}
export default memo(SortableTab);
