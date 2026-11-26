import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';

type AuthDurationFieldProps = Pick<AuthFieldsProps, 'form'> & {
  /** Bắt buộc với `assumeRole`; tùy chọn (để trống = mặc định máy chủ) với các phương thức MinIO. */
  required?: boolean;
};

/** Thời lượng phiên tính bằng giây (STS chấp nhận từ 900 đến 43200). */
function AuthDurationField({ form, required }: AuthDurationFieldProps) {
  const { t } = useTranslation('connectModal');

  return (
    <FieldInput
      type="number"
      label={t(required ? 'form.label.durationSeconds' : 'form.label.durationOptional')}
      placeholder={required ? undefined : t('form.placeholder.durationDefault')}
      withAsterisk={required}
      min={900}
      max={43200}
      allowDecimal={false}
      key={form.key('authConfig.durationSeconds')}
      {...form.getInputProps('authConfig.durationSeconds')}
    />
  );
}

export default AuthDurationField;
