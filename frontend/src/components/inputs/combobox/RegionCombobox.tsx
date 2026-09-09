import { CheckIcon, CloseButton, Combobox, ComboboxProps, Group, Input, InputBase, useCombobox } from '@mantine/core';
import { GetInputPropsReturnType } from '@mantine/form';
import { useUncontrolled } from '@mantine/hooks';
import { MasterOutput } from '@wails/S3Browser/models/master';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldError } from '@/common/hooks/useFieldError';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { isNullOrEmpty } from '@/common/utils/stringUtils';

type RegionOptionProps = {
  item: MasterOutput;
  active: boolean;
};

const RegionOption = memo(function RegionOption({ item, active }: RegionOptionProps) {
  return (
    <Combobox.Option value={item.value1} active={active}>
      <Group gap="xs">
        {active && <CheckIcon size={12} />}
        <span>{item.name}</span>
        <span>[{item.value1}]</span>
      </Group>
    </Combobox.Option>
  );
});

type RegionComboboxProps = Omit<ComboboxProps, 'store' | 'onOptionSubmit' | 'children'> &
  Omit<Partial<GetInputPropsReturnType>, 'onChange' | 'value'> & {
    value?: string | null;
    defaultValue?: string | null;
    withAsterisk?: boolean;
    disabled?: boolean;
    onChange?: (value: string | null) => void;
  };

function RegionCombobox(props: RegionComboboxProps) {
  const { value, defaultValue, withAsterisk, disabled, error, onChange, onFocus, onBlur, ...rest } = props;

  const [_value, handleChange] = useUncontrolled<string | null>({
    value,
    defaultValue,
    finalValue: null,
    onChange,
  });

  const { t } = useTranslation('inputs');

  const formatError = useFieldError();
  const fieldLabel = t('regionCombobox.label');
  const translatedError = formatError(error, fieldLabel);
  const regionData = useMasterDataStore(m => m.regionData);
  const itemsByValue = useMemo(() => {
    const map = new Map<string, MasterOutput>();
    Object.values(regionData).forEach(items => items?.forEach(item => map.set(item.value1, item)));
    return map;
  }, [regionData]);

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

  const sortedGroups = useMemo(
    () =>
      Object.entries(regionData).map(
        ([region, items]) =>
          [region, [...(items ?? [])].sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity))] as const
      ),
    [regionData]
  );

  const options = sortedGroups.map(([region, items]) => (
    <Combobox.Group key={region} label={t(`regionCombobox.availabilityZones.${region}`)}>
      {items.map(item => (
        <RegionOption key={item.value1} item={item} active={item.value1 === _value} />
      ))}
    </Combobox.Group>
  ));

  return (
    <Combobox
      store={combobox}
      resetSelectionOnOptionHover
      onOptionSubmit={val => {
        handleChange(val);
        combobox.updateSelectedOptionIndex('active');
        combobox.closeDropdown();
      }}
      {...rest}
    >
      <Combobox.Target targetType="button">
        <InputBase
          component="button"
          type="button"
          pointer
          label={fieldLabel}
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
                aria-label="Clear region"
                onMouseDown={event => event.preventDefault()}
                onClick={event => {
                  event.stopPropagation();
                  handleChange(null);
                  combobox.resetSelectedOption();
                }}
              />
            ) : (
              <Combobox.Chevron />
            )
          }
          rightSectionPointerEvents={showClear ? 'all' : 'none'}
          onClick={() => combobox.toggleDropdown()}
        >
          {selected ? (
            <>
              <Group gap="xs">
                <span>{selected.name}</span>
                <span>[{selected.value1}]</span>
              </Group>
            </>
          ) : (
            <Input.Placeholder>{t('regionCombobox.placeholder')}</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options mah={250} style={{ overflowY: 'auto' }}>
          {options}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default RegionCombobox;
