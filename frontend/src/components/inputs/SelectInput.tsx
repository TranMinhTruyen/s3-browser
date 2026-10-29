import { Select, SelectProps } from '@mantine/core';

/** Thin wrapper over Mantine `Select`. */
function SelectInput(props: SelectProps) {
  return <Select {...props} />;
}
export default SelectInput;
