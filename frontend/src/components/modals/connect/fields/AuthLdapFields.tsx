import { useTranslation } from 'react-i18next';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';
import AuthDurationField from '@/components/modals/connect/fields/AuthDurationField';

/** MinIO LDAP: user name, password and optional session duration. */
function AuthLdapFields({ form, savedSecrets, secretRequired }: AuthFieldsProps) {
  const { t } = useTranslation('connectModal');

  return (
    <>
      <FieldInput
        type="text"
        label={t('form.label.ldapUsername')}
        placeholder={t('form.label.ldapUsername')}
        autoComplete="off"
        withAsterisk
        key={form.key('authConfig.ldapUsername')}
        {...form.getInputProps('authConfig.ldapUsername')}
      />

      <FieldInput
        type="password"
        label={t('form.label.ldapPassword')}
        placeholder={savedSecrets.includes('ldapPassword') ? t('form.placeholder.saved') : t('form.label.ldapPassword')}
        autoComplete="off"
        withAsterisk={secretRequired}
        key={form.key('authSecret.ldapPassword')}
        {...form.getInputProps('authSecret.ldapPassword')}
      />

      <AuthDurationField form={form} />
    </>
  );
}

export default AuthLdapFields;
