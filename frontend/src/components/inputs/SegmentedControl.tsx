import { SegmentedControl as MSegmentedControl, SegmentedControlProps as MSegmentedControlProps } from '@mantine/core';

type SegmentedControlProps = MSegmentedControlProps & {};

function SegmentedControl(props: SegmentedControlProps) {
  const { ...rest } = props;
  return <MSegmentedControl {...rest} />;
}

export default SegmentedControl;
