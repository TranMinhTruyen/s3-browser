import { Checkbox, CheckboxProps } from '@mantine/core';

type CheckBoxInputProps = Omit<CheckboxProps, ''> & {};

function CheckBoxInput(props: CheckBoxInputProps) {
  const { ...rest } = props;
  return <Checkbox {...rest} />;
}
export default CheckBoxInput;
