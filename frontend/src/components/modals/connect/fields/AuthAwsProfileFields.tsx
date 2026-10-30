import { Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import AwsProfileCombobox from '@/components/inputs/combobox/AwsProfileCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';

type AuthAwsProfileFieldsProps = Pick<AuthFieldsProps, 'form'> & {
  /** `sso`: list only SSO profiles, hide the credentials file and show the login command. */
  ssoOnly?: boolean;
};

/** AWS CLI profile picker with optional custom config/credentials files. Used by `sharedProfile` and `sso`. */
function AuthAwsProfileFields({ form, ssoOnly }: AuthAwsProfileFieldsProps) {
  const { t } = useTranslation('connectModal');
  const profileName = form.useWatchValue('authConfig.profileName');
  const configFile = form.useWatchValue('authConfig.configFile');
  const credentialsFile = form.useWatchValue('authConfig.credentialsFile');

  return (
    <>
      <AwsProfileCombobox
        withAsterisk
        ssoOnly={ssoOnly}
        configFile={configFile}
        credentialsFile={credentialsFile}
        key={form.key('authConfig.profileName')}
        {...form.getInputProps('authConfig.profileName')}
      />

      {ssoOnly ? (
        <Text size="xs" c="dimmed">
          {t('form.hint.ssoLogin', { profile: profileName || t('form.hint.profilePlaceholder') })}
        </Text>
      ) : null}

      <FieldInput
        type="text"
        label={t('form.label.configFile')}
        placeholder={t('form.placeholder.configFile')}
        key={form.key('authConfig.configFile')}
        {...form.getInputProps('authConfig.configFile')}
      />

      {ssoOnly ? null : (
        <FieldInput
          type="text"
          label={t('form.label.credentialsFile')}
          placeholder={t('form.placeholder.credentialsFile')}
          key={form.key('authConfig.credentialsFile')}
          {...form.getInputProps('authConfig.credentialsFile')}
        />
      )}
    </>
  );
}

export default AuthAwsProfileFields;
