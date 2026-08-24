import { type ElementProps, Button as MButton, type ButtonProps as MButtonProps } from '@mantine/core';

interface ButtonProps extends MButtonProps, ElementProps<'button', keyof MButtonProps> {}

function Button(props: ButtonProps) {
  const { size = 'sm', ...restProps } = props;

  return (
    <>
      <MButton variant={'light'} size={size} {...restProps}></MButton>
    </>
  );
}
export default Button;
