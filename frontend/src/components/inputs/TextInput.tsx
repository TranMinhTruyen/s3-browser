import { TextInput as MTextInput, TextInputProps as MTextInputProps } from '@mantine/core';

type TextInputProps = MTextInputProps & {};

function TextInput(props: TextInputProps) {
  const { size = 'sm', ...restProps } = props;

  return (
    <>
      <MTextInput size={size} {...restProps}></MTextInput>
    </>
  );
}
export default TextInput;
