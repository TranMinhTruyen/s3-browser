import { useCombobox } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import { useCallback } from 'react';

type UseSelectComboboxOptions = {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  // Focus the search box when the dropdown opens.
  focusSearch?: boolean;
  // Runs on every close path (Escape, trigger click, outside click, option submit).
  onClose?: () => void;
};

/**
 * Shared state of the single-select comboboxes: a controlled/uncontrolled value plus the Mantine
 * combobox store, wired so the active option is highlighted when the dropdown opens.
 */
export function useSelectCombobox({ value, defaultValue, onChange, focusSearch, onClose }: UseSelectComboboxOptions) {
  const [current, handleChange] = useUncontrolled<string | null>({ value, defaultValue, finalValue: null, onChange });

  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      onClose?.();
    },
    onDropdownOpen: eventSource => {
      if (focusSearch) combobox.focusSearchInput();
      if (eventSource === 'keyboard') {
        combobox.selectActiveOption();
      } else {
        combobox.updateSelectedOptionIndex('active');
      }
    },
  });

  const { closeDropdown, resetSelectedOption, toggleDropdown, updateSelectedOptionIndex } = combobox;

  const onSubmitOption = useCallback(
    (val: string) => {
      handleChange(val);
      updateSelectedOptionIndex('active');
      closeDropdown();
    },
    [handleChange, updateSelectedOptionIndex, closeDropdown]
  );

  const onClear = useCallback(() => {
    handleChange(null);
    resetSelectedOption();
  }, [handleChange, resetSelectedOption]);

  const onClickToggle = useCallback(() => toggleDropdown(), [toggleDropdown]);

  return { combobox, current, onSubmitOption, onClear, onClickToggle };
}
