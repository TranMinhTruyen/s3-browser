import { useModal } from '@ebay/nice-modal-react';
import { useCallback, useLayoutEffect } from 'react';
import { useModalStackStore } from '@/common/stores/modalStackStore';

const BASE_Z_INDEX = 200;
const STEP = 10;

/**
 * Connects a nice-modal-react modal instance to the app's global modal stack,
 * and maps the necessary state/handlers into props for Mantine Modal.
 *
 * Main purpose:
 * - Automatically register/unregister the modal in the global stack to compute z-index
 *   and determine which modal is currently on top.
 * - Only allow the topmost modal in the stack to be closed via Escape/click-outside
 *   (prevents accidentally closing an underlying modal when multiple modals are stacked).
 */
export function useMantineModal(modal: ReturnType<typeof useModal>) {
  const push = useModalStackStore(s => s.push);
  const remove = useModalStackStore(s => s.remove);

  const index = useModalStackStore(s => s.stack.indexOf(modal.id));
  const isTopmost = useModalStackStore(s => s.stack.length > 0 && s.stack[s.stack.length - 1] === modal.id);

  useLayoutEffect(() => {
    if (modal.visible) push(modal.id);
    else remove(modal.id);
    return () => remove(modal.id);
  }, [modal.id, modal.visible, push, remove]);

  // Conditional close handler:
  // Only allow closing when this modal is topmost, to avoid closing an underlying modal
  // when the user presses Escape or clicks outside while multiple modals are open
  const guardedClose = useCallback(() => {
    if (!isTopmost) return;
    modal.resolve(false);
    modal.hide();
  }, [isTopmost, modal]);

  const handleExitTransitionEnd = useCallback(() => {
    modal.remove();
  }, [modal]);

  const zIndex = index === -1 ? BASE_Z_INDEX : BASE_Z_INDEX + index * STEP;

  return {
    opened: modal.visible,
    zIndex,
    onClose: guardedClose,
    closeOnEscape: isTopmost,
    closeOnClickOutside: isTopmost,
    onExitTransitionEnd: handleExitTransitionEnd,
  };
}
