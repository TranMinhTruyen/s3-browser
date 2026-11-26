import { SegmentedControl as MSegmentedControl, SegmentedControlProps, useMantineTheme } from '@mantine/core';
import classes from './segmentedControl.module.css';

/** Lớp bọc mỏng quanh `SegmentedControl` của Mantine; văn bản nhãn được căn giữa theo chiều cao chữ hoa. */
function SegmentedControl(props: SegmentedControlProps) {
  const theme = useMantineTheme();
  // Giữ nguyên classNames của nơi gọi (object hoặc function); nối thêm class riêng cho từng phần tử.
  const given = typeof props.classNames === 'function' ? props.classNames(theme, props, undefined) : props.classNames;
  const classNames = {
    ...given,
    label: [given?.label, classes.label].filter(Boolean).join(' '),
    innerLabel: [given?.innerLabel, classes.innerLabel].filter(Boolean).join(' '),
  };
  return <MSegmentedControl {...props} classNames={classNames} />;
}

export default SegmentedControl;
