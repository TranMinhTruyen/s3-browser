import { type ElementProps, Button as MButton, type ButtonProps as MButtonProps, Tooltip } from '@mantine/core';
import { type MouseEvent, useCallback, useState } from 'react';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';
import classes from './button.module.css';

interface ButtonProps extends MButtonProps, ElementProps<'button', keyof MButtonProps> {}

const BUTTON_CLASS_NAMES = { root: classes.root, inner: classes.inner, label: classes.label };

/**
 * Nút Mantine hiện trạng thái tải và tự vô hiệu hóa khi `onClick` bất đồng bộ đang chờ.
 * Ưu tiên prop `loading` tường minh. Mặc định: size `sm`, variant `light`; các prop khác được chuyển cho Mantine.
 * Nút co theo container: nhãn văn bản không vừa sẽ bị cắt bằng dấu ba chấm và hiển thị trong tooltip.
 */
function Button(props: ButtonProps) {
  const { size = 'sm', loading, onClick, disabled, onMouseEnter, children, ...restProps } = props;

  const { isLoading, onClickButton } = useAutoLoading(onClick, loading);
  const [truncated, setTruncated] = useState(false);

  // Chỉ đo khi rê chuột nên không chạy lúc render hoặc thay đổi kích thước.
  const onMouseEnterButton = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      const label = e.currentTarget.querySelector<HTMLElement>(`.${classes.label}`);
      setTruncated(!!label && label.scrollWidth > label.clientWidth);
      onMouseEnter?.(e);
    },
    [onMouseEnter]
  );

  return (
    <Tooltip label={children} disabled={!truncated || typeof children !== 'string'} openDelay={300} withinPortal>
      <MButton
        variant={'light'}
        size={size}
        loading={isLoading}
        disabled={disabled || isLoading}
        classNames={BUTTON_CLASS_NAMES}
        onClick={onClickButton}
        onMouseEnter={onMouseEnterButton}
        {...restProps}
      >
        {children}
      </MButton>
    </Tooltip>
  );
}

Button.Group = MButton.Group;
Button.GroupSection = MButton.GroupSection;

export default Button;
