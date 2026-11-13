import { Center, Divider, Group, Modal, Stack, Text, Title, Tooltip } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import awsLogo from '@/assets/images/aws.svg';
import minioLogo from '@/assets/images/minio.svg';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import SelectInput from '@/components/inputs/SelectInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import { MODAL_CHROME_HEIGHT } from '@/components/modals/modalLayout';
import RegionCombobox from '@/pages/s3/components/RegionCombobox';
import {
  DEFAULT_AUTH_TYPE,
  getAuthMethods,
  isAuthTypeValid,
  isRegionOptional,
} from '@/pages/s3/modals/connect/authMethods';
import {
  type ConnectionInfo,
  type ConnectModalProps,
  connectSchema,
  getDefaultAuthConfig,
  getDefaultConnectionInfo,
  profileSchema,
  toConnectionInput,
  toFormValues,
} from '@/pages/s3/modals/connect/connectSchema';
import AuthAnonymousFields from '@/pages/s3/modals/connect/fields/AuthAnonymousFields';
import AuthAssumeRoleFields from '@/pages/s3/modals/connect/fields/AuthAssumeRoleFields';
import AuthAwsProfileFields from '@/pages/s3/modals/connect/fields/AuthAwsProfileFields';
import AuthCertFields from '@/pages/s3/modals/connect/fields/AuthCertFields';
import AuthLdapFields from '@/pages/s3/modals/connect/fields/AuthLdapFields';
import AuthMinioStsFields from '@/pages/s3/modals/connect/fields/AuthMinioStsFields';
import AuthOidcFields from '@/pages/s3/modals/connect/fields/AuthOidcFields';
import AuthStaticFields from '@/pages/s3/modals/connect/fields/AuthStaticFields';
import CaFileField from '@/pages/s3/modals/connect/fields/CaFileField';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { canAutoConnect, getAuthType, getRequiredSecrets } from '@/pages/s3/utils/authUtils';

/** Provider options of the segmented control; static, so built once. */
const PROVIDER_OPTIONS = [
  { logo: awsLogo, label: 'AWS', value: 'aws' },
  { logo: minioLogo, label: 'MinIO', value: 'minio' },
].map(({ logo, label, value }) => ({
  value,
  label: (
    <Center style={{ gap: '1rem' }}>
      <img src={logo} alt="" style={{ width: '1.125rem', height: '1.125rem' }} />
      <span>{label}</span>
    </Center>
  ),
}));

// Max body height on tall screens, sized for the Access key method: shorter methods shrink the modal to fit, longer
// methods scroll. Each cap shrinks on short screens so the modal stays in the viewport. Create/edit show the hint under
// the fields (2 lines of xs text plus the Stack gap, measured at about 43px); connect modes do not. Measured content:
// 747px in create, so 747 - 43 = 704 in connect, plus a few px of slack = 710.
const bodyHeight = (px: number) =>
  `min(${px / 16}rem, calc(100dvh - 2 * var(--modal-y-offset) - ${MODAL_CHROME_HEIGHT}))`;
const BODY_HEIGHT_WITH_HINT = bodyHeight(750);
const BODY_HEIGHT_NO_HINT = bodyHeight(710);

/**
 * Modal to connect, test a connection, or create/edit a connection profile depending on `mode`:
 * - `connect`: connect with typed credentials (nothing saved unless "save password" is ticked);
 * - `manualconnect`: connect a saved profile that needs input it does not store (secret key, MFA code);
 * - `createProfile` / `editProfile`: save a profile; secrets are optional (an empty one keeps the saved value).
 * Resolves `false` when dismissed. Load it through `showConnectModal` (lazy chunk).
 */
