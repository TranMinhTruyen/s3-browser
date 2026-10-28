import { type ElementProps, Button as MButton, type ButtonProps as MButtonProps } from '@mantine/core';
import { useAutoLoading } from '@/components/buttons/useAutoLoading';

interface ButtonProps extends MButtonProps, ElementProps<'button', keyof MButtonProps> {}

/** Mantine button that shows a loader (and disables itself) while an async `onClick` is pending. */
function Button(props: ButtonProps) {
  const { size = 'sm', loading, onClick, disabled, ...restProps } = props;

  const { isLoading, onClickButton } = useAutoLoading(onClick, loading);

  return (
    <MButton
      variant={'light'}
      size={size}
      loading={isLoading}
      disabled={disabled || isLoading}
      onClick={onClickButton}
      {...restProps}
    />
  );
}

Button.Group = MButton.Group;
Button.GroupSection = MButton.GroupSection;

export default Button;
