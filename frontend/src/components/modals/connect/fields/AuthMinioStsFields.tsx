import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';
import AuthDurationField from '@/components/modals/connect/fields/AuthDurationField';
import AuthStaticFields from '@/components/modals/connect/fields/AuthStaticFields';

/** MinIO STS AssumeRole: the access/secret key that asks for temporary credentials, duration and inline policy. */
function AuthMinioStsFields(props: AuthFieldsProps) {
  const { form } = props;
  const { t } = useTranslation('connectModal');

  return (
    <>
      <AuthStaticFields {...props} withSessionToken={false} />

      <AuthDurationField form={form} />

      <FieldInput
        type="textarea"
        label={t('form.label.policy')}
        placeholder={t('form.placeholder.policy')}
        autosize
        minRows={3}
        maxRows={8}
        spellCheck={false}
        key={form.key('authConfig.policy')}
        {...form.getInputProps('authConfig.policy')}
      />
    </>
  );
}

export default AuthMinioStsFields;
