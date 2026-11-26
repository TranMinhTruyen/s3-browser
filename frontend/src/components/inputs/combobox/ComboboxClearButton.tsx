import { CloseButton } from '@mantine/core';
import { MouseEvent, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type ComboboxClearButtonProps = {
  onClear: () => void;
};

/** Nút đóng bên trong đích combobox, dùng để xóa lựa chọn mà không bật/tắt danh sách thả xuống. */
function ComboboxClearButton({ onClear }: ComboboxClearButtonProps) {
  const { t } = useTranslation('common');

  // Ngăn nút đích nhận tiêu điểm.
  const onMouseDownClear = useCallback((event: MouseEvent<HTMLButtonElement>) => event.preventDefault(), []);

  const onClickClear = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClear();
    },
    [onClear]
  );

  return (
    <CloseButton
      size="sm"
      variant="transparent"
      aria-label={t('button.clear')}
      onMouseDown={onMouseDownClear}
      onClick={onClickClear}
    />
  );
}
export default memo(ComboboxClearButton);
