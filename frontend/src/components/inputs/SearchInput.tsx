import { Group } from '@mantine/core';
import { Search, X } from 'lucide-react';
import { ChangeEvent, KeyboardEvent, memo, useCallback, useState } from 'react';
import ActionIcon from '@/components/buttons/ActionIcon';
import FieldInput from '@/components/inputs/FieldInput';

type SearchInputProps = {
  // Initial text. To reset the text box from outside, remount the component with a new `key`.
  value?: string;
  placeholder?: string;
  searchLabel: string;
  clearLabel: string;
  disabled?: boolean;
  // Called with the trimmed, non-empty keyword.
  onSearch: (keyword: string) => void;
  // Called when the keyword is cleared or submitted empty.
  onClear: () => void;
};

/** Search box with a clear button and a search button; Enter or the button submits the trimmed text. */
function SearchInput(props: SearchInputProps) {
  const { value = '', placeholder, searchLabel, clearLabel, disabled, onSearch, onClear } = props;

  const [text, setText] = useState(value);

  const onChangeText = useCallback((e: ChangeEvent<HTMLInputElement>) => setText(e.currentTarget.value), []);

  const onSubmitSearch = useCallback(() => {
    if (disabled) return;
    const keyword = text.trim();
    if (keyword) onSearch(keyword);
    else onClear();
  }, [disabled, text, onSearch, onClear]);

  const onKeyDownText = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') onSubmitSearch();
    },
    [onSubmitSearch]
  );

  const onClickClear = useCallback(() => {
    setText('');
    onClear();
  }, [onClear]);

  return (
    <Group gap="xs" wrap="nowrap">
      <FieldInput
        type="search"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChangeText}
        onKeyDown={onKeyDownText}
        rightSection={
          text && !disabled ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClickClear} tooltip={clearLabel}>
              <X />
            </ActionIcon>
          ) : null
        }
      />
      <ActionIcon onClick={onSubmitSearch} tooltip={searchLabel} disabled={disabled}>
        <Search />
      </ActionIcon>
    </Group>
  );
}
export default memo(SearchInput);
