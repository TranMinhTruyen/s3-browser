import { Button as MButton, ButtonProps as MButtonProps } from '@mantine/core';

type ButtonProps = MButtonProps & {};

function Button(props: ButtonProps) {
  const { size = 'sm', ...restProps } = props;

  return (
    <>
      <MButton variant={'light'} size={size} {...restProps}></MButton>
    </>
  );
}
export default Button;
