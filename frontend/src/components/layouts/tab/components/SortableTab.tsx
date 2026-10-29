import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CloseButton, Group, Tabs } from '@mantine/core';
import { m } from 'motion/react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fadeScale, TRANSITION_FAST } from '@/common/cnst/motionConst';
import TabLabel from '@/components/layouts/tab/components/TabLabel';
import classes from './SortableTab.module.css';

type SortableTabProps = {
  tabId: string;
  closable: boolean;
  onClickClose: (tabId: string, e: React.MouseEvent) => void;
};

/**
 * One draggable tab. Two nested elements keep transforms apart:
 * the outer one belongs to dnd-kit (position), the inner `m.div` to motion (enter, exit).
 */
function SortableTab({ tabId, closable, onClickClose }: SortableTabProps) {
  const { t } = useTranslation('tabLayout');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tabId });
  // Tabs.Tab owns role and tabIndex, and aria-pressed is invalid for role="tab"; keep only the other aria hints.
  const { role: _role, tabIndex: _tabIndex, 'aria-pressed': _pressed, ...ariaAttributes } = attributes;

  const onClickCloseButton = useCallback((e: React.MouseEvent) => onClickClose(tabId, e), [onClickClose, tabId]);

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
      <m.div variants={fadeScale} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
        <Tabs.Tab
          value={tabId}
          p="8px"
          h="38px"
          miw="200px"
          maw="200px"
          title={t('tooltip.dragTab')}
          styles={{
            tabLabel: { minWidth: 0, flex: 1 },
            tab: { cursor: 'grab', touchAction: 'none' },
          }}
          {...ariaAttributes}
          {...listeners}
        >
          <Group gap="xs" wrap="nowrap" p="0" justify="space-between">
            <TabLabel tabId={tabId} />
            {closable && (
              <CloseButton
                component="span"
                role="button"
                aria-label={t('tooltip.closeTab')}
                size="xs"
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
