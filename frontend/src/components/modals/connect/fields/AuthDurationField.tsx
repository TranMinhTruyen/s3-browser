import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';

type AuthDurationFieldProps = Pick<AuthFieldsProps, 'form'> & {
  /** Required for `assumeRole`; optional (empty = server default) for the MinIO methods. */
  required?: boolean;
};

/** Session duration in seconds (STS allows 900 to 43200). */
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
