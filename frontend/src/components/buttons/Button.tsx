import { type ElementProps, Button as MButton, type ButtonProps as MButtonProps } from '@mantine/core';
import { useState } from 'react';

interface ButtonProps extends MButtonProps, ElementProps<'button', keyof MButtonProps> {}

function Button(props: ButtonProps) {
  const { size = 'sm', loading, onClick, disabled, ...restProps } = props;

  const [autoLoading, setAutoLoading] = useState(false);

  /**
   *  Auto-manages loading state when onClick returns a Promise (async handler)
   */
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const result = onClick?.(event) as unknown;

    // Return early if onClick didn't return a Promise (i.e. it ran synchronously)
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return;

    setAutoLoading(true);
    void (result as Promise<unknown>).finally(() => setAutoLoading(false));
  };

  // Prefer explicit `loading` prop if provided; otherwise fall back to auto-tracked state
  const isLoading = loading ?? autoLoading;

  return (
    <MButton
      variant={'light'}
      size={size}
      loading={isLoading}
      disabled={disabled || isLoading}
      onClick={handleClick}
      {...restProps}
    />
  );
}

Button.Group = MButton.Group;
Button.GroupSection = MButton.GroupSection;

export default Button;
