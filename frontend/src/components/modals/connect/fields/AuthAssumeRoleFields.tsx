import { Text } from '@mantine/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import AwsProfileCombobox from '@/components/inputs/combobox/AwsProfileCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import type { AuthFieldsProps } from '@/components/modals/connect/connectSchema';
import AuthDurationField from '@/components/modals/connect/fields/AuthDurationField';
import AuthStaticFields from '@/components/modals/connect/fields/AuthStaticFields';

/** Role to assume, the credentials that assume it (access key or AWS CLI profile) and the optional MFA device. */
function AuthAssumeRoleFields(props: AuthFieldsProps) {
  const { form, secretRequired } = props;
  const { t } = useTranslation('connectModal');
  const sourceType = form.useWatchValue('authConfig.sourceType');
  const mfaSerial = form.useWatchValue('authConfig.mfaSerial');

  const sourceOptions = useMemo(
    () => [
      { value: 'static', label: t('form.sourceType.static') },
      { value: 'profile', label: t('form.sourceType.profile') },
    ],
    [t]
  );

  return (
    <>
      <Text size="sm" fw={500}>
        {t('form.label.sourceType')}
      </Text>
      <SegmentedControl
        data={sourceOptions}
        key={form.key('authConfig.sourceType')}
        {...form.getInputProps('authConfig.sourceType')}
      />

      {sourceType === 'profile' ? (
        <AwsProfileCombobox
          withAsterisk
          key={form.key('authConfig.profileName')}
          {...form.getInputProps('authConfig.profileName')}
        />
      ) : (
        <AuthStaticFields {...props} withSessionToken={false} />
      )}

      <FieldInput
        type="text"
        label={t('form.label.roleArn')}
        placeholder={t('form.placeholder.roleArn')}
        withAsterisk
        key={form.key('authConfig.roleArn')}
        {...form.getInputProps('authConfig.roleArn')}
      />

      <FieldInput
        type="text"
        label={t('form.label.externalId')}
        placeholder={t('form.label.externalId')}
        key={form.key('authConfig.externalId')}
        {...form.getInputProps('authConfig.externalId')}
      />

      <FieldInput
        type="text"
        label={t('form.label.sessionName')}
        placeholder={t('form.placeholder.sessionName')}
        key={form.key('authConfig.sessionName')}
        {...form.getInputProps('authConfig.sessionName')}
      />

      <AuthDurationField form={form} required />

      <FieldInput
        type="text"
        label={t('form.label.mfaSerial')}
        placeholder={t('form.placeholder.mfaSerial')}
        key={form.key('authConfig.mfaSerial')}
        {...form.getInputProps('authConfig.mfaSerial')}
      />

      {mfaSerial ? (
        <FieldInput
          type="text"
          label={t('form.label.mfaCode')}
          placeholder={t('form.hint.mfaCode')}
          autoComplete="off"
          inputMode="numeric"
          withAsterisk={secretRequired}
          key={form.key('mfaCode')}
          {...form.getInputProps('mfaCode')}
        />
      ) : null}
    </>
  );
}

export default AuthAssumeRoleFields;
