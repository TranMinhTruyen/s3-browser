import { ElementProps, ActionIcon as MActionIcon, ActionIconProps as MActionIconProps } from '@mantine/core';
import { useState } from 'react';

interface ActionIconProps extends MActionIconProps, ElementProps<'button', keyof MActionIconProps> {}

function ActionIcon(props: ActionIconProps) {
  const { size = 'lg', loading, onClick, disabled, ...restProps } = props;

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
    <MActionIcon
      variant={'light'}
      size={size}
      loading={isLoading}
      disabled={disabled || isLoading}
      onClick={handleClick}
      {...restProps}
    />
  );
}

ActionIcon.Group = MActionIcon.Group;
ActionIcon.GroupSection = MActionIcon.GroupSection;

export default ActionIcon;
