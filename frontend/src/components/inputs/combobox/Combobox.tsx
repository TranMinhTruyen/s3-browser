import {
  CloseButton,
  CSSProperties,
  Group,
  Input,
  InputBase,
  InputBaseProps,
  Combobox as MCombobox,
  ComboboxProps as MComboboxProps,
  Text,
  useCombobox,
} from '@mantine/core';
import { GetInputPropsReturnType } from '@mantine/form';
import { useElementSize, useUncontrolled } from '@mantine/hooks';
import { CheckIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldError } from '@/common/hooks/useFieldError';
import { isNullOrEmpty } from '@/common/utils/stringUtils';

type ComboboxProps = Omit<MComboboxProps, 'store' | 'onOptionSubmit' | 'children'> &
  Omit<Partial<GetInputPropsReturnType>, 'onChange' | 'value'> & {
    label?: string;
    data: { name: string; value: string }[];
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

const ComboboxOption = memo(function ComboboxOption({
  item,
  active,
}: {
  item: { name: string; value: string };
  active: boolean;
}) {
  return (
    <MCombobox.Option value={item.value} active={active}>
      <Group gap="xs" wrap="nowrap">
        {active && <CheckIcon size={12} />}
        <Text>{item.name}</Text>
      </Group>
    </MCombobox.Option>
  );
});

function Combobox(props: ComboboxProps) {
  const { t } = useTranslation();
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

  const [_value, handleChange] = useUncontrolled<string | null>({
    value,
    defaultValue,
    finalValue: null,
    onChange,
  });

  const { ref: targetRef, width: targetWidth } = useElementSize<HTMLButtonElement>();

  const formatError = useFieldError();
  const translatedError = formatError(error, 'label' in props ? props.label : undefined);
  const itemsByValue = useMemo(() => {
    const set = new Map<string, { name: string; value: string }>();
    data.forEach(item => set.set(item.value, item));
    return set;
  }, [data]);

  const selected = !isNullOrEmpty(_value) ? itemsByValue.get(_value) : undefined;
  const showClear = !isNullOrEmpty(_value) && !disabled;

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: eventSource => {
      if (eventSource === 'keyboard') {
        combobox.selectActiveOption();
      } else {
        combobox.updateSelectedOptionIndex('active');
      }
    },
  });

  return (
    <MCombobox
      store={combobox}
      resetSelectionOnOptionHover
      onOptionSubmit={val => {
        handleChange(val);
        combobox.updateSelectedOptionIndex('active');
        combobox.closeDropdown();
      }}
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
          rightSection={
            showClear ? (
              <CloseButton
                size="sm"
                variant="transparent"
                aria-label={t('common:button.clear')}
                onMouseDown={event => event.preventDefault()}
                onClick={event => {
                  event.stopPropagation();
                  handleChange(null);
                  combobox.resetSelectedOption();
                }}
              />
            ) : (
              <MCombobox.Chevron />
            )
          }
          rightSectionPointerEvents={showClear ? 'all' : 'none'}
          onClick={() => combobox.toggleDropdown()}
        >
          {selected ? <Text truncate="end">{selected.name}</Text> : <Input.Placeholder>{label}</Input.Placeholder>}
        </InputBase>
      </MCombobox.Target>

      <MCombobox.Dropdown miw={targetWidth}>
        <MCombobox.Options mah={250} style={{ overflowY: 'auto' }}>
          {data.map(item => (
            <ComboboxOption key={item.value} item={item} active={item.value === _value} />
          ))}
        </MCombobox.Options>
      </MCombobox.Dropdown>
    </MCombobox>
  );
}
export default Combobox;
