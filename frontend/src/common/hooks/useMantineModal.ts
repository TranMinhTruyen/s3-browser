import { NiceModalHandler, useModal } from '@ebay/nice-modal-react';
import { useCallback, useLayoutEffect } from 'react';
import { useModalStackStore } from '@/common/stores/modalStackStore';

const BASE_Z_INDEX = 200;
const STEP = 10;

/** A nice-modal handler whose `resolve` is typed with the modal's result. */
export type ModalHandler<R> = Omit<NiceModalHandler, 'resolve'> & {
  resolve: (value: R) => void;
};

/**
 * Connects a nice-modal-react modal instance to the app's global modal stack,
 * and maps the necessary state/handlers into props for Mantine Modal.
 *
 * Main purpose:
 * - Automatically register/unregister the modal in the global stack to compute z-index
 *   and determine which modal is currently on top.
 * - Only allow the topmost modal in the stack to be closed via Escape/click-outside
 *   (prevents accidentally closing an underlying modal when multiple modals are stacked).
 *
 * @param cancelValue - the value the modal resolves with when the user dismisses it.
 */
export function useMantineModal<R>(cancelValue?: R) {
  const push = useModalStackStore(s => s.push);
  const remove = useModalStackStore(s => s.remove);

  const modal = useModal();

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
    modal.resolve(cancelValue);
    modal.hide();
  }, [cancelValue, isTopmost, modal]);

  const handleExitTransitionEnd = useCallback(() => {
    modal.remove();
  }, [modal]);

  const zIndex = index === -1 ? BASE_Z_INDEX : BASE_Z_INDEX + index * STEP;

  return {
    props: {
      opened: modal.visible,
      zIndex,
      onClose: guardedClose,
      closeOnEscape: isTopmost,
      closeOnClickOutside: isTopmost,
      onExitTransitionEnd: handleExitTransitionEnd,
    },
    handler: modal as ModalHandler<R>,
  };
}
