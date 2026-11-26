import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';
import AuthDurationField from '@/pages/s3/modals/connect/fields/AuthDurationField';
import AuthStaticFields from '@/pages/s3/modals/connect/fields/AuthStaticFields';

/** MinIO STS AssumeRole: access key/secret key dùng để yêu cầu thông tin xác thực tạm thời, thời hạn và policy nhúng. */
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
