import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFieldError } from '@/common/utils/stringUtils';

/**
 * Trả về hàm định dạng chuyển mã kiểm tra dữ liệu thô (`V000001`, `V000002:255`, ...) thành thông báo đã dịch.
 *
 * Đăng ký component gọi hàm với i18next để các thông báo đang hiển thị được render lại
 * bằng câu chữ mới khi ngôn ngữ thay đổi.
 */
export function useFieldError() {
  const { t } = useTranslation('validateMessage');

  return useCallback(
    (error: React.ReactNode, label: React.ReactNode): React.ReactNode =>
      typeof error === 'string' ? formatFieldError(error, label, t) : error,
    [t]
  );
}