export default createMantineModal<ConnectModalProps, false>(
  props => {
    const { mode = 'connect', connectionProfile, mantine } = props;

    const { t } = useTranslation('connectModal');

    const actionRef = useRef<'connect' | 'profile'>('connect');
    // Closing the modal cancels a connect/test that is still running.
    const getSignal = useUnmountSignal();
    const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
    // The profile as last saved: its id, version and which secrets are stored.
    const [profile, setProfile] = useState(connectionProfile);

    // useForm only reads initialValues on mount; compute them once instead of on every keystroke.
    const [initialValues] = useState(() => {
      const defaultValues = getDefaultConnectionInfo(`Connection No.${createUUID()}`);

      return connectionProfile && (mode === 'manualconnect' || mode === 'editProfile')
        ? toFormValues(defaultValues, connectionProfile)
        : defaultValues;
    });

    const form = useForm<ConnectionInfo>({
      mode: 'uncontrolled',
      initialValues: initialValues,
      validate: values => {
        const resolver = schemaResolver(actionRef.current === 'profile' ? profileSchema : connectSchema, {
          sync: true,
        });
        return resolver(values);
      },
    });

    const savePassword = form.useWatchValue('savePassword');
    const provider = form.useWatchValue('provider');
    const authType = form.useWatchValue('authType');
    const secretKey = form.useWatchValue('secretKey');
    const ldapPassword = form.useWatchValue('authSecret.ldapPassword');
    const sourceType = form.useWatchValue('authConfig.sourceType');
    const mfaSerial = form.useWatchValue('authConfig.mfaSerial');
    const keyEncrypted = form.useWatchValue('authConfig.keyEncrypted');
    const keyPassword = form.useWatchValue('authSecret.keyPassword');

    form.watch('provider', ({ value }) => {
      if (!value) return;
      form.clearErrors(); // errors from the previous provider no longer apply
      form.setFieldValue('pathStyle', value === 'minio');
      if (!isAuthTypeValid(value, form.getValues().authType)) {
        form.setFieldValue('authType', DEFAULT_AUTH_TYPE);
      }
    });

    // A different method does not share the old method's fields (e.g. a non-SSO profile must not reach `sso`).
    form.watch('authType', ({ value }) => {
      form.clearErrors(); // errors from the previous method no longer apply
      // The CA belongs to the MinIO server, not to the method: keep it.
      const { caFile } = form.getValues().authConfig;
      form.setFieldValue('authConfig', { ...getDefaultAuthConfig(value), caFile });
      form.setFieldValue('mfaCode', '');
      form.setFieldValue('oidcSessionId', '');
      form.setFieldValue('authSecret.keyPassword', '');
    });

    const secretRequired = mode === 'connect' || mode === 'manualconnect';
    // Saved secrets only mean something for the saved method; another method starts without secrets.
    const savedSecrets = useMemo(
      () =>
        mode === 'editProfile' && profile && authType === getAuthType(profile) ? (profile.savedSecrets ?? []) : [],
      [mode, profile, authType]
    );

    const authOptions = useMemo(
      () => getAuthMethods(provider).map(type => ({ value: type, label: t(`authType.${type}.label`) })),
      [provider, t]
    );

    // Auto connect needs stored secrets and a method that connects without input (no MFA code).
    const authState = useMemo(
      () => ({ authType, authConfig: { sourceType, mfaSerial, keyEncrypted } }),
      [authType, sourceType, mfaSerial, keyEncrypted]
    );
    const autoConnectLocked = !canAutoConnect(authState);
    const typedSecrets: Record<string, string> = { secretKey, ldapPassword, keyPassword };
    const requiredSecrets = getRequiredSecrets(authState);
    const secretsReady = requiredSecrets.every(name => !!typedSecrets[name] || savedSecrets.includes(name));
    // Saving secrets only matters for methods that have some; the others (anonymous, SSO...) auto connect without.
    const autoConnectDisabled = (requiredSecrets.length > 0 && !savePassword) || autoConnectLocked || !secretsReady;

    useEffect(() => {
      if (autoConnectDisabled && form.getValues().autoConnect) form.setFieldValue('autoConnect', false);
    }, [autoConnectDisabled, form]);

    // Clearing the region gives null; the form keeps an empty string.
    const onChangeRegion = useCallback(
      (value: string | null) => form.getInputProps('region').onChange(value ?? ''),
      [form]
    );

    const authFieldsProps = { form, savedSecrets, secretRequired };

    const onSubmitConnect = useCallback(
      async (value: ConnectionInfo, isTestConnection: boolean) => {
        const input = toConnectionInput(value, connectionProfile?.id ?? '', connectionProfile?.version ?? 1);
        const isExistingProfile = mode === 'manualconnect';

        const output = await callIPC(ConnectS3, [input, isTestConnection, isExistingProfile], { signal: getSignal() });

        if (output && output.isConnected && !isTestConnection) {
          if (isExistingProfile && connectionProfile?.id) {
            updateConnectionProfiles(connectionProfile.id, {
              ...connectionProfile,
              isConnected: output.isConnected,
            });
          }
          mantine.handler.hide();
        }
      },
      [connectionProfile, mode, mantine.handler, updateConnectionProfiles, getSignal]
    );

    const onSubmitConnectProfile = useCallback(
      (value: ConnectionInfo) => onSubmitConnect(value, false),
      [onSubmitConnect]
    );

    const onSubmitTestConnection = useCallback(
      (value: ConnectionInfo) => onSubmitConnect(value, true),
      [onSubmitConnect]
    );

    const onSubmitUpdateProfile = useCallback(
      async (value: ConnectionInfo) => {
        const confirmModal = await ConfirmModal.show({
          type: 'info',
          confirmCode: 'C000001',
        });
        if (confirmModal && profile) {
          const input = toConnectionInput(value, profile.id ?? '', profile.version ?? 1, false);
          const output = await callIPC(UpdateProfileById, [input]);
          if (output?.id) {
            setProfile(output);
            form.setValues(toFormValues(getDefaultConnectionInfo(output.name ?? ''), output));
            updateConnectionProfiles(output.id, { ...output });
          }
        }
      },
      [profile, form, updateConnectionProfiles]
    );

    const onSubmitCreateProfile = useCallback(
      async (value: ConnectionInfo) => {
        const input = toConnectionInput(value, createUUID(), 1, false);
        const output = await callIPC(CreateProfile, [input], {
          showMessage: true,
        });
        if (output?.id) {
          updateConnectionProfiles(output.id, { ...output });
          mantine.handler.hide();
        }
      },
      [mantine.handler, updateConnectionProfiles]
    );

    const submitAs = useCallback(
      (action: 'connect' | 'profile', handler: (values: ConnectionInfo) => Promise<void>) => {
        actionRef.current = action;
        form.onSubmit(handler)();
      },
      [form]
    );

    const onSubmitForm = useCallback(
      (event: SyntheticEvent) => {
        event.preventDefault();
        if (mode === 'editProfile') submitAs('profile', onSubmitUpdateProfile);
        else if (mode === 'createProfile') submitAs('profile', onSubmitCreateProfile);
        else submitAs('connect', onSubmitConnectProfile);
      },
      [mode, submitAs, onSubmitUpdateProfile, onSubmitCreateProfile, onSubmitConnectProfile]
    );

    const onClickTestConnection = useCallback(
      () => submitAs('connect', onSubmitTestConnection),
      [submitAs, onSubmitTestConnection]
    );

    return (
      <Modal.Root {...mantine.props} centered size="xl">
        <Modal.Overlay />
        <form onSubmit={onSubmitForm}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="8px"
              mih="0px"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Title
                order={4}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {t('title')}
              </Title>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body
              p="16px"
              style={{ overflow: 'auto', maxHeight: secretRequired ? BODY_HEIGHT_NO_HINT : BODY_HEIGHT_WITH_HINT }}
            >
              <Stack gap="sm">
                <SegmentedControl
                  data={PROVIDER_OPTIONS}
                  key={form.key('provider')}
                  {...form.getInputProps('provider')}
                />

                <FieldInput
                  type="text"
                  label={t('form.label.name')}
                  placeholder={t('form.label.name')}
                  key={form.key('name')}
                  {...form.getInputProps('name')}
                />

                <FieldInput
                  type="color"
                  label={t('form.label.color')}
                  placeholder={t('form.label.color')}
                  key={form.key('color')}
                  {...form.getInputProps('color')}
                />

                <FieldInput
                  type="text"
                  label={t('form.label.endpoint')}
                  placeholder={t('form.label.endpoint')}
                  withAsterisk={provider === 'minio'}
                  key={form.key('endpoint')}
                  {...form.getInputProps('endpoint')}
                />

                <RegionCombobox
                  withAsterisk={!isRegionOptional(provider, authType)}
                  defaultValue={null}
                  key={form.key('region')}
                  {...form.getInputProps('region')}
                  onChange={onChangeRegion}
                />

                <SelectInput
                  label={t('form.label.authType')}
                  description={t(`authType.${authType}.description`)}
                  data={authOptions}
                  allowDeselect={false}
                  key={form.key('authType')}
                  {...form.getInputProps('authType')}
                />

                {authType === 'static' && <AuthStaticFields {...authFieldsProps} />}
                {authType === 'sharedProfile' && <AuthAwsProfileFields form={form} />}
                {authType === 'sso' && <AuthAwsProfileFields form={form} ssoOnly />}
                {authType === 'assumeRole' && <AuthAssumeRoleFields {...authFieldsProps} />}
                {authType === 'anonymous' && <AuthAnonymousFields form={form} />}
                {authType === 'minioAssumeRole' && <AuthMinioStsFields {...authFieldsProps} />}
                {authType === 'minioLdap' && <AuthLdapFields {...authFieldsProps} />}
                {authType === 'minioOidc' && <AuthOidcFields form={form} />}
                {authType === 'minioCert' && <AuthCertFields {...authFieldsProps} />}
                {provider === 'minio' && <CaFileField form={form} />}

                {secretRequired ? null : (
                  <Text size="xs" c="dimmed">
                    {t('form.hint.testNeedsSecrets')}
                  </Text>
                )}

                <Group justify="space-between">
                  <CheckBoxInput
                    label={t('form.label.pathStyle')}
                    key={form.key('pathStyle')}
                    disabled={provider === 'minio'}
                    {...form.getInputProps('pathStyle', { type: 'checkbox' })}
                  />

                  <CheckBoxInput
                    label={t('form.label.savePassword')}
                    key={form.key('savePassword')}
                    {...form.getInputProps('savePassword', { type: 'checkbox' })}
                  />

                  <Tooltip label={t('form.tooltip.autoConnectLocked')} disabled={!autoConnectLocked}>
                    <div>
                      <CheckBoxInput
                        label={t('form.label.autoConnect')}
                        key={form.key('autoConnect')}
                        disabled={autoConnectDisabled}
                        {...form.getInputProps('autoConnect', { type: 'checkbox' })}
                      />
                    </div>
                  </Tooltip>
                </Group>
              </Stack>
            </Modal.Body>

            <Divider />

            <Group p="8px" justify="space-between" wrap="nowrap">
              <Button type="button" loading={form.submitting} onClick={onClickTestConnection}>
                {t('form.button.testConnection')}
              </Button>

              {mode === 'connect' || mode === 'manualconnect' ? (
                <Button type="submit" loading={form.submitting}>
                  {t('common:button.connect')}
                </Button>
              ) : null}

              {mode === 'createProfile' || mode === 'editProfile' ? (
                <Button type="submit" loading={form.submitting}>
                  {t(`form.button.${mode}`)}
                </Button>
              ) : null}
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
