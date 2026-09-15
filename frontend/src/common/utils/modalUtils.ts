import NiceModal, { NiceModalHandler, type NiceModalHocProps, useModal } from '@ebay/nice-modal-react';
import { type ComponentType, createElement, type FC, useCallback, useLayoutEffect } from 'react';
import { useModalStackStore } from '@/common/stores/modalStackStore';

/** z-index of the bottom-most modal in the stack. */
const BASE_Z_INDEX = 200;
/** z-index increment for each modal stacked above the previous one. */
const STEP = 10;

/**
 * A nice-modal component with strongly typed static helpers.
 *
 * @typeParam P - the props passed to `show()`.
 * @typeParam R - the value the `show()` promise resolves with.
 */
export type ModalComponent<P, R> = FC<P & NiceModalHocProps> & {
  show: (...args: object extends P ? [props?: P] : [props: P]) => Promise<R>;
  hide: () => Promise<unknown>;
  remove: () => void;
};

/** A nice-modal handler whose `resolve` is typed with the modal's result. */
export type ModalHandler<R> = Omit<NiceModalHandler, 'resolve'> & {
  resolve: (value: R) => void;
};

/**
 * Props received by a component passed to {@link createMantineModal}:
 * the modal's own props plus a `mantine` bag injected by the wrapper.
 *
 * - `mantine.props`   – spread directly onto Mantine's `<Modal>`.
 * - `mantine.handler` – the nice-modal handler, with `resolve` typed as `R`.
 */
export type WithMantineModal<P, R> = P & {
  mantine: {
    props: {
      opened: boolean;
      zIndex: number;
      onClose: () => void;
      closeOnEscape: boolean;
      closeOnClickOutside: boolean;
      onExitTransitionEnd: () => void;
    };
    handler: ModalHandler<R>;
  };
};

/**
 * Creates a nice-modal component that is already wired to the global modal stack
 * and to Mantine's `<Modal>` props (z-index, `opened`, guarded close, exit cleanup).
 *
 * What the wrapper does:
 * - Pushes the modal id onto the stack while visible and removes it when hidden or unmounted.
 * - Computes `zIndex` from the modal's position in the stack, so newer modals render on top.
 * - Allows Escape / click-outside to close only the topmost modal, so dismissing a dialog
 *   never closes the modal underneath it.
 * - Removes the modal from nice-modal's state after Mantine's exit transition finishes.
 *
 * @typeParam P - the props passed to `show()` (the `mantine` prop is injected, not passed by callers).
 * @typeParam R - the value the modal resolves with when confirmed.
 *   `show()` resolves `R | null`; `null` means the modal was dismissed (unless `cancelValue` is provided).
 * @param Comp - the modal body; receives `P` plus the injected `mantine` prop.
 * @param options.cancelValue - the value to resolve with when the user dismisses the modal
 *   (Escape, click outside, close button). Fixed at creation time; defaults to `null`.
 *
 * @example
 * Without cancelValue → dismissing resolves `null`
 * import { Button, Group, Modal, Text } from '@mantine/core';
 *
 * type ConfirmDeleteProps = { taskName: string };
 *
 * export const ConfirmDeleteModal = createMantineModal<ConfirmDeleteProps, boolean>(
 *   ({ taskName, mantine: { props, handler } }) => {
 *     const answer = (value: boolean) => {
 *       handler.resolve(value);
 *       handler.hide();
 *     };
 *
 *     return (
 *       <Modal {...props} title="Delete task">
 *         <Text>Delete "{taskName}"?</Text>
 *         <Group justify="flex-end" mt="md">
 *           <Button variant="default" onClick={() => answer(false)}>Cancel</Button>
 *           <Button color="red" onClick={() => answer(true)}>Delete</Button>
 *         </Group>
 *       </Modal>
 *     );
 *   },
 * );
 *
 * const confirmed = await ConfirmDeleteModal.show({ taskName: task.name }); // boolean | null
 * if (confirmed) await deleteTask(task.id);
 *
 * @example
 * With cancelValue → dismissing resolves that value instead of `null`
 * export const SelectModeModal = createMantineModal<object, 'edit' | 'view'>(
 *   ({ mantine: { props, handler } }) => (
 *     <Modal {...props} title="Open as">
 *       <Button onClick={() => { handler.resolve('edit'); handler.hide(); }}>Edit</Button>
 *     </Modal>
 *   ),
 *   { cancelValue: 'view' },
 * );
 *
 * Typed as 'edit' | 'view' | null, but never null at runtime because cancelValue is provided.
 * const mode = await SelectModeModal.show();
 */
export function createMantineModal<P extends object, R = unknown>(
  Comp: ComponentType<WithMantineModal<P, R>>,
  options?: { cancelValue?: R }
): ModalComponent<P, R | null> {
  // Computed once at creation time, shared by every instance of this modal.
  const cancelValue: R | null = options?.cancelValue ?? null;

  function MantineModalWrapper(props: P) {
    const acquire = useModalStackStore(s => s.acquire);
    const release = useModalStackStore(s => s.release);

    const modal = useModal();

    const index = useModalStackStore(s => s.stack.indexOf(modal.id));
    const isTopmost = useModalStackStore(s => s.stack.length > 0 && s.stack[s.stack.length - 1] === modal.id);

    // Keep the global stack in sync with visibility: in the stack while visible,
    // released when hidden or unmounted. The store keeps the stack position across
    // effect re-runs (HMR / Fast Refresh, StrictMode).
    // useLayoutEffect ensures z-index is correct before the browser paints the modal.
    useLayoutEffect(() => {
      if (!modal.visible) return;
      const id = modal.id;
      acquire(id);
      return () => release(id);
    }, [modal.id, modal.visible, acquire, release]);

    // Close only when this modal is topmost. Otherwise Escape / click-outside
    // on a stacked dialog could also close a modal underneath it.
    // `cancelValue` is a constant from the outer scope, so it is not a dependency.
    const guardedClose = useCallback(() => {
      if (!isTopmost) return;
      modal.resolve(cancelValue);
      modal.hide();
    }, [isTopmost, modal]);

    // Unmount only after Mantine's exit animation has finished, so the close transition is visible.
    const handleExitTransitionEnd = useCallback(() => {
      modal.remove();
    }, [modal]);

    // Not in the stack yet (e.g. first render before the layout effect) → fall back to the base z-index.
    const zIndex = index === -1 ? BASE_Z_INDEX : BASE_Z_INDEX + index * STEP;

    return createElement(Comp, {
      ...props,
      mantine: {
        props: {
          opened: modal.visible,
          zIndex,
          onClose: guardedClose,
          closeOnEscape: isTopmost,
          closeOnClickOutside: isTopmost,
          onExitTransitionEnd: handleExitTransitionEnd,
        },
        handler: modal as ModalHandler<R>,
      },
    } as WithMantineModal<P, R>);
  }

  MantineModalWrapper.displayName = `MantineModal(${Comp.displayName || Comp.name || 'Anonymous'})`;

  const Modal = NiceModal.create(MantineModalWrapper) as ModalComponent<P, R | null>;

  Modal.show = ((props?: P) => NiceModal.show<R | null, any, any>(Modal as FC<any>, props)) as ModalComponent<
    P,
    R | null
  >['show'];
  Modal.hide = () => NiceModal.hide(Modal as FC<any>);
  Modal.remove = () => NiceModal.remove(Modal as FC<any>);

  return Modal;
}
