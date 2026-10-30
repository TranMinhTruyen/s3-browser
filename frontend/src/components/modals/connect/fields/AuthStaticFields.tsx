import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';

type AuthStaticFieldsProps = AuthFieldsProps & {
  /** Show the optional session token (temporary credentials). */
  withSessionToken?: boolean;
};

/** Access key, secret key and optional session token. Used by `static` and the key source of `assumeRole`. */
function AuthStaticFields({ form, savedSecrets, secretRequired, withSessionToken = true }: AuthStaticFieldsProps) {
  const { t } = useTranslation('connectModal');
  const savedPlaceholder = t('form.placeholder.saved');

  return (
    <>
      <FieldInput
        type="text"
        label={t('form.label.accessKey')}
        placeholder={t('form.label.accessKey')}
        withAsterisk
        key={form.key('accessKey')}
        {...form.getInputProps('accessKey')}
      />

      <FieldInput
        type="password"
        label={t('form.label.secretKey')}
        placeholder={savedSecrets.includes('secretKey') ? savedPlaceholder : t('form.label.secretKey')}
        withAsterisk={secretRequired}
        key={form.key('secretKey')}
        {...form.getInputProps('secretKey')}
      />

      {withSessionToken ? (
        <FieldInput
          type="password"
          label={t('form.label.sessionToken')}
          placeholder={savedSecrets.includes('sessionToken') ? savedPlaceholder : t('form.label.sessionToken')}
          key={form.key('authSecret.sessionToken')}
          {...form.getInputProps('authSecret.sessionToken')}
        />
      ) : null}
    </>
  );
}

export default AuthStaticFields;
