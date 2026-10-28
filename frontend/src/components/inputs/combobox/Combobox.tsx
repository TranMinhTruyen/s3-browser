import {
  CSSProperties,
  Group,
  Input,
  InputBase,
  InputBaseProps,
  Combobox as MCombobox,
  ComboboxProps as MComboboxProps,
  Text,
} from '@mantine/core';
import { GetInputPropsReturnType } from '@mantine/form';
import { useElementSize } from '@mantine/hooks';
import { CheckIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useFieldError } from '@/common/hooks/useFieldError';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ComboboxClearButton from '@/components/inputs/combobox/ComboboxClearButton';
import { useSelectCombobox } from '@/components/inputs/combobox/useSelectCombobox';

type ComboboxItem = { name: string; value: string };

type ComboboxProps = Omit<MComboboxProps, 'store' | 'onOptionSubmit' | 'children'> &
  Omit<Partial<GetInputPropsReturnType>, 'onChange' | 'value'> & {
    label?: string;
    data: ComboboxItem[];
    value?: string | null;
    defaultValue?: string | null;
    withAsterisk?: boolean;
    disabled?: boolean;
    onChange?: (value: string | null) => void;
    className?: string;
    style?: CSSProperties;
    inputClassNames?: InputBaseProps['classNames'];
    inputStyles?: InputBaseProps['styles'];
  };

const ComboboxOption = memo(function ComboboxOption({ item, active }: { item: ComboboxItem; active: boolean }) {
  return (
    <MCombobox.Option value={item.value} active={active}>
      <Group gap="xs" wrap="nowrap">
        {active && <CheckIcon size={12} />}
        <Text>{item.name}</Text>
      </Group>
    </MCombobox.Option>
  );
});

/**
 * Single-select dropdown over `data` (`name` is shown, `value` is stored). Works controlled (`value`)
 * or uncontrolled (`defaultValue`), and can be spread with Mantine form `getInputProps`.
 */
function Combobox(props: ComboboxProps) {
  const {
    label,
    data,
    value,
    defaultValue,
    withAsterisk,
    disabled,
    error,
    onChange,
    onFocus,
    onBlur,
    className,
    style,
    inputClassNames,
    inputStyles,
    ...rest
  } = props;

  const { combobox, current, onSubmitOption, onClear, onClickToggle } = useSelectCombobox({
    value,
    defaultValue,
    onChange,
  });

  const { ref: targetRef, width: targetWidth } = useElementSize<HTMLButtonElement>();

  const formatError = useFieldError();
  const translatedError = formatError(error, label);
  const itemsByValue = useMemo(() => new Map(data.map(item => [item.value, item])), [data]);

  const selected = !isNullOrEmpty(current) ? itemsByValue.get(current) : undefined;
  const showClear = !isNullOrEmpty(current) && !disabled;

  return (
    <MCombobox
      store={combobox}
      resetSelectionOnOptionHover
      onOptionSubmit={onSubmitOption}
      width="max-content"
      position="bottom-start"
      {...rest}
    >
      <MCombobox.Target targetType="button">
        <InputBase
          ref={targetRef}
          component="button"
          type="button"
          className={className}
          style={style}
          classNames={inputClassNames}
          styles={inputStyles}
          pointer
          label={label}
          error={translatedError}
          withAsterisk={withAsterisk}
          disabled={disabled}
          onFocus={onFocus}
          onBlur={onBlur}
          rightSection={showClear ? <ComboboxClearButton onClear={onClear} /> : <MCombobox.Chevron />}
          rightSectionPointerEvents={showClear ? 'all' : 'none'}
          onClick={onClickToggle}
        >
          {selected ? <Text truncate="end">{selected.name}</Text> : <Input.Placeholder>{label}</Input.Placeholder>}
        </InputBase>
      </MCombobox.Target>

      <MCombobox.Dropdown miw={targetWidth}>
        <MCombobox.Options mah={250} style={{ overflowY: 'auto' }}>
          {data.map(item => (
            <ComboboxOption key={item.value} item={item} active={item.value === current} />
          ))}
        </MCombobox.Options>
      </MCombobox.Dropdown>
    </MCombobox>
  );
}
export default Combobox;
