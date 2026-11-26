import { useCombobox } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import { useCallback } from 'react';

type UseSelectComboboxOptions = {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  // Đưa tiêu điểm vào ô tìm kiếm khi danh sách thả xuống mở.
  focusSearch?: boolean;
  // Chạy với mọi cách đóng (Escape, nhấn nút mở, nhấn bên ngoài hoặc chọn mục).
  onClose?: () => void;
};

/**
 * State dùng chung cho các combobox chọn một mục: giá trị được điều khiển/không điều khiển cùng store combobox của Mantine,
 * được kết nối để làm nổi bật lựa chọn đang hoạt động khi danh sách thả xuống mở.
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
