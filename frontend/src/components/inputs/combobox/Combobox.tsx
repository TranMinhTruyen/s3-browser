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
import { ChangeEvent, memo, useCallback, useMemo, useState } from 'react';
import { useFieldError } from '@/common/hooks/useFieldError';
import { useSelectCombobox } from '@/common/hooks/useSelectCombobox';
import { isNullOrEmpty } from '@/common/utils/stringUtils';
import TruncatedText from '@/components/display/TruncatedText';
import ComboboxClearButton from '@/components/inputs/combobox/ComboboxClearButton';
import ComboboxOptions from '@/components/inputs/combobox/ComboboxOptions';

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
    // Khi được bật, hiện ô tìm kiếm ở đầu danh sách thả xuống để lọc các lựa chọn theo tên.
    searchPlaceholder?: string;
    emptyText?: string;
  };

const ComboboxOption = memo(function ComboboxOption({ item, active }: { item: ComboboxItem; active: boolean }) {
  return (
    <MCombobox.Option value={item.value} active={active}>
      <Group gap="xs" wrap="nowrap">
        {active && <CheckIcon size="0.75rem" />}
        <Text>{item.name}</Text>
      </Group>
    </MCombobox.Option>
  );
});

/**
 * Danh sách thả xuống cho phép chọn một mục từ `data` (`name` được hiển thị, `value` được lưu). Hỗ trợ dạng
 * có điều khiển (`value`) và không điều khiển (`defaultValue`), đồng thời dùng được với `getInputProps` của Mantine form.
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
    searchPlaceholder,
    emptyText,
    ...rest
  } = props;

  const hasSearch = searchPlaceholder !== undefined;
  const [keyword, setKeyword] = useState('');
  // Xóa bộ lọc ở mọi cách đóng để lần mở sau danh sách hiển thị đầy đủ.
  const onCloseDropdown = useCallback(() => setKeyword(''), []);

  const { combobox, current, onSubmitOption, onClear, onClickToggle } = useSelectCombobox({
    value,
    defaultValue,
    onChange,
    focusSearch: hasSearch,
    onClose: onCloseDropdown,
  });

  const { ref: targetRef, width: targetWidth } = useElementSize<HTMLButtonElement>();

  const formatError = useFieldError();
  const translatedError = formatError(error, label);
  const itemsByValue = useMemo(() => new Map(data.map(item => [item.value, item])), [data]);

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw ? data.filter(item => item.name.toLowerCase().includes(kw)) : data;
  }, [data, keyword]);

  const onChangeKeyword = useCallback((e: ChangeEvent<HTMLInputElement>) => setKeyword(e.currentTarget.value), []);

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
          {selected ? <TruncatedText>{selected.name}</TruncatedText> : <Input.Placeholder>{label}</Input.Placeholder>}
        </InputBase>
      </MCombobox.Target>

      <MCombobox.Dropdown style={{ minWidth: targetWidth }}>
        {hasSearch && <MCombobox.Search value={keyword} onChange={onChangeKeyword} placeholder={searchPlaceholder} />}
        <ComboboxOptions>
          {filteredData.map(item => (
            <ComboboxOption key={item.value} item={item} active={item.value === current} />
          ))}
          {filteredData.length === 0 && emptyText && <MCombobox.Empty>{emptyText}</MCombobox.Empty>}
        </ComboboxOptions>
      </MCombobox.Dropdown>
    </MCombobox>
  );
}
export default Combobox;
