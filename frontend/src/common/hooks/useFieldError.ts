import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFieldError } from '@/common/utils/stringUtils';

/**
 * Returns a formatter that turns a raw validation code (`V000001`, `V000002:255`, ...)
 * into a translated message.
 *
 * Subscribes the calling component to i18next, so messages already on screen are
 * re-rendered with the new wording when the language changes.
 */
export function useFieldError() {
  const { t } = useTranslation('validateMessage');

  return useCallback(
    (error: React.ReactNode, label: React.ReactNode): React.ReactNode =>
      typeof error === 'string' ? formatFieldError(error, label, t) : error,
    [t]
  );
}
