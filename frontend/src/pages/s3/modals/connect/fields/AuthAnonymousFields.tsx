import { useTranslation } from 'react-i18next';
import TagsInput from '@/components/inputs/TagsInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';

/** Quyền truy cập ẩn danh không thể liệt kê bucket nên người dùng nhập tên các bucket muốn mở. */
function AuthAnonymousFields({ form }: Pick<AuthFieldsProps, 'form'>) {
  const { t } = useTranslation('connectModal');

  return (
    <TagsInput
      label={t('form.label.buckets')}
      description={t('form.hint.anonymousBuckets')}
      placeholder={t('form.placeholder.buckets')}
      withAsterisk
      splitChars={[',', ' ']}
      key={form.key('authConfig.buckets')}
      {...form.getInputProps('authConfig.buckets')}
    />
  );
}

export default AuthAnonymousFields;
