import NiceModal, { type NiceModalHocProps } from '@ebay/nice-modal-react';
import type { ComponentType, FC } from 'react';

export type ModalComponent<P, R> = FC<P & NiceModalHocProps> & {
  show: (...args: object extends P ? [props?: P] : [props: P]) => Promise<R>;
  hide: () => Promise<unknown>;
  remove: () => void;
};

/**
 * Typed wrapper around `NiceModal.create`.
 *
 * @typeParam P - the modal component props.
 * @typeParam R - the value the modal resolves with (see {@link useModalHandler}).
 *
 * @example
 * export default createModal<MyModalProps, MyResult | false>(props => ...);
 * const result = await MyModal.show({ id });
 */
export function createModal<P extends object, R = unknown>(Comp: ComponentType<P>): ModalComponent<P, R> {
  const Modal = NiceModal.create(Comp) as ModalComponent<P, R>;

  Modal.show = ((props?: P) => NiceModal.show<R, any, any>(Modal as FC<any>, props)) as ModalComponent<P, R>['show'];
  Modal.hide = () => NiceModal.hide(Modal as FC<any>);
  Modal.remove = () => NiceModal.remove(Modal as FC<any>);

  return Modal;
}
