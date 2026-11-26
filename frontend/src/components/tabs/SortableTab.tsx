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
  /** Phải giữ ổn định tham chiếu để memo của tab hoạt động. */
  renderLabel: (tabId: string) => ReactNode;
  closable: boolean;
  /** Bật kéo để sắp xếp (có ít nhất 2 tab): con trỏ nắm, tooltip gợi ý và thao tác kéo bằng chuột/bàn phím. */
  sortable: boolean;
  onClickClose: (tabId: string, e: React.MouseEvent) => void;
  /** Ctrl+Shift+Left/Right: di chuyển tab sang một vị trí (-1 sang trái, 1 sang phải). */
  onMoveTab: (tabId: string, offset: -1 | 1) => void;
};

/**
 * Một tab, có thể kéo khi `sortable`. Hai phần tử lồng nhau tách riêng các hiệu ứng transform:
 * phần tử ngoài thuộc về dnd-kit (vị trí), `m.div` bên trong thuộc về motion (hiện, ẩn).
 * Phải render bên trong `AnimatePresence`: khi đóng, tab mờ dần và thu hẹp để các tab bên cạnh trượt vào
 * (chỉ mờ dần nếu người dùng không bật chế độ giảm chuyển động). Space/Enter chọn tab; Ctrl+Shift+Left/Right sắp xếp lại.
 */
function SortableTab({ tabId, renderLabel, closable, sortable, onClickClose, onMoveTab }: SortableTabProps) {
  const { t } = useTranslation('common');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabId,
    disabled: !sortable,
  });
  const reducedMotion = useReducedMotion();
  // False khi tab đang chạy animation thoát (vẫn ở DOM và vẫn có data-active).
  const isPresent = useIsPresent();
  // Tabs.Tab quản lý role và tabIndex; aria-pressed không hợp lệ với role="tab", nên chỉ giữ các gợi ý aria khác.
  const { role: _role, tabIndex: _tabIndex, 'aria-pressed': _pressed, ...ariaAttributes } = attributes;

  const onClickCloseButton = useCallback((e: React.MouseEvent) => onClickClose(tabId, e), [onClickClose, tabId]);

  // Sắp xếp bằng bàn phím, đăng ký ở pha capture: stopPropagation ngăn onKeyDown pha bubble của Mantine chạy,
  // nếu không nó sẽ chọn cả tab bên cạnh. Giữ tiêu điểm ở tab được di chuyển vì thao tác sắp xếp có thể chèn lại
  // node DOM và làm mất tiêu điểm.
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
        // DragOverlay hiển thị tab đang kéo; tab gốc chỉ giữ vị trí của nó.
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
          p="0.5rem"
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
                className={classes.close}
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
