import { CheckIcon, Combobox, ComboboxProps, Group, Input, InputBase } from '@mantine/core';
import { GetInputPropsReturnType } from '@mantine/form';
import { MasterOutput } from '@wails/S3Browser/models/master';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldError } from '@/common/hooks/useFieldError';
import { useSelectCombobox } from '@/common/hooks/useSelectCombobox';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import ComboboxClearButton from '@/components/inputs/combobox/ComboboxClearButton';

type RegionOptionProps = {
  item: MasterOutput;
  active: boolean;
};

const RegionOption = memo(function RegionOption({ item, active }: RegionOptionProps) {
  return (
    <Combobox.Option value={item.value1 ?? ''} active={active}>
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

/** Single-select dropdown of cloud regions from the master data, grouped by availability zone. */
function RegionCombobox(props: RegionComboboxProps) {
  const { value, defaultValue, withAsterisk, disabled, error, onChange, onFocus, onBlur, ...rest } = props;

  const { combobox, current, onSubmitOption, onClear, onClickToggle } = useSelectCombobox({
    value,
    defaultValue,
    onChange,
  });

  const { t } = useTranslation('inputs');

  const formatError = useFieldError();
  const fieldLabel = t('regionCombobox.label');
  const translatedError = formatError(error, fieldLabel);
  const regionData = useMasterDataStore(m => m.regionData);
  const itemsByValue = useMemo(() => {
    const map = new Map<string, MasterOutput>();
    Object.values(regionData).forEach(items =>
      items?.forEach(item => {
        if (item.value1) {
          map.set(item.value1, item);
        }
      })
    );
    return map;
  }, [regionData]);

  const selected = !isNullOrEmpty(current) ? itemsByValue.get(current) : undefined;
  const showClear = !isNullOrEmpty(current) && !disabled;

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
        <RegionOption key={item.value1} item={item} active={item.value1 === current} />
      ))}
    </Combobox.Group>
  ));

  return (
    <Combobox store={combobox} resetSelectionOnOptionHover onOptionSubmit={onSubmitOption} {...rest}>
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
          rightSection={showClear ? <ComboboxClearButton onClear={onClear} /> : <Combobox.Chevron />}
          rightSectionPointerEvents={showClear ? 'all' : 'none'}
          onClick={onClickToggle}
        >
          {selected ? (
            <Group gap="xs">
              <span>{selected.name}</span>
              <span>[{selected.value1}]</span>
            </Group>
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
