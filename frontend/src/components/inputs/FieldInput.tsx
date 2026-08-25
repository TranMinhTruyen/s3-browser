import {
  NumberInput,
  type NumberInputProps,
  PasswordInput,
  type PasswordInputProps,
  Textarea,
  type TextareaProps,
  TextInput,
  type TextInputProps,
} from '@mantine/core';

type TextFieldProps = Omit<TextInputProps, 'type'> & {
  type?: 'text' | 'email' | 'url' | 'tel' | 'search';
};

type TextareaFieldProps = Omit<TextareaProps, 'type'> & {
  type: 'textarea';
};

type PasswordFieldProps = Omit<PasswordInputProps, 'type'> & {
  type: 'password';
};

type NumberFieldProps = Omit<NumberInputProps, 'type'> & {
  type: 'number';
};

type FieldProps = TextFieldProps | TextareaFieldProps | PasswordFieldProps | NumberFieldProps;

function FieldInput(props: FieldProps) {
  const { size = 'sm' } = props;
  switch (props.type) {
    case 'textarea': {
      const { type: _type, ...rest } = props;
      return <Textarea size={size} {...rest} />;
    }
    case 'password': {
      const { type: _type, ...rest } = props;
      return <PasswordInput size={size} {...rest} />;
    }
    case 'number': {
      const { type: _type, ...rest } = props;
      return <NumberInput size={size} {...rest} />;
    }
    default:
      return <TextInput size={size} {...props} />;
  }
}
export default FieldInput;
