import { CloseButton } from '@mantine/core';
import { MouseEvent, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type ComboboxClearButtonProps = {
  onClear: () => void;
};

/** Close button shown inside a combobox target to clear the selection without toggling the dropdown. */
function ComboboxClearButton({ onClear }: ComboboxClearButtonProps) {
  const { t } = useTranslation('common');

  // Keep the target button from taking focus.
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
