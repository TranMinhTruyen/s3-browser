import { type ElementProps, Button as MButton, type ButtonProps as MButtonProps, Tooltip } from '@mantine/core';
import { type MouseEvent, useCallback, useState } from 'react';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';
import classes from './button.module.css';

interface ButtonProps extends MButtonProps, ElementProps<'button', keyof MButtonProps> {}

const BUTTON_CLASS_NAMES = { root: classes.root, inner: classes.inner, label: classes.label };

/**
 * Mantine button that shows a loader and disables itself while an async `onClick` is pending.
 * An explicit `loading` prop wins. Defaults: size `sm`, variant `light`; other props go to Mantine.
 * The button shrinks to its container: a text label that does not fit is ellipsized and shown in a tooltip.
 */
function Button(props: ButtonProps) {
  const { size = 'sm', loading, onClick, disabled, onMouseEnter, children, ...restProps } = props;

  const { isLoading, onClickButton } = useAutoLoading(onClick, loading);
  const [truncated, setTruncated] = useState(false);

  // Measured on hover only, so nothing runs on render or resize.
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
