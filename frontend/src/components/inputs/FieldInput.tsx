import {
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
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatString } from '@/common/utils/stringUtils';

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

type FieldProps =
  | TextFieldProps
  | TextareaFieldProps
  | PasswordFieldProps
  | NumberFieldProps
  | JsonFieldProps
  | MaskFieldProps
  | PinFieldProps;

function formatFieldError(rawError: string, label: React.ReactNode, t: TFunction): string {
  const [code, paramsStr] = rawError.split(':');
  const template = t(code, { defaultValue: code });
  if (typeof template !== 'string') return rawError;

  const params = [String(label), ...(paramsStr ? paramsStr.split(',') : [])];
  return formatString(template, ...params);
}

function FieldInput(props: FieldProps) {
  const { size = 'sm' } = props;

  const { t } = useTranslation('validateMessage');

  const translatedError = typeof props.error === 'string' ? formatFieldError(props.error, props.label, t) : props.error;

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
    default:
      return <TextInput size={size} {...restBase} />;
  }
}
export default FieldInput;
