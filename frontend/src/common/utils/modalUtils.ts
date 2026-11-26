import NiceModal, { NiceModalHandler, type NiceModalHocProps, useModal } from '@ebay/nice-modal-react';
import { ModalProps as MantineModalProps } from '@mantine/core';
import { type ComponentType, createElement, type FC, useCallback, useLayoutEffect } from 'react';
import { useModalStackStore } from '@/common/stores/modalStackStore';

/** z-index của modal nằm dưới cùng trong stack. */
const BASE_Z_INDEX = 200;
/** Mức tăng z-index của mỗi modal được xếp lên trên modal trước đó. */
const STEP = 10;

export type ModalProps = Omit<MantineModalProps, 'opened' | 'onClose'> & {};

/**
 * Component nice-modal có các hàm static được định kiểu chặt chẽ.
 *
 * @typeParam P - các props truyền vào `show()`.
 * @typeParam R - giá trị promise của `show()` trả về.
 */
export type ModalComponent<P, R> = FC<P & NiceModalHocProps> & {
  show: (...args: object extends P ? [props?: P] : [props: P]) => Promise<R>;
  hide: () => Promise<unknown>;
  remove: () => void;
};

/** Handler nice-modal có `resolve` được định kiểu theo kết quả của modal. */
type ModalHandler<R> = Omit<NiceModalHandler, 'resolve'> & {
  resolve: (value: R) => void;
};

/**
 * Props mà component truyền vào {@link createMantineModal} nhận được:
 * props riêng của modal cùng object `mantine` do wrapper thêm vào.
 *
 * - `mantine.props`   – được spread trực tiếp vào `<Modal>` của Mantine.
 * - `mantine.handler` – handler nice-modal, với `resolve` có kiểu `R`.
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
 * Tạo component nice-modal đã kết nối với stack modal toàn cục và các props `<Modal>` của Mantine
 * (z-index, `opened`, kiểm soát đóng, dọn dẹp sau khi thoát).
 *
 * Wrapper thực hiện các việc sau:
 * - Thêm id modal vào stack khi hiển thị và gỡ khi ẩn hoặc unmount.
 * - Tính `zIndex` theo vị trí modal trong stack để modal mới hơn nằm trên cùng.
 * - Chỉ cho phép Escape / click bên ngoài đóng modal trên cùng, để đóng hộp thoại không làm đóng modal bên dưới.
 * - Gỡ modal khỏi state của nice-modal sau khi Mantine chạy xong hiệu ứng thoát.
 *
 * @typeParam P - các props truyền vào `show()` (caller không truyền `mantine`, wrapper tự thêm).
 * @typeParam R - giá trị modal trả về khi xác nhận.
 *   `show()` trả `R | null`; `null` nghĩa là modal bị đóng (trừ khi có `cancelValue`).
 * @param Comp - phần nội dung modal; nhận `P` cùng prop `mantine` được thêm vào.
 * @param options.cancelValue - giá trị trả về khi người dùng đóng modal
 *   (Escape, click bên ngoài, nút đóng). Được cố định khi tạo và mặc định là `null`.
 *
 * @example
 * Không có cancelValue → đóng modal sẽ trả `null`.
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
 *       <Modal {...props} title="Xóa tác vụ">
 *         <Text>Xóa "{taskName}"?</Text>
 *         <Group justify="flex-end" mt="md">
 *           <Button variant="default" onClick={() => answer(false)}>Hủy</Button>
 *           <Button color="red" onClick={() => answer(true)}>Xóa</Button>
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
 * Có cancelValue → đóng modal sẽ trả giá trị đó thay vì `null`.
 * export const SelectModeModal = createMantineModal<object, 'edit' | 'view'>(
 *   ({ mantine: { props, handler } }) => (
 *     <Modal {...props} title="Mở dưới dạng">
 *       <Button onClick={() => { handler.resolve('edit'); handler.hide(); }}>Chỉnh sửa</Button>
 *     </Modal>
 *   ),
 *   { cancelValue: 'view' },
 * );
 *
 * Kiểu là 'edit' | 'view' | null, nhưng lúc chạy không thể là null vì đã cung cấp cancelValue.
 * const mode = await SelectModeModal.show();
 */
export function createMantineModal<P extends object, R = unknown>(
  Comp: ComponentType<WithMantineModal<P, R>>,
  options?: { cancelValue?: R }
): ModalComponent<P, R | null> {
  // Tính một lần khi tạo và dùng chung cho mọi instance của modal này.
  const cancelValue: R | null = options?.cancelValue ?? null;

  function MantineModalWrapper(props: P) {
    const acquire = useModalStackStore(s => s.acquire);
    const release = useModalStackStore(s => s.release);

    const modal = useModal();

    const index = useModalStackStore(s => s.stack.indexOf(modal.id));
    const isTopmost = useModalStackStore(s => s.stack.length > 0 && s.stack[s.stack.length - 1] === modal.id);

    // Đồng bộ stack toàn cục với trạng thái hiển thị: thêm vào stack khi hiển thị,
    // gỡ khi ẩn hoặc unmount. Store giữ nguyên vị trí trong stack qua các lần chạy lại effect
    // (HMR / Fast Refresh, StrictMode).
    // useLayoutEffect đảm bảo z-index chính xác trước khi trình duyệt vẽ modal.
    useLayoutEffect(() => {
      if (!modal.visible) return;
      const id = modal.id;
      acquire(id);
      return () => release(id);
    }, [modal.id, modal.visible, acquire, release]);

    // Chỉ đóng nếu modal này nằm trên cùng. Nếu không, Escape / click bên ngoài hộp thoại trong stack
    // có thể đồng thời đóng cả modal bên dưới.
    // `cancelValue` là hằng số từ scope bên ngoài nên không cần thêm vào dependency.
    const guardedClose = useCallback(() => {
      if (!isTopmost) return;
      modal.resolve(cancelValue);
      modal.hide();
    }, [isTopmost, modal]);

    // Chỉ unmount sau khi Mantine chạy xong hiệu ứng thoát để người dùng nhìn thấy chuyển cảnh đóng.
    const handleExitTransitionEnd = useCallback(() => {
      modal.remove();
    }, [modal]);

    // Chưa có trong stack (ví dụ lần render đầu trước layout effect) → dùng z-index cơ sở.
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
