import {
  ColorInput,
  ColorInputProps,
  JsonInput,
  type JsonInputProps,
  MaskInput,
  MaskInputProps,
  NumberInput,
  type NumberInputProps,
  PasswordInput,
  type PasswordInputProps,
  PinInput,
  PinInputProps,
  Textarea,
  type TextareaProps,
  TextInput,
  type TextInputProps,
} from '@mantine/core';
import { useFieldError } from '@/common/hooks/useFieldError';

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

type JsonFieldProps = Omit<JsonInputProps, 'type'> & {
  type: 'json';
};

type MaskFieldProps = Omit<MaskInputProps, 'type'> & {
  type: 'mask';
};

type PinFieldProps = Omit<PinInputProps, 'type'> & {
  type: 'pin';
};

type ColorFieldProps = Omit<ColorInputProps, 'type'> & {
  type: 'color';
};

type FieldInputProps =
  | TextFieldProps
  | TextareaFieldProps
  | PasswordFieldProps
  | NumberFieldProps
  | JsonFieldProps
  | MaskFieldProps
  | PinFieldProps
  | ColorFieldProps;

/**
 * Mantine text-like input chosen by `type` (text by default). Translates `error` through `useFieldError`;
 * `pin` and `color` do not show an error, so it is dropped for them.
 */
function FieldInput(props: FieldInputProps) {
  const { size = 'sm' } = props;

  const formatError = useFieldError();
  const translatedError = formatError(props.error, 'label' in props ? props.label : undefined);

  const restBase = { ...props, error: translatedError };

  switch (restBase.type) {
    case 'textarea': {
      const { type: _type, ...rest } = restBase;
      return <Textarea size={size} {...rest} />;
    }
    case 'password': {
      const { type: _type, ...rest } = restBase;
      return <PasswordInput size={size} {...rest} />;
    }
    case 'number': {
      const { type: _type, ...rest } = restBase;
      return <NumberInput size={size} {...rest} />;
    }
    case 'json': {
      const { type: _type, ...rest } = restBase;
      return <JsonInput size={size} {...rest} />;
    }
    case 'mask': {
      const { type: _type, ...rest } = restBase;
      return <MaskInput size={size} {...rest} />;
    }
    case 'pin': {
      const { type: _type, error: _error, ...rest } = restBase;
      return <PinInput {...rest} />;
    }
    case 'color': {
      const { type: _type, error: _error, ...rest } = restBase;
      return <ColorInput {...rest} />;
    }
    default:
      return <TextInput size={size} {...restBase} />;
  }
}
export default FieldInput;
