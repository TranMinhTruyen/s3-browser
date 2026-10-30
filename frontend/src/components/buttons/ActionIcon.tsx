import { ElementProps, ActionIcon as MActionIcon, ActionIconProps as MActionIconProps } from '@mantine/core';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';

interface ActionIconProps extends MActionIconProps, ElementProps<'button', keyof MActionIconProps> {}

/**
 * Mantine action icon that shows a loader and disables itself while an async `onClick` is pending.
 * An explicit `loading` prop wins. Defaults: size `lg`, variant `light`; other props go to Mantine.
 */
function ActionIcon(props: ActionIconProps) {
  const { size = 'lg', loading, onClick, disabled, ...restProps } = props;

  const { isLoading, onClickButton } = useAutoLoading(onClick, loading);

  return (
    <MActionIcon
      variant={'light'}
      size={size}
      loading={isLoading}
      disabled={disabled || isLoading}
      onClick={onClickButton}
      {...restProps}
    />
  );
}

ActionIcon.Group = MActionIcon.Group;
ActionIcon.GroupSection = MActionIcon.GroupSection;

export default ActionIcon;
