import { SegmentedControl as MSegmentedControl, SegmentedControlProps, useMantineTheme } from '@mantine/core';
import classes from './segmentedControl.module.css';

/** Thin wrapper over Mantine `SegmentedControl`; the label text is centered on its cap height. */
function SegmentedControl(props: SegmentedControlProps) {
  const theme = useMantineTheme();
  // The caller's classNames (object or function) are kept; the own classes are appended per part.
  const given = typeof props.classNames === 'function' ? props.classNames(theme, props, undefined) : props.classNames;
  const classNames = {
    ...given,
    label: [given?.label, classes.label].filter(Boolean).join(' '),
    innerLabel: [given?.innerLabel, classes.innerLabel].filter(Boolean).join(' '),
  };
  return <MSegmentedControl {...props} classNames={classNames} />;
}

export default SegmentedControl;
