import { Checkbox, CheckboxProps } from '@mantine/core';

/** Thin wrapper over Mantine `Checkbox`. */
function CheckBoxInput(props: CheckboxProps) {
  return <Checkbox {...props} />;
}
export default CheckBoxInput;
