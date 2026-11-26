import {
  Box,
  type ElementProps,
  ActionIcon as MActionIcon,
  type ActionIconProps as MActionIconProps,
  Tooltip,
} from '@mantine/core';
import { useAutoLoading } from '@/common/hooks/useAutoLoading';
import classes from '@/components/buttons/ActionIcon.module.css';

interface ActionIconProps extends MActionIconProps, ElementProps<'button', keyof MActionIconProps> {
  /** Văn bản đã dịch hiển thị khi rê chuột; đồng thời là `aria-label` mặc định. */
  tooltip: string;
}

/**
 * Biểu tượng thao tác của Mantine luôn có tooltip, đồng thời hiện trạng thái tải và tự vô hiệu hóa khi `onClick` bất đồng bộ
 * đang chờ. Prop `loading` tường minh được ưu tiên. Mặc định: size `lg`, variant `light`.
 * Nút luôn được bọc trong span (đích của tooltip vì trình duyệt không gửi sự kiện rê chuột đến nút bị vô hiệu hóa),
 * nhờ đó đổi disabled/loading không mount lại nút. Các prop lề (`m`, `mx`, `ml`, ...) và `style` áp dụng cho span,
 * phần tử bố cục thực tế; các prop khác (kể cả `ref` và `className`) được chuyển cho nút Mantine.
 * Ẩn tooltip khi nút có `aria-expanded` (ví dụ `Menu.Target`) để không che danh sách thả xuống.
 */
function ActionIcon(props: ActionIconProps) {
  const {
    tooltip,
    size = 'lg',
    loading,
    onClick,
    disabled,
    className,
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
          className={className ? `${classes.root} ${className}` : classes.root}
          {...restProps}
        />
      </Box>
    </Tooltip>
  );
}

ActionIcon.Group = MActionIcon.Group;
ActionIcon.GroupSection = MActionIcon.GroupSection;

export default ActionIcon;
