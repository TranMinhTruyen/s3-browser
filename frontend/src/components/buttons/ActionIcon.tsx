import {
  Box,
  type ElementProps,
  ActionIcon as MActionIcon,
  type ActionIconProps as MActionIconProps,
  Tooltip,
} from '@mantine/core';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';

interface ActionIconProps extends MActionIconProps, ElementProps<'button', keyof MActionIconProps> {
  /** Translated text shown on hover; also the default `aria-label`. */
  tooltip: string;
}

/**
 * Mantine action icon that always has a tooltip, and shows a loader and disables itself while an async `onClick`
 * is pending. An explicit `loading` prop wins. Defaults: size `lg`, variant `light`.
 * The button is always wrapped in a span (the tooltip target, since browsers send no hover events to a disabled
 * button), so toggling disabled/loading never remounts it. Margin props (`m`, `mx`, `ml`, ...) and `style` apply to
 * that span, the real layout item; every other prop (including `ref` and `className`) goes to the Mantine button.
 * The tooltip is hidden while the button is `aria-expanded` (e.g. a `Menu.Target`) to avoid covering the dropdown.
 */
function ActionIcon(props: ActionIconProps) {
  const {
    tooltip,
    size = 'lg',
    loading,
    onClick,
    disabled,
    style,
    m,
    mx,
    my,
    mt,
    mb,
    ml,
    mr,
    ms,
    me,
    ...restProps
  } = props;

  const { isLoading, onClickButton } = useAutoLoading(onClick, loading);
  const isDisabled = !!disabled || isLoading;

  return (
    <Tooltip label={tooltip} openDelay={300} withinPortal disabled={!!restProps['aria-expanded']}>
      <Box component="span" display="inline-flex" style={style} {...{ m, mx, my, mt, mb, ml, mr, ms, me }}>
        <MActionIcon
          variant={'light'}
          size={size}
          aria-label={tooltip}
          loading={isLoading}
          disabled={isDisabled}
          onClick={onClickButton}
          {...restProps}
        />
      </Box>
    </Tooltip>
  );
}

ActionIcon.Group = MActionIcon.Group;
ActionIcon.GroupSection = MActionIcon.GroupSection;

export default ActionIcon;
