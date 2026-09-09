import { Switch, SwitchProps } from '@mantine/core';

type SwitchInputProps = Omit<SwitchProps, ''> & {};

function SwitchInput(props: SwitchInputProps) {
  const { ...rest } = props;
  return <Switch {...rest} />;
}
export default SwitchInput;
