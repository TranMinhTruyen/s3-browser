import { SegmentedControl as MSegmentedControl, SegmentedControlProps } from '@mantine/core';

/** Thin wrapper over Mantine `SegmentedControl`. */
function SegmentedControl(props: SegmentedControlProps) {
  return <MSegmentedControl {...props} />;
}

export default SegmentedControl;
