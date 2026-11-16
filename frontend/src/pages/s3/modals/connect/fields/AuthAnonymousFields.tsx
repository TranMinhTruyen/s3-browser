import { useTranslation } from 'react-i18next';
import TagsInput from '@/components/inputs/TagsInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';

/** Anonymous access cannot list buckets, so the user enters the names of the buckets to open. */
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
