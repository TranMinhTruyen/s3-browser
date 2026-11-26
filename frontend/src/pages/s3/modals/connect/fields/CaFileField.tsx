import { useTranslation } from 'react-i18next';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';
import FilePathField from '@/pages/s3/modals/connect/fields/FilePathField';

/** CA tin cậy bổ sung của máy chủ MinIO dùng chứng chỉ tự ký hoặc chứng chỉ nội bộ (mọi phương thức xác thực). */
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
