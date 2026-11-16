import { useTranslation } from 'react-i18next';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';
import FilePathField from '@/pages/s3/modals/connect/fields/FilePathField';

/** Extra trusted CA of a MinIO server with a self-signed or internal certificate (any authentication method). */
function CaFileField({ form }: Pick<AuthFieldsProps, 'form'>) {
  const { t } = useTranslation('connectModal');

  return (
    <FilePathField
      form={form}
      name="authConfig.caFile"
      kind="ca"
      label={t('form.label.caFile')}
      placeholder={t('form.placeholder.caFile')}
      description={t('form.hint.caFile')}
      clearable
    />
  );
}

export default CaFileField;
