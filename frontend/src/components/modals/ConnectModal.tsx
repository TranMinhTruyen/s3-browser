import { Center, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileInput } from '@wails/S3Browser/models';
import { SyntheticEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import awsLogo from '@/assets/images/aws.svg';
import minioLogo from '@/assets/images/minio.svg';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID, isNullOrEmpty } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  type ConnectionInfo,
  type ConnectModalProps,
  connectSchema,
  getDefaultConnectionInfo,
  profileSchema,
} from '@/components/modals/connectSchema';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

/** Provider options of the segmented control; static, so built once. */
const PROVIDER_OPTIONS = [
  { logo: awsLogo, label: 'AWS', value: 'aws' },
  { logo: minioLogo, label: 'MinIO', value: 'minio' },
].map(({ logo, label, value }) => ({
  value,
  label: (
    <Center style={{ gap: '16px' }}>
      <img src={logo} alt="" width={18} height={18} />
      <span>{label}</span>
    </Center>
  ),
}));

/**
 * Modal to connect, test a connection, or create/edit a connection profile depending on `mode`:
 * - `connect`: connect with typed credentials (nothing saved unless "save password" is ticked);
 * - `manualconnect`: connect a saved profile whose secret key is not stored;
 * - `createProfile` / `editProfile`: save a profile; the secret key is optional.
 * Resolves `false` when dismissed. Load it through `showConnectModal` (lazy chunk).
 */
export default createMantineModal<ConnectModalProps, false>(
  props => {
    const { mode = 'connect', connectionProfile, mantine } = props;

    const { t } = useTranslation('connectModal');

    const actionRef = useRef<'connect' | 'profile'>('connect');
    const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);

    // useForm only reads initialValues on mount; compute them once instead of on every keystroke.
    const [initialValues] = useState(() => {
      const defaultValues = getDefaultConnectionInfo(`Connection No.${createUUID()}`);

      return mode === 'connect' || mode === 'createProfile'
        ? defaultValues
        : { ...defaultValues, ...connectionProfile, savePassword: !!connectionProfile?.secretKey };
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
    const secretKey = form.useWatchValue('secretKey');

    form.watch('savePassword', ({ value }) => {
      if (!value) {
        form.setFieldValue('autoConnect', false);
      }
    });

    form.watch('provider', ({ value }) => {
      if (value) {
        form.setFieldValue('pathStyle', value === 'minio');
      }
    });

    const onSubmitConnect = useCallback(
      async (value: ConnectionInfo, isTestConnection: boolean) => {
        const input: ConnectionProfileInput = {
          ...value,
          id: connectionProfile?.id ?? '',
          version: connectionProfile?.version ?? 1,
        };
        const isExistingProfile = mode === 'manualconnect';

        const output = await callIPC(ConnectS3, [input, isTestConnection, isExistingProfile]);

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
      [connectionProfile, mode, mantine.handler, updateConnectionProfiles]
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
        if (confirmModal && connectionProfile) {
          const input: ConnectionProfileInput = {
            ...value,
            id: connectionProfile.id ?? '',
            version: connectionProfile.version ?? 1,
          };
          const output = await callIPC(UpdateProfileById, [input]);
          if (output?.id) {
            form.setValues({ ...output });
            updateConnectionProfiles(output.id, { ...output });
          }
        }
      },
      [connectionProfile, form, updateConnectionProfiles]
    );

    const onSubmitCreateProfile = useCallback(
      async (value: ConnectionInfo) => {
        const input: ConnectionProfileInput = {
          ...value,
          id: createUUID(),
          version: 1,
        };
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
      <Modal.Root {...mantine.props} centered size="lg">
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
              <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
            </Modal.Header>

            <Divider />

            <Modal.Body p="16px">
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
                  withAsterisk
                  key={form.key('endpoint')}
                  {...form.getInputProps('endpoint')}
                />

                <RegionCombobox
                  withAsterisk
                  defaultValue={null}
                  key={form.key('region')}
                  {...form.getInputProps('region')}
                />

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
                  placeholder={t('form.label.secretKey')}
                  withAsterisk={mode === 'connect' || mode === 'manualconnect'}
                  key={form.key('secretKey')}
                  {...form.getInputProps('secretKey')}
                />

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

                  <CheckBoxInput
                    label={t('form.label.autoConnect')}
                    key={form.key('autoConnect')}
                    disabled={!savePassword || isNullOrEmpty(secretKey)}
                    {...form.getInputProps('autoConnect', { type: 'checkbox' })}
                  />
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
