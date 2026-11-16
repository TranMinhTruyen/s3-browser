import { Text } from '@mantine/core';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';
import FilePathField from '@/pages/s3/modals/connect/fields/FilePathField';

/** MinIO client certificate (mTLS): certificate and key files, plus the key password when the key has one. */
function AuthCertFields({ form, savedSecrets, secretRequired }: AuthFieldsProps) {
  const { t } = useTranslation('connectModal');
  const keyEncrypted = form.useWatchValue('authConfig.keyEncrypted');

  // A key without a password has nothing to type: drop what was typed.
  const onChangeKeyEncrypted = useCallback(
    ({ value }: { value: unknown }) => {
      if (!value) form.setFieldValue('authSecret.keyPassword', '');
    },
    [form]
  );
  form.watch('authConfig.keyEncrypted', onChangeKeyEncrypted);

  return (
    <>
      <FilePathField
        form={form}
        name="authConfig.certFile"
        kind="cert"
        label={t('form.label.certFile')}
        placeholder={t('form.placeholder.certFile')}
        withAsterisk
      />

      <FilePathField
        form={form}
        name="authConfig.keyFile"
        kind="key"
        label={t('form.label.keyFile')}
        placeholder={t('form.placeholder.keyFile')}
        withAsterisk
      />

      <CheckBoxInput
        label={t('form.label.keyEncrypted')}
        key={form.key('authConfig.keyEncrypted')}
        {...form.getInputProps('authConfig.keyEncrypted', { type: 'checkbox' })}
      />

      {keyEncrypted ? (
        <FieldInput
          type="password"
          label={t('form.label.keyPassword')}
          placeholder={savedSecrets.includes('keyPassword') ? t('form.placeholder.saved') : t('form.label.keyPassword')}
          description={t('form.hint.keyNotStored')}
          autoComplete="off"
          withAsterisk={secretRequired}
          key={form.key('authSecret.keyPassword')}
          {...form.getInputProps('authSecret.keyPassword')}
        />
      ) : null}

      <Text size="xs" c="dimmed">
        {t('form.hint.certTls')}
      </Text>
    </>
  );
}

export default AuthCertFields;
